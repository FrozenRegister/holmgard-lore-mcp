// Creature AI state registry (#445, #440 Phase 3) — CRUD for the per-world
// creature_ai_state table that the creature_ai_tick hook reads each tick.
//
// Follows the exact shape of biome-manage.ts / zone-type-manage.ts: fuzzy-enum
// action matching, ok/err envelopes, Zod input validation. The autonomous
// behaviour itself lives in src/rpg/utils/creature-ai.ts and is driven by the
// tick hook in tick-hooks.ts — this handler is purely the state store's CRUD
// surface plus a `place` action for repositioning a creature on the hex map.

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError, CRUD_ALIASES } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

// The four predator taxonomies. feral + shaper have live tick logic (#445);
// parasitic + environmental are documented no-op stubs (later phase).
export const TAXONOMIES = ['feral', 'shaper', 'parasitic', 'environmental'] as const
type PredatorTaxonomy = (typeof TAXONOMIES)[number]

// Activity windows gating whether a creature acts on a given tick (#440 §3.6).
export const ACTIVITY_PATTERNS = ['nocturnal', 'diurnal', 'crepuscular', 'always'] as const
type ActivityPattern = (typeof ACTIVITY_PATTERNS)[number]

export const ACTIONS = ['register', 'list', 'get', 'update', 'delete', 'place'] as const
type CreatureManageAction = (typeof ACTIONS)[number]
const ALIASES: Record<string, CreatureManageAction> = {
  ...CRUD_ALIASES,
  register: 'register',
  spawn: 'register',
  move: 'place',
  reposition: 'place',
  place_creature: 'place',
} as Record<string, CreatureManageAction>

const UNIT = z.number().min(0).max(1)

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  creatureId: z.string().optional(),
  worldId: z.string().optional(),
  creatureKey: z.string().optional(),
  predatorTaxonomy: z.enum(TAXONOMIES).optional(),
  homeNestQ: z.number().int().optional(),
  homeNestR: z.number().int().optional(),
  territoryRadius: z.number().int().min(0).optional(),
  hunger: z.number().int().min(0).max(100).optional(),
  creativeDrive: z.number().int().min(0).max(100).optional(),
  aggression: UNIT.optional(),
  activityPattern: z.enum(ACTIVITY_PATTERNS).optional(),
  movementSpeed: z.number().int().min(0).optional(),
  stealth: UNIT.optional(),
  perception: UNIT.optional(),
  currentState: z.string().optional(),
  currentHexQ: z.number().int().optional(),
  currentHexR: z.number().int().optional(),
  targetHexQ: z.number().int().optional(),
  targetHexR: z.number().int().optional(),
  atelierHexQ: z.number().int().optional(),
  atelierHexR: z.number().int().optional(),
  yieldPreference: z.string().optional(),
  // place action
  q: z.number().int().optional(),
  r: z.number().int().optional(),
  // list
  limit: z.number().int().min(1).max(500).optional(),
})

