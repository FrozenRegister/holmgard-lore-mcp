// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/strategy-manage.ts
// Complex engine (DiplomacyEngine, TurnProcessor, FogOfWar) replaced with direct D1 ops.

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

export const ACTIONS = ['create_nation', 'get_state', 'propose_alliance', 'claim_region', 'resolve_turn', 'list_nations'] as const
type StrategyAction = typeof ACTIONS[number]
const ALIASES: Record<string, StrategyAction> = {
  nation: 'create_nation', new_nation: 'create_nation', found_nation: 'create_nation',
  state: 'get_state', info: 'get_state', status: 'get_state',
  alliance: 'propose_alliance', ally: 'propose_alliance',
  claim: 'claim_region', take_region: 'claim_region',
  turn: 'resolve_turn', process_turn: 'resolve_turn', advance_turn: 'resolve_turn',
  nations: 'list_nations', all_nations: 'list_nations',
}

const InputSchema = z.object({
  action: z.string(),
  worldId: z.string().optional(),
  nationId: z.string().optional(),
  name: z.string().optional(),
  leader: z.string().optional(),
  ideology: z.enum(['democracy', 'autocracy', 'theocracy', 'tribal']).optional(),
  aggression: z.number().min(0).max(100).optional().default(50),
  trust: z.number().min(0).max(100).optional().default(50),
  paranoia: z.number().min(0).max(100).optional().default(50),
  startingResources: z.object({ food: z.number().default(100), metal: z.number().default(50), oil: z.number().default(10) }).optional(),
  viewType: z.enum(['public', 'private', 'fog_of_war']).optional().default('public'),
  fromNationId: z.string().optional(),
  toNationId: z.string().optional(),
  regionId: z.string().optional(),
  justification: z.string().optional(),
  turnNumber: z.number().int().optional(),
})

export async function handleStrategyManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'create_nation': {
      if (!a.worldId || !a.name || !a.leader || !a.ideology) return err('"worldId", "name", "leader", and "ideology" are required')
      const world = await db.prepare('SELECT id FROM worlds WHERE id = ?').bind(a.worldId).first()
      if (!world) return err(`World not found: ${a.worldId}. Create the world first with world_manage {action:"create"}.`)
      const id = crypto.randomUUID()
      const resources = a.startingResources ?? { food: 100, metal: 50, oil: 10 }
      await db.prepare('INSERT INTO nations (id, world_id, name, leader, ideology, aggression, trust, paranoia, gdp, resources, relations, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, a.worldId, a.name, a.leader, a.ideology, a.aggression, a.trust, a.paranoia, 1000, JSON.stringify(resources), '{}', now, now).run()
      return ok({ success: true, actionType: 'create_nation', nationId: id, name: a.name, worldId: a.worldId, leader: a.leader, ideology: a.ideology })
    }
    case 'get_state': {
      if (!a.nationId) return err('"nationId" is required')
      const nation = await db.prepare('SELECT * FROM nations WHERE id = ?').bind(a.nationId).first()
      if (!nation) return err(`Nation not found: ${a.nationId}`)
      const base = { ...(nation as Record<string, unknown>), resources: JSON.parse((nation as any).resources ?? '{}'), relations: JSON.parse((nation as any).relations ?? '{}') }
      if (a.viewType === 'public') {
        const publicView = Object.fromEntries(Object.entries(base as Record<string, unknown>).filter(([k]) => k !== 'private_memory'))
        return ok({ success: true, actionType: 'get_state', viewType: 'public', nation: publicView })
      }
      const { results: claims } = await db.prepare('SELECT * FROM territorial_claims WHERE nation_id = ?').bind(a.nationId).all()
      const { results: diplomacy } = await db.prepare('SELECT * FROM diplomatic_relations WHERE from_nation_id = ? OR to_nation_id = ?').bind(a.nationId, a.nationId).all()
      return ok({ success: true, actionType: 'get_state', viewType: a.viewType, nation: base, claims, diplomacy })
    }
    case 'propose_alliance': {
      if (!a.fromNationId || !a.toNationId) return err('"fromNationId" and "toNationId" are required')
      await db.prepare('INSERT OR REPLACE INTO diplomatic_relations (from_nation_id, to_nation_id, opinion, is_allied, updated_at) VALUES (?, ?, ?, ?, ?)').bind(a.fromNationId, a.toNationId, 50, 1, now).run()
      await db.prepare('INSERT OR REPLACE INTO diplomatic_relations (from_nation_id, to_nation_id, opinion, is_allied, updated_at) VALUES (?, ?, ?, ?, ?)').bind(a.toNationId, a.fromNationId, 50, 1, now).run()
      return ok({ success: true, actionType: 'propose_alliance', fromNationId: a.fromNationId, toNationId: a.toNationId, allied: true })
    }
    case 'claim_region': {
      if (!a.nationId || !a.regionId) return err('"nationId" and "regionId" are required')
      const id = crypto.randomUUID()
      await db.prepare('INSERT INTO territorial_claims (id, nation_id, region_id, claim_strength, justification, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, a.nationId, a.regionId, 50, a.justification ?? null, now).run()
      await db.prepare('UPDATE regions SET owner_nation_id = ?, updated_at = ? WHERE id = ?').bind(a.nationId, now, a.regionId).run()
      return ok({ success: true, actionType: 'claim_region', claimId: id, nationId: a.nationId, regionId: a.regionId })
    }
    case 'resolve_turn': {
      if (!a.worldId || a.turnNumber === undefined) return err('"worldId" and "turnNumber" are required')
      const ts = await db.prepare('SELECT * FROM turn_state WHERE world_id = ?').bind(a.worldId).first() as Record<string, unknown> | null
      if (!ts) return err(`No turn state for world ${a.worldId}. Call turn_manage {action:"init"} first.`)
      const newTurn = a.turnNumber + 1
      await db.prepare("UPDATE turn_state SET current_turn = ?, turn_phase = 'planning', updated_at = ? WHERE world_id = ?").bind(newTurn, now, a.worldId).run()
      return ok({ success: true, actionType: 'resolve_turn', worldId: a.worldId, resolvedTurn: a.turnNumber, newTurn })
    }
    case 'list_nations': {
      if (!a.worldId) return err('"worldId" is required')
      const { results } = await db.prepare('SELECT id, name, leader, ideology, aggression, trust, gdp FROM nations WHERE world_id = ? ORDER BY name').bind(a.worldId).all()
      return ok({ success: true, actionType: 'list_nations', worldId: a.worldId, nations: results, count: results.length })
    }
  }
}
