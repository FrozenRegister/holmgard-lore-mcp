// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/combat-action.ts

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'
import { executeRoll } from './math-manage'
import { resolveCohabitation } from '../utils/cohabitation'

// #210 — Doubles the die count in a dice expression for critical hit damage.
// e.g. "1d8" → "2d8", "2d6+3" → "4d6+3", "1d8!" → "2d8!"
function doubleDiceCount(expr: string): string {
  return expr.replace(/^(\d+)d/, (_, count) => `${parseInt(count) * 2}d`)
}

export const ACTIONS = ['attack', 'apply_damage', 'heal', 'apply_condition', 'remove_condition', 'use_ability', 'get_log', 'get_turn_summary', 'dash', 'dodge', 'disengage', 'help', 'ready'] as const
type CombatActionType = typeof ACTIONS[number]
const ALIASES: Record<string, CombatActionType> = {
  hit: 'attack', strike: 'attack', swing: 'attack',
  damage: 'apply_damage', hurt: 'apply_damage', wound: 'apply_damage',
  restore: 'heal', cure: 'heal', recover: 'heal',
  condition: 'apply_condition', add_condition: 'apply_condition', afflict: 'apply_condition',
  cure_condition: 'remove_condition', end_condition: 'remove_condition',
  ability: 'use_ability', special: 'use_ability', skill: 'use_ability',
  log: 'get_log', history: 'get_log',
  summary: 'get_turn_summary', turn_summary: 'get_turn_summary',
  sprint: 'dash', move_action: 'dash',
  evade: 'dodge',
  retreat: 'disengage', withdraw: 'disengage',
  assist: 'help',
  prepare: 'ready', hold_action: 'ready', delay: 'ready',
}

async function toggleCondition(db: D1Database, characterId: string, tag: string, add: boolean): Promise<void> {
  const row = await db.prepare('SELECT conditions FROM characters WHERE id = ?').bind(characterId).first() as { conditions: string } | null
  if (!row) return
  const conditions: string[] = JSON.parse(row.conditions ?? '[]')
  const next = add ? Array.from(new Set([...conditions, tag])) : conditions.filter(c => c !== tag)
  await db.prepare('UPDATE characters SET conditions = ? WHERE id = ?').bind(JSON.stringify(next), characterId).run()
}

const InputSchema = z.object({
  action: z.string(),
  encounterId: z.string().optional(),
  actorId: z.string().optional(),
  actorName: z.string().optional(),
  targetIds: z.array(z.string()).optional(),
  round: z.number().int().min(1).optional().default(1),
  turnIndex: z.number().int().min(0).optional().default(0),
  attackRoll: z.number().int().optional(),
  damage: z.number().int().min(0).optional(),
  damageExpression: z.string().optional(),
  damageType: z.string().optional(),
  healAmount: z.number().int().min(0).optional(),
  conditionName: z.string().optional(),
  abilityName: z.string().optional(),
  description: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
})