export async function handleCreatureManage(
  env: AppBindings,
  args: Record<string, unknown>,
): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map((i) => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'register': {
      if (!a.worldId || !a.creatureKey) return err('"worldId" and "creatureKey" are required')
      const world = await db.prepare('SELECT id FROM worlds WHERE id = ?').bind(a.worldId).first()
      if (!world) return err(`World not found: ${a.worldId}`)
      const existing = await db
        .prepare('SELECT id FROM creature_ai_state WHERE world_id = ? AND creature_key = ?')
        .bind(a.worldId, a.creatureKey)
        .first()
      if (existing) return err(`Creature "${a.creatureKey}" already registered for this world`)

      const id = crypto.randomUUID()
      const taxonomy: PredatorTaxonomy = a.predatorTaxonomy ?? 'feral'
      const currentState = a.currentState ?? 'patrolling'
      const activityPattern: ActivityPattern = a.activityPattern ?? 'always'
      await db
        .prepare(
          `INSERT INTO creature_ai_state (
             id, world_id, creature_key, predator_taxonomy,
             home_nest_q, home_nest_r, territory_radius, hunger, creative_drive,
             aggression, activity_pattern, movement_speed, stealth, perception,
             current_state, current_hex_q, current_hex_r, target_hex_q, target_hex_r,
             atelier_hex_q, atelier_hex_r, yield_preference, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          a.worldId,
          a.creatureKey,
          taxonomy,
          a.homeNestQ ?? null,
          a.homeNestR ?? null,
          a.territoryRadius ?? null,
          a.hunger ?? 0,
          a.creativeDrive ?? 0,
          a.aggression ?? null,
          activityPattern,
          a.movementSpeed ?? null,
          a.stealth ?? null,
          a.perception ?? null,
          currentState,
          a.currentHexQ ?? null,
          a.currentHexR ?? null,
          a.targetHexQ ?? null,
          a.targetHexR ?? null,
          a.atelierHexQ ?? null,
          a.atelierHexR ?? null,
          a.yieldPreference ?? null,
          now,
          now,
        )
        .run()
      return ok({
        success: true,
        actionType: 'register',
        creatureId: id,
        worldId: a.worldId,
        creatureKey: a.creatureKey,
        predatorTaxonomy: taxonomy,
        currentState,
        activityPattern,
      })
    }
    case 'list': {
      if (!a.worldId) return err('"worldId" is required')
      const { results } = await db
        .prepare(
          `SELECT id, creature_key, predator_taxonomy, current_state, hunger, creative_drive,
                  current_hex_q, current_hex_r, target_hex_q, target_hex_r
           FROM creature_ai_state WHERE world_id = ? ORDER BY creature_key LIMIT ?`,
        )
        .bind(a.worldId, a.limit ?? 100)
        .all()
      return ok({
        success: true,
        actionType: 'list',
        worldId: a.worldId,
        creatures: results,
        count: results.length,
      })
    }
    case 'get': {
      const targetId = a.id ?? a.creatureId
      if (!targetId && !(a.worldId && a.creatureKey))
        return err('"id"/"creatureId", or "worldId" + "creatureKey", is required')
      const row = targetId
        ? await db.prepare('SELECT * FROM creature_ai_state WHERE id = ?').bind(targetId).first()
        : await db
            .prepare('SELECT * FROM creature_ai_state WHERE world_id = ? AND creature_key = ?')
            .bind(a.worldId, a.creatureKey)
            .first()
      if (!row) return err('Creature not found')
      return ok({ success: true, actionType: 'get', creature: row })
    }
    case 'update': {
      const targetId = a.id ?? a.creatureId
      if (!targetId) return err('"id" or "creatureId" is required')
      const existing = await db
        .prepare('SELECT id FROM creature_ai_state WHERE id = ?')
        .bind(targetId)
        .first()
      if (!existing) return err(`Creature not found: ${targetId}`)

      const sets: string[] = ['updated_at = ?']
      const vals: unknown[] = [now]
      const setCol = (col: string, value: unknown) => {
        sets.push(`${col} = ?`)
        vals.push(value)
      }
      if (a.predatorTaxonomy !== undefined) setCol('predator_taxonomy', a.predatorTaxonomy)
      if (a.homeNestQ !== undefined) setCol('home_nest_q', a.homeNestQ)
      if (a.homeNestR !== undefined) setCol('home_nest_r', a.homeNestR)
      if (a.territoryRadius !== undefined) setCol('territory_radius', a.territoryRadius)
      if (a.hunger !== undefined) setCol('hunger', a.hunger)
      if (a.creativeDrive !== undefined) setCol('creative_drive', a.creativeDrive)
      if (a.aggression !== undefined) setCol('aggression', a.aggression)
      if (a.activityPattern !== undefined) setCol('activity_pattern', a.activityPattern)
      if (a.movementSpeed !== undefined) setCol('movement_speed', a.movementSpeed)
      if (a.stealth !== undefined) setCol('stealth', a.stealth)
      if (a.perception !== undefined) setCol('perception', a.perception)
      if (a.currentState !== undefined) setCol('current_state', a.currentState)
      if (a.currentHexQ !== undefined) setCol('current_hex_q', a.currentHexQ)
      if (a.currentHexR !== undefined) setCol('current_hex_r', a.currentHexR)
      if (a.targetHexQ !== undefined) setCol('target_hex_q', a.targetHexQ)
      if (a.targetHexR !== undefined) setCol('target_hex_r', a.targetHexR)
      if (a.atelierHexQ !== undefined) setCol('atelier_hex_q', a.atelierHexQ)
      if (a.atelierHexR !== undefined) setCol('atelier_hex_r', a.atelierHexR)
      if (a.yieldPreference !== undefined) setCol('yield_preference', a.yieldPreference)

      vals.push(targetId)
      await db
        .prepare(`UPDATE creature_ai_state SET ${sets.join(', ')} WHERE id = ?`)
        .bind(...vals)
        .run()
      return ok({ success: true, actionType: 'update', creatureId: targetId })
    }
    case 'delete': {
      const targetId = a.id ?? a.creatureId
      if (!targetId) return err('"id" or "creatureId" is required')
      const creature = await db
        .prepare('SELECT id FROM creature_ai_state WHERE id = ?')
        .bind(targetId)
        .first()
      if (!creature) return err(`Creature not found: ${targetId}`)
      await db.prepare('DELETE FROM creature_ai_state WHERE id = ?').bind(targetId).run()
      return ok({ success: true, actionType: 'delete', creatureId: targetId })
    }
    case 'place': {
      const targetId = a.id ?? a.creatureId
      if (!targetId) return err('"id" or "creatureId" is required')
      if (a.q === undefined || a.r === undefined) return err('"q" and "r" are required')
      const creature = await db
        .prepare('SELECT id, creature_key FROM creature_ai_state WHERE id = ?')
        .bind(targetId)
        .first<{ id: string; creature_key: string }>()
      if (!creature) return err(`Creature not found: ${targetId}`)
      await db
        .prepare(
          'UPDATE creature_ai_state SET current_hex_q = ?, current_hex_r = ?, updated_at = ? WHERE id = ?',
        )
        .bind(a.q, a.r, now, targetId)
        .run()
      return ok({
        success: true,
        actionType: 'place',
        creatureId: targetId,
        creatureKey: creature.creature_key,
        q: a.q,
        r: a.r,
      })
    }
  }
}
