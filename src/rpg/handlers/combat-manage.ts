// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/combat-manage.ts
// Complex AI/combat-engine calls simplified to D1 CRUD.

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError, CRUD_ALIASES } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['create_encounter', 'get_encounter', 'list_encounters', 'add_combatant', 'remove_combatant', 'start', 'end', 'next_turn', 'get_state', 'death_save', 'legendary_action', 'lair_action'] as const
type CombatAction = typeof ACTIONS[number]
const ALIASES: Record<string, CombatAction> = {
  ...CRUD_ALIASES,
  create: 'create_encounter', new_encounter: 'create_encounter', setup: 'create_encounter',
  get: 'get_encounter', show: 'get_encounter',
  list: 'list_encounters', all: 'list_encounters',
  add: 'add_combatant', join: 'add_combatant', spawn: 'add_combatant',
  remove: 'remove_combatant', kill: 'remove_combatant', flee: 'remove_combatant',
  begin: 'start', init: 'start',
  finish: 'end', resolve: 'end', complete: 'end',
  next: 'next_turn', advance: 'next_turn',
  state: 'get_state', status: 'get_state',
  ds: 'death_save', dying_save: 'death_save',
  legendary: 'legendary_action',
  lair: 'lair_action',
} as Record<string, CombatAction>

const TokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  characterId: z.string().optional(),
  type: z.enum(['pc', 'npc', 'enemy', 'neutral']).default('enemy'),
  initiative: z.number().optional().default(0),
  hp: z.number().int().optional(),
  maxHp: z.number().int().optional(),
  position: z.object({ x: z.number().int(), y: z.number().int() }).optional(),
})

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  regionId: z.string().optional(),
  tokens: z.array(TokenSchema).optional(),
  token: TokenSchema.optional(),
  tokenId: z.string().optional(),
  filter: z.enum(['all', 'active', 'completed']).optional().default('all'),
  characterId: z.string().optional(),
  saveRoll: z.number().int().min(1).max(20).optional(),
  actionName: z.string().optional(),
  cost: z.number().int().min(1).optional().default(1),
  encounterId: z.string().optional(),
})

function parseTokens(raw: unknown): unknown[] {
  if (!raw) return []
  try { return JSON.parse(raw as string) } catch { return [] }
}

