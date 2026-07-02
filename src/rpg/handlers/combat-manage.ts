// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/combat-manage.ts
// Complex AI/combat-engine calls simplified to D1 CRUD.

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError, CRUD_ALIASES } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['create_encounter', 'get_encounter', 'list_encounters', 'add_combatant', 'remove_combatant', 'start', 'end', 'next_turn', 'get_state'] as const
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
      if (a.regionId) {
        const region = await db.prepare('SELECT id FROM regions WHERE id = ?').bind(a.regionId).first()
        if (!region) return err(`"regionId" "${a.regionId}" does not exist in the regions table. Omit "regionId" to create an unattached encounter, or create the region first.`)
      }
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
  }
}