export async function handleCombatAction(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  async function logAction(actionType: string, summary: string, detail: unknown = null, damageDealt: number | null = null, healingDone: number | null = null, hpChanges: unknown = null) {
    if (!a.encounterId) return
    await db.prepare('INSERT INTO combat_action_log (encounter_id, round, turn_index, actor_id, actor_name, action_type, target_ids, result_summary, result_detail, damage_dealt, healing_done, hp_changes, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(a.encounterId, a.round, a.turnIndex, a.actorId ?? 'unknown', a.actorName ?? 'Unknown', actionType, a.targetIds ? JSON.stringify(a.targetIds) : null, summary, detail ? JSON.stringify(detail) : null, damageDealt, healingDone, hpChanges ? JSON.stringify(hpChanges) : null, now).run()
  }

  switch (match.matched) {
    case 'attack': {
      if (!a.actorId || !a.targetIds?.length) return err('"actorId" and "targetIds" are required')
      // #314 — staged-dissolution characters are non-combatants: Mycelium
      // integration, parasitic assimilation, dispatch protocols, etc. are
      // narrator-only processes. Reject the whole attack outright rather
      // than silently resolving a damage roll against someone the scroller
      // must not touch.
      const { results: stagedTargets } = await db.prepare(
        `SELECT id, name FROM characters WHERE id IN (${a.targetIds.map(() => '?').join(',')}) AND death_mode = 'staged'`
      ).bind(...a.targetIds).all() as { results: Array<{ id: string; name: string }> }
      if (stagedTargets.length > 0) {
        return err(`Cannot attack staged-dissolution character(s): ${stagedTargets.map(t => t.name).join(', ')}`)
      }
      // #210 — Use the shared dice engine (crypto-backed RNG, critical
      // detection) instead of a flat Math.random() > 0.5 coin-flip. When the
      // caller supplies an explicit attackRoll, we honour it directly; otherwise
      // we roll 1d20 via executeRoll. Hit threshold stays >= 10 (equivalent to
      // AC 10 with no modifier), which shifts hit rate from a flat 50% to 55%.
      const attackRollResult = a.attackRoll !== undefined
        ? { total: a.attackRoll, rolls: [a.attackRoll], steps: [`Supplied roll: ${a.attackRoll}`], critical: a.attackRoll === 20 ? 'success' as const : a.attackRoll === 1 ? 'failure' as const : null }
        : executeRoll('1d20')
      const attackRoll = attackRollResult.total
      const isCrit = attackRollResult.critical === 'success'
      const isFumble = attackRollResult.critical === 'failure'
      // A nat-20 always hits; a nat-1 always misses. Otherwise hit on >= 10.
      const hit = isCrit ? true : isFumble ? false : attackRoll >= 10
      // Damage: use the shared dice engine with a configurable expression
      // (default 1d8). If the caller supplies an explicit damage value, use
      // that instead. On a critical hit, double the dice (standard 5e rule)
      // by doubling the die count in the expression (e.g. 1d8 → 2d8).
      let damage = 0
      let damageRoll: number | null = null
      if (hit) {
        if (a.damage !== undefined) {
          damage = a.damage
        } else {
          const damageExpr = a.damageExpression ?? '1d8'
          const critExpr = isCrit ? doubleDiceCount(damageExpr) : damageExpr
          const dmgResult = executeRoll(critExpr)
          damage = dmgResult.total
          damageRoll = dmgResult.total
        }
      }
      const summary = hit ? `${a.actorName ?? a.actorId} hit for ${damage} ${a.damageType ?? 'damage'}${isCrit ? ' (CRITICAL!)' : ''}` : `${a.actorName ?? a.actorId} missed${isFumble ? ' (FUMBLE!)' : ''}`
      await logAction('attack', summary, { hit, attackRoll, isCrit, isFumble, damageRoll }, hit ? damage : null, null, null)
      return ok({ success: true, actionType: 'attack', hit, attackRoll, isCrit, isFumble, damage, damageRoll, damageType: a.damageType, summary })
    }
    case 'apply_damage': {
      if (!a.targetIds?.length || a.damage === undefined) return err('"targetIds" and "damage" are required')
      const hpChanges: Record<string, number> = {}
      const concentrationChecks: Record<string, number> = {}
      for (const targetId of a.targetIds) {
        // #315 — a co-habitating body has one shared HP pool on the host row.
        // Damage aimed at a passenger consciousness's own character id must
        // still land on the host, not a separate (stale) hp field on the
        // passenger's row. Solo characters resolve to themselves — no change.
        const resolution = await resolveCohabitation(db, targetId)
        const hostId = resolution?.hostBodyId ?? targetId
        const char = await db.prepare('SELECT hp, resistances, vulnerabilities, immunities, concentrating_on FROM characters WHERE id = ?').bind(hostId).first() as
          { hp: number; resistances: string | null; vulnerabilities: string | null; immunities: string | null; concentrating_on: string | null } | null
        if (char) {
          const immunities: string[] = char.immunities ? JSON.parse(char.immunities) : []
          const resistances: string[] = char.resistances ? JSON.parse(char.resistances) : []
          const vulnerabilities: string[] = char.vulnerabilities ? JSON.parse(char.vulnerabilities) : []
          let effectiveDamage = a.damage
          if (a.damageType && immunities.includes(a.damageType)) effectiveDamage = 0
          else if (a.damageType && resistances.includes(a.damageType)) effectiveDamage = Math.floor(effectiveDamage / 2)
          else if (a.damageType && vulnerabilities.includes(a.damageType)) effectiveDamage = effectiveDamage * 2

          const newHp = Math.max(0, char.hp - effectiveDamage)
          await db.prepare('UPDATE characters SET hp = ? WHERE id = ?').bind(newHp, hostId).run()
          hpChanges[targetId] = newHp - char.hp
          if (char.concentrating_on && effectiveDamage > 0) concentrationChecks[targetId] = Math.max(10, Math.floor(effectiveDamage / 2))
        }
      }
      const summary = `Applied ${a.damage} ${a.damageType ?? ''} damage to ${a.targetIds.length} target(s)`
      await logAction('damage', summary, null, a.damage, null, hpChanges)
      return ok({ success: true, actionType: 'apply_damage', damage: a.damage, targetIds: a.targetIds, hpChanges, concentrationChecks })
    }
    case 'heal': {
      if (!a.targetIds?.length || a.healAmount === undefined) return err('"targetIds" and "healAmount" are required')
      const hpChanges: Record<string, number> = {}
      for (const targetId of a.targetIds) {
        // #315 — same shared-HP-pool redirection as apply_damage.
        const resolution = await resolveCohabitation(db, targetId)
        const hostId = resolution?.hostBodyId ?? targetId
        const char = await db.prepare('SELECT hp, max_hp FROM characters WHERE id = ?').bind(hostId).first() as { hp: number; max_hp: number } | null
        if (char) {
          const newHp = Math.min(char.max_hp, char.hp + a.healAmount)
          await db.prepare('UPDATE characters SET hp = ? WHERE id = ?').bind(newHp, hostId).run()
          hpChanges[targetId] = newHp - char.hp
        }
      }
      const summary = `Healed ${a.healAmount} HP to ${a.targetIds.length} target(s)`
      await logAction('heal', summary, null, null, a.healAmount, hpChanges)
      return ok({ success: true, actionType: 'heal', healAmount: a.healAmount, targetIds: a.targetIds, hpChanges })
    }
    case 'apply_condition': {
      if (!a.targetIds?.length || !a.conditionName) return err('"targetIds" and "conditionName" are required')
      for (const targetId of a.targetIds) {
        const char = await db.prepare('SELECT conditions FROM characters WHERE id = ?').bind(targetId).first() as { conditions: string } | null
        if (char) {
          const conditions = JSON.parse(char.conditions ?? '[]')
          if (!conditions.includes(a.conditionName)) conditions.push(a.conditionName)
          await db.prepare('UPDATE characters SET conditions = ? WHERE id = ?').bind(JSON.stringify(conditions), targetId).run()
        }
      }
      await logAction('condition', `Applied condition: ${a.conditionName}`)
      return ok({ success: true, actionType: 'apply_condition', conditionName: a.conditionName, targetIds: a.targetIds })
    }
    case 'remove_condition': {
      if (!a.targetIds?.length || !a.conditionName) return err('"targetIds" and "conditionName" are required')
      for (const targetId of a.targetIds) {
        const char = await db.prepare('SELECT conditions FROM characters WHERE id = ?').bind(targetId).first() as { conditions: string } | null
        if (char) {
          const conditions = JSON.parse(char.conditions ?? '[]').filter((c: string) => c !== a.conditionName)
          await db.prepare('UPDATE characters SET conditions = ? WHERE id = ?').bind(JSON.stringify(conditions), targetId).run()
        }
      }
      return ok({ success: true, actionType: 'remove_condition', conditionName: a.conditionName, targetIds: a.targetIds })
    }
    case 'use_ability': {
      if (!a.actorId || !a.abilityName) return err('"actorId" and "abilityName" are required')
      const summary = `${a.actorName ?? a.actorId} used ${a.abilityName}${a.description ? ': ' + a.description : ''}`
      await logAction('ability', summary, { abilityName: a.abilityName })
      return ok({ success: true, actionType: 'use_ability', abilityName: a.abilityName, summary })
    }
    case 'get_log': {
      if (!a.encounterId) return err('"encounterId" is required')
      const { results } = await db.prepare('SELECT * FROM combat_action_log WHERE encounter_id = ? ORDER BY round, turn_index DESC LIMIT ?').bind(a.encounterId, a.limit).all()
      return ok({ success: true, actionType: 'get_log', encounterId: a.encounterId, log: results, count: results.length })
    }
    case 'get_turn_summary': {
      if (!a.encounterId) return err('"encounterId" is required')
      const { results } = await db.prepare('SELECT * FROM combat_action_log WHERE encounter_id = ? AND round = ? ORDER BY turn_index').bind(a.encounterId, a.round).all()
      return ok({ success: true, actionType: 'get_turn_summary', encounterId: a.encounterId, round: a.round, actions: results })
    }
    case 'dash': {
      if (!a.actorId) return err('"actorId" is required')
      const summary = `${a.actorName ?? a.actorId} takes the Dash action`
      await logAction('dash', summary)
      return ok({ success: true, actionType: 'dash', summary })
    }
    case 'dodge': {
      if (!a.actorId) return err('"actorId" is required')
      await toggleCondition(db, a.actorId, 'dodging', true)
      const summary = `${a.actorName ?? a.actorId} takes the Dodge action`
      await logAction('dodge', summary)
      return ok({ success: true, actionType: 'dodge', actorId: a.actorId, summary })
    }
    case 'disengage': {
      if (!a.actorId) return err('"actorId" is required')
      await toggleCondition(db, a.actorId, 'disengaged', true)
      const summary = `${a.actorName ?? a.actorId} takes the Disengage action`
      await logAction('disengage', summary)
      return ok({ success: true, actionType: 'disengage', actorId: a.actorId, summary })
    }
    case 'help': {
      if (!a.actorId || !a.targetIds?.length) return err('"actorId" and "targetIds" are required')
      for (const targetId of a.targetIds) await toggleCondition(db, targetId, 'helped', true)
      const summary = `${a.actorName ?? a.actorId} helps ${a.targetIds.join(', ')}`
      await logAction('help', summary)
      return ok({ success: true, actionType: 'help', actorId: a.actorId, targetIds: a.targetIds, summary })
    }
    case 'ready': {
      if (!a.actorId || !a.description) return err('"actorId" and "description" (the trigger + held action) are required')
      await toggleCondition(db, a.actorId, 'readying', true)
      const summary = `${a.actorName ?? a.actorId} readies an action: ${a.description}`
      await logAction('ready', summary, { trigger: a.description })
      return ok({ success: true, actionType: 'ready', actorId: a.actorId, trigger: a.description, summary })
    }
  }
}