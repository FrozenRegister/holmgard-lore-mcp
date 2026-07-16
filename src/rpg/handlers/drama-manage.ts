// src/rpg/handlers/drama-manage.ts
// Narrative conflict resolution: opposed checks, group checks, social combat, dramatic conflicts.
// All character stats are read from D1 (characters table). No KV fallback.

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'
import { handleMathManage } from './math-manage'
import { handleEventManage } from './event-manage'
import { resolveEffectiveStats } from '../utils/cohabitation'

const ACTIONS = ['roll_ability', 'opposed_check', 'group_check', 'social_combat', 'dramatic_conflict'] as const
type DramaAction = typeof ACTIONS[number]
const ALIASES: Record<string, DramaAction> = {
  ability:    'roll_ability',
  roll:       'roll_ability',
  oppose:     'opposed_check',
  duel:       'opposed_check',
  group:      'group_check',
  pool:       'group_check',
  social:     'social_combat',
  negotiate:  'social_combat',
  conflict:   'dramatic_conflict',
  campaign:   'dramatic_conflict',
}

const SideEntrySchema = z.object({
  character: z.string(),
  ability: z.string(),
})
const ParticipantSchema = z.object({
  character: z.string(),
  goal: z.string().optional(),
  leverage: z.number().optional().default(0),
})
const ConflictSideSchema = z.object({
  name: z.string(),
  actors: z.array(z.string()),
  primary_ability: z.string().optional().default('cha'),
  momentum: z.number().optional().default(0),
})
const ExternalFactorSchema = z.object({
  name: z.string(),
  modifier: z.number(),
  affects: z.string(),
})

const InputSchema = z.object({
  action: z.string(),
  // roll_ability
  character: z.string().optional(),
  ability: z.string().optional(),
  advantage: z.union([z.boolean(), z.string()]).optional(),
  disadvantage: z.union([z.boolean(), z.string()]).optional(),
  // opposed_check
  character_a: z.string().optional(),
  ability_a: z.string().optional(),
  character_b: z.string().optional(),
  ability_b: z.string().optional(),
  // group_check
  side_a: z.array(SideEntrySchema).optional(),
  side_b: z.array(SideEntrySchema).optional(),
  mode: z.enum(['best', 'sum', 'pool']).optional().default('best'),
  // social_combat
  participants: z.array(ParticipantSchema).optional(),
  rounds: z.number().int().min(1).max(20).optional().default(3),
  arena: z.string().optional(),
  stakes: z.string().optional(),
  // dramatic_conflict
  title: z.string().optional(),
  sides: z.array(ConflictSideSchema).optional(),
  ticks: z.number().int().min(1).max(20).optional().default(4),
  external_factors: z.array(ExternalFactorSchema).optional(),
})

type Stats = { str: number; dex: number; con: number; int: number; wis: number; cha: number }
type CharRow = { id: string; name: string; stats: Stats }

function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2)
}

function getScore(stats: Stats, ability: string): number {
  const key = ability.toLowerCase() as keyof Stats
  return stats[key] ?? 10
}

// #315 — co-habitation-aware stat resolution. When `id` is (or belongs to) a
// co-habitating character (see #226 Phase 2's host_body_id/active model),
// physical abilities (str/dex/con) resolve from the host body, mental
// abilities (int/wis/cha) resolve from whichever consciousness is currently
// driving, and the display name follows the driver. Non-co-habitating
// characters resolve to themselves unchanged.
async function fetchCharD1(db: D1Database, id: string): Promise<CharRow | null> {
  const resolved = await resolveEffectiveStats(db, id)
  if (!resolved) return null
  return { id, name: resolved.name, stats: resolved.stats }
}

async function rollD20Once(env: AppBindings): Promise<{ roll: number; isNat1: boolean; isNat20: boolean }> {
  const resp = await handleMathManage(env, { action: 'roll', expression: '1d20' })
  const data = JSON.parse(resp.content[0].text) as { total: number }
  const roll = data.total
  return { roll, isNat1: roll === 1, isNat20: roll === 20 }
}

async function rollD20(
  env: AppBindings,
  hasAdvantage: boolean,
  hasDisadvantage: boolean,
): Promise<{ roll: number; isNat1: boolean; isNat20: boolean }> {
  if (hasAdvantage || hasDisadvantage) {
    const [r1, r2] = await Promise.all([rollD20Once(env), rollD20Once(env)])
    const roll = hasAdvantage ? Math.max(r1.roll, r2.roll) : Math.min(r1.roll, r2.roll)
    return { roll, isNat1: roll === 1, isNat20: roll === 20 }
  }
  return rollD20Once(env)
}

async function emitEvent(env: AppBindings, payload: Record<string, unknown>): Promise<void> {
  await handleEventManage(env, {
    action: 'emit',
    eventType: 'world_change',
    payload,
    sourceType: 'system',
    sourceId: 'drama',
  })
}