export async function handleCombatManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'create_encounter': {
      const id = crypto.randomUUID()
      const tokens = a.tokens ?? []
      await db.prepare('INSERT INTO encounters (id, region_id, tokens, round, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, a.regionId ?? null, JSON.stringify(tokens), 1, 'setup', now, now).run()
      return ok({ success: true, actionType: 'create_encounter', encounterId: id, tokenCount: tokens.length, status: 'setup' })
    }
    case 'get_encounter': {
      if (!a.id) return err('"id" is required')
      const row = await db.prepare('SELECT * FROM encounters WHERE id = ?').bind(a.id).first()
      if (!row) return err(`Encounter not found: ${a.id}`)
      const { results: log } = await db.prepare('SELECT * FROM combat_action_log WHERE encounter_id = ? ORDER BY round, turn_index LIMIT 50').bind(a.id).all()
      return ok({ success: true, actionType: 'get_encounter', encounter: { ...row, tokens: parseTokens((row as any).tokens) }, actionLog: log })
    }
    case 'list_encounters': {
      let query = 'SELECT id, region_id, round, status, created_at FROM encounters'
      const binds: unknown[] = []
      if (a.filter && a.filter !== 'all') { query += ' WHERE status = ?'; binds.push(a.filter === 'active' ? 'active' : 'completed') }
      const { results } = await db.prepare(query + ' ORDER BY created_at DESC LIMIT 50').bind(...binds).all()
      return ok({ success: true, actionType: 'list_encounters', encounters: results, count: results.length })
    }
    case 'add_combatant': {
      if (!a.id) return err('"id" (encounterId) is required')
      if (!a.token) return err('"token" is required')
      const row = await db.prepare('SELECT tokens FROM encounters WHERE id = ?').bind(a.id).first() as { tokens: string } | null
      if (!row) return err(`Encounter not found: ${a.id}`)
      const tokens = parseTokens(row.tokens) as object[]
      const newToken = { ...a.token, id: a.token.id ?? crypto.randomUUID() }
      tokens.push(newToken)
      await db.prepare('UPDATE encounters SET tokens = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(tokens), now, a.id).run()
      return ok({ success: true, actionType: 'add_combatant', encounterId: a.id, token: newToken, totalCombatants: tokens.length })
    }
    case 'remove_combatant': {
      if (!a.id || !a.tokenId) return err('"id" and "tokenId" are required')
      const row = await db.prepare('SELECT tokens FROM encounters WHERE id = ?').bind(a.id).first() as { tokens: string } | null
      if (!row) return err(`Encounter not found: ${a.id}`)
      const tokens = (parseTokens(row.tokens) as Array<{ id: string }>).filter(t => t.id !== a.tokenId)
      await db.prepare('UPDATE encounters SET tokens = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(tokens), now, a.id).run()
      return ok({ success: true, actionType: 'remove_combatant', encounterId: a.id, tokenId: a.tokenId, remainingCombatants: tokens.length })
    }
    case 'start': {
      if (!a.id) return err('"id" is required')
      const row = await db.prepare('SELECT tokens FROM encounters WHERE id = ?').bind(a.id).first() as { tokens: string } | null
      if (!row) return err(`Encounter not found: ${a.id}`)
      const tokens = parseTokens(row.tokens) as Array<{ id: string; initiative?: number }>
      tokens.sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0))
      const firstToken = tokens[0]?.id ?? null
      await db.prepare("UPDATE encounters SET status = 'active', tokens = ?, active_token_id = ?, round = 1, updated_at = ? WHERE id = ?").bind(JSON.stringify(tokens), firstToken, now, a.id).run()
      return ok({ success: true, actionType: 'start', encounterId: a.id, status: 'active', round: 1, firstTurn: firstToken })
    }
    case 'end': {
      if (!a.id) return err('"id" is required')
      await db.prepare("UPDATE encounters SET status = 'completed', updated_at = ? WHERE id = ?").bind(now, a.id).run()
      return ok({ success: true, actionType: 'end', encounterId: a.id, status: 'completed' })
    }
    case 'next_turn': {
      if (!a.id) return err('"id" is required')
      const row = await db.prepare('SELECT tokens, active_token_id, round FROM encounters WHERE id = ?').bind(a.id).first() as { tokens: string; active_token_id: string; round: number } | null
      if (!row) return err(`Encounter not found: ${a.id}`)
      const tokens = parseTokens(row.tokens) as Array<{ id: string }>
      const idx = tokens.findIndex(t => t.id === row.active_token_id)
      const nextIdx = (idx + 1) % tokens.length
      const newRound = nextIdx === 0 ? row.round + 1 : row.round
      const nextToken = tokens[nextIdx]?.id ?? null
      await db.prepare('UPDATE encounters SET active_token_id = ?, round = ?, updated_at = ? WHERE id = ?').bind(nextToken, newRound, now, a.id).run()
      return ok({ success: true, actionType: 'next_turn', encounterId: a.id, currentTurn: nextToken, round: newRound, newRoundStarted: nextIdx === 0 })
    }
    case 'get_state': {
      if (!a.id) return err('"id" is required')
      const row = await db.prepare('SELECT id, round, active_token_id, status, tokens FROM encounters WHERE id = ?').bind(a.id).first()
      if (!row) return err(`Encounter not found: ${a.id}`)
      return ok({ success: true, actionType: 'get_state', encounterId: a.id, round: (row as any).round, activeTokenId: (row as any).active_token_id, status: (row as any).status, tokens: parseTokens((row as any).tokens), tokenCount: parseTokens((row as any).tokens).length })
    }
    case 'death_save': {
      if (!a.characterId) return err('"characterId" is required')
      const char = await db.prepare('SELECT hp, resource_pools FROM characters WHERE id = ?').bind(a.characterId).first() as { hp: number; resource_pools: string } | null
      if (!char) return err(`Character not found: ${a.characterId}`)
      if (char.hp > 0) return err('Death saves only apply to a character at 0 HP')
      const pools = char.resource_pools ? JSON.parse(char.resource_pools) : {}
      const deathSaves = pools.death_saves ?? { successes: 0, failures: 0 }
      const roll = a.saveRoll ?? Math.floor(Math.random() * 20) + 1

      let status: 'stable' | 'dying' | 'dead' | 'revived'
      if (roll === 20) {
        status = 'revived'
        pools.death_saves = { successes: 0, failures: 0 }
        await db.prepare('UPDATE characters SET hp = 1, resource_pools = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(pools), now, a.characterId).run()
        return ok({ success: true, actionType: 'death_save', characterId: a.characterId, roll, status, hp: 1 })
      }
      if (roll === 1) deathSaves.failures += 2
      else if (roll >= 10) deathSaves.successes += 1
      else deathSaves.failures += 1

      if (deathSaves.failures >= 3) { status = 'dead'; pools.death_saves = { successes: 0, failures: 0 } }
      else if (deathSaves.successes >= 3) { status = 'stable'; pools.death_saves = { successes: 0, failures: 0 } }
      else { status = 'dying'; pools.death_saves = deathSaves }

      await db.prepare('UPDATE characters SET resource_pools = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(pools), now, a.characterId).run()
      return ok({ success: true, actionType: 'death_save', characterId: a.characterId, roll, status, successes: deathSaves.successes, failures: deathSaves.failures })
    }
    case 'legendary_action': {
      if (!a.characterId) return err('"characterId" is required')
      const char = await db.prepare('SELECT legendary_actions, legendary_actions_remaining FROM characters WHERE id = ?').bind(a.characterId).first() as { legendary_actions: number | null; legendary_actions_remaining: number | null } | null
      if (!char) return err(`Character not found: ${a.characterId}`)
      if (!char.legendary_actions) return err(`Character ${a.characterId} has no legendary actions`)
      const remaining = char.legendary_actions_remaining ?? char.legendary_actions
      if (remaining < a.cost) return err(`Not enough legendary actions remaining (has ${remaining}, needs ${a.cost})`)
      const newRemaining = remaining - a.cost
      await db.prepare('UPDATE characters SET legendary_actions_remaining = ?, updated_at = ? WHERE id = ?').bind(newRemaining, now, a.characterId).run()
      if (a.encounterId) {
        await db.prepare('INSERT INTO combat_action_log (encounter_id, round, turn_index, actor_id, actor_name, action_type, result_summary, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(a.encounterId, 0, 0, a.characterId, a.characterId, 'legendary_action', a.actionName ?? 'Legendary action', now).run()
      }
      return ok({ success: true, actionType: 'legendary_action', characterId: a.characterId, actionName: a.actionName ?? null, cost: a.cost, remaining: newRemaining })
    }
    case 'lair_action': {
      if (!a.characterId) return err('"characterId" is required')
      const char = await db.prepare('SELECT has_lair_actions FROM characters WHERE id = ?').bind(a.characterId).first() as { has_lair_actions: number | null } | null
      if (!char) return err(`Character not found: ${a.characterId}`)
      if (!char.has_lair_actions) return err(`Character ${a.characterId} does not have lair actions`)
      if (a.encounterId) {
        await db.prepare('INSERT INTO combat_action_log (encounter_id, round, turn_index, actor_id, actor_name, action_type, result_summary, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(a.encounterId, 0, 0, a.characterId, a.characterId, 'lair_action', a.actionName ?? 'Lair action triggered', now).run()
      }
      return ok({ success: true, actionType: 'lair_action', characterId: a.characterId, actionName: a.actionName ?? null, note: 'Lair action triggered at initiative count 20 — narrate its effect; no automatic mechanical effect is applied.' })
    }
  }
}