export async function handleDramaManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data

  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)

  const db = env.RPG_DB!

  switch (match.matched) {
    case 'roll_ability': {
      if (!a.character) return err('"character" is required')
      if (!a.ability) return err('"ability" is required')
      const char = await fetchCharD1(db, a.character)
      if (!char) return err(`Character not found in D1: ${a.character}`)
      const score = getScore(char.stats, a.ability)
      const mod = abilityMod(score)
      const hasAdv = a.advantage === true || a.advantage === 'true'
      const hasDis = a.disadvantage === true || a.disadvantage === 'true'
      const { roll, isNat1, isNat20 } = await rollD20(env, hasAdv, hasDis)
      const total = roll + mod
      return ok({ success: true, actionType: 'roll_ability', character: char.name, ability: a.ability.toLowerCase(), score, modifier: mod, roll, total, isNat1, isNat20 })
    }

    case 'opposed_check': {
      if (!a.character_a || !a.ability_a || !a.character_b || !a.ability_b)
        return err('"character_a", "ability_a", "character_b", and "ability_b" are required')
      const [charA, charB] = await Promise.all([
        fetchCharD1(db, a.character_a),
        fetchCharD1(db, a.character_b),
      ])
      if (!charA) return err(`Character not found in D1: ${a.character_a}`)
      if (!charB) return err(`Character not found in D1: ${a.character_b}`)

      const modA = abilityMod(getScore(charA.stats, a.ability_a))
      const modB = abilityMod(getScore(charB.stats, a.ability_b))
      const [diceA, diceB] = await Promise.all([
        rollD20(env, a.advantage === 'a', a.disadvantage === 'a'),
        rollD20(env, a.advantage === 'b', a.disadvantage === 'b'),
      ])
      const totalA = diceA.roll + modA
      const totalB = diceB.roll + modB
      const winner = totalA > totalB ? 'a' : totalB > totalA ? 'b' : 'tie'
      const margin = Math.abs(totalA - totalB)

      await emitEvent(env, { type: 'opposed_check', winner, margin, character_a: charA.name, character_b: charB.name })

      return ok({
        success: true, actionType: 'opposed_check', winner, margin,
        a: { character: charA.name, ability: a.ability_a.toLowerCase(), score: getScore(charA.stats, a.ability_a), modifier: modA, roll: diceA.roll, total: totalA, isNat1: diceA.isNat1, isNat20: diceA.isNat20 },
        b: { character: charB.name, ability: a.ability_b.toLowerCase(), score: getScore(charB.stats, a.ability_b), modifier: modB, roll: diceB.roll, total: totalB, isNat1: diceB.isNat1, isNat20: diceB.isNat20 },
      })
    }

    case 'group_check': {
      if (!a.side_a || a.side_a.length === 0) return err('"side_a" must be a non-empty array')
      if (!a.side_b || a.side_b.length === 0) return err('"side_b" must be a non-empty array')

      const allIds = [...a.side_a.map(e => e.character), ...a.side_b.map(e => e.character)]
      const charRows = await Promise.all(allIds.map(id => fetchCharD1(db, id)))
      const charMap = new Map<string, CharRow>()
      for (const c of charRows) { if (c) charMap.set(c.id, c) }

      async function rollSide(entries: Array<{ character: string; ability: string }>) {
        return Promise.all(entries.map(async e => {
          const c = charMap.get(e.character)
          if (!c) return { character: e.character, name: null as string | null, ability: e.ability.toLowerCase(), score: 10, modifier: 0, roll: 0, total: 0, notFound: true }
          const score = getScore(c.stats, e.ability)
          const mod = abilityMod(score)
          const { roll, isNat1, isNat20 } = await rollD20Once(env)
          return { character: e.character, name: c.name, ability: e.ability.toLowerCase(), score, modifier: mod, roll, total: roll + mod, isNat1, isNat20, notFound: false }
        }))
      }

      const [rollsA, rollsB] = await Promise.all([rollSide(a.side_a), rollSide(a.side_b)])

      function aggregate(rolls: Awaited<ReturnType<typeof rollSide>>): number {
        const totals = rolls.filter(r => !r.notFound).map(r => r.total)
        if (totals.length === 0) return 0
        if (a.mode === 'sum') return totals.reduce((s, t) => s + t, 0)
        if (a.mode === 'pool') {
          const sorted = [...totals].sort((x, y) => y - x)
          return sorted[0] + (sorted.length - 1)
        }
        return Math.max(...totals) // 'best'
      }

      const scoreA = aggregate(rollsA)
      const scoreB = aggregate(rollsB)
      const winner = scoreA > scoreB ? 'a' : scoreB > scoreA ? 'b' : 'tie'

      await emitEvent(env, { type: 'group_check', winner, mode: a.mode })

      return ok({ success: true, actionType: 'group_check', winner, mode: a.mode, pooled_score_a: scoreA, pooled_score_b: scoreB, rolls_a: rollsA, rolls_b: rollsB })
    }

    case 'social_combat': {
      if (!a.participants || a.participants.length < 2)
        return err('"participants" must have at least 2 entries')

      const leverages = a.participants.map(p => p.leverage)
      const initialLeverages = [...leverages]

      type RoundRoll = { character: string; name: string; roll: number; modifier: number; leverageBonus: number; total: number; isNat1: boolean; isNat20: boolean }
      type RoundResult = { round: number; rolls: RoundRoll[]; winner_idx: number; leverage_after: number[] }
      const roundResults: RoundResult[] = []

      for (let r = 0; r < a.rounds; r++) {
        const rolls: RoundRoll[] = await Promise.all(a.participants.map(async (p, i) => {
          const char = await fetchCharD1(db, p.character)
          const chaScore = char ? getScore(char.stats, 'cha') : 10
          const mod = abilityMod(chaScore)
          const { roll, isNat1, isNat20 } = await rollD20Once(env)
          const levBonus = leverages[i]
          return { character: p.character, name: char?.name ?? p.character, roll, modifier: mod, leverageBonus: levBonus, total: roll + mod + levBonus, isNat1, isNat20 }
        }))

        let bestIdx = 0
        for (let i = 1; i < rolls.length; i++) {
          if (rolls[i].total > rolls[bestIdx].total) bestIdx = i
        }
        const shift = rolls[bestIdx].isNat20 ? 2 : 1
        leverages[bestIdx] += shift

        roundResults.push({ round: r + 1, rolls, winner_idx: bestIdx, leverage_after: [...leverages] })
      }

      let winnerIdx = 0
      for (let i = 1; i < leverages.length; i++) {
        if (leverages[i] > leverages[winnerIdx]) winnerIdx = i
      }
      const winnerChar = a.participants[winnerIdx]
      const leverage_delta = leverages.map((l, i) => l - initialLeverages[i])

      await emitEvent(env, { type: 'social_combat', winner: winnerChar.character, rounds: a.rounds, arena: a.arena ?? null, stakes: a.stakes ?? null })

      return ok({
        success: true, actionType: 'social_combat',
        winner: winnerChar.character, winner_goal: winnerChar.goal ?? null,
        rounds: roundResults, final_leverage: leverages, leverage_delta,
        arena: a.arena ?? null, stakes: a.stakes ?? null,
      })
    }

    case 'dramatic_conflict': {
      if (!a.sides || a.sides.length < 2)
        return err('"sides" must have at least 2 entries')

      const momentums = a.sides.map(s => s.momentum)
      const initialMomentums = [...momentums]

      type TickSideResult = { side: string; best_roll: number; momentum_bonus: number; external_bonus: number; total: number }
      type TickResult = { tick: number; side_results: TickSideResult[]; winner_name: string; momentum_after: number[] }
      const tickResults: TickResult[] = []

      for (let t = 0; t < a.ticks; t++) {
        const sideResults: TickSideResult[] = await Promise.all(a.sides.map(async (side, si) => {
          const actorRolls = await Promise.all(side.actors.map(async actorId => {
            const char = await fetchCharD1(db, actorId)
            const score = char ? getScore(char.stats, side.primary_ability) : 10
            const { roll } = await rollD20Once(env)
            return roll + abilityMod(score)
          }))
          const bestRoll = actorRolls.length > 0 ? Math.max(...actorRolls) : 10
          const externalBonus = (a.external_factors ?? [])
            .filter(f => f.affects === side.name)
            .reduce((sum, f) => sum + f.modifier, 0)
          return { side: side.name, best_roll: bestRoll, momentum_bonus: momentums[si], external_bonus: externalBonus, total: bestRoll + momentums[si] + externalBonus }
        }))

        let bestSi = 0
        for (let i = 1; i < sideResults.length; i++) {
          if (sideResults[i].total > sideResults[bestSi].total) bestSi = i
        }
        momentums[bestSi] += 1

        tickResults.push({ tick: t + 1, side_results: sideResults, winner_name: sideResults[bestSi].side, momentum_after: [...momentums] })
      }

      let winSi = 0
      for (let i = 1; i < momentums.length; i++) {
        if (momentums[i] > momentums[winSi]) winSi = i
      }
      const momentum_shift = momentums.map((m, i) => m - initialMomentums[i])

      await emitEvent(env, { type: 'dramatic_conflict', title: a.title ?? null, winner: a.sides[winSi].name })

      return ok({
        success: true, actionType: 'dramatic_conflict',
        title: a.title ?? null, winner: a.sides[winSi].name,
        ticks: tickResults, final_momentum: momentums, momentum_shift,
      })
    }
  }
}
