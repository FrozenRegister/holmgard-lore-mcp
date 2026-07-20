// Dynamic per-world zone-type registry (#320 follow-up) — replaces the
// hardcoded 4-entry ZONE_GLYPHS map in world-map.ts's preview action.
// Mirrors biome-manage.ts's exact pattern: each world registers whatever
// zone types its narrative needs, seeded with sensible defaults on world
// creation, without a source change + redeploy.

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError, CRUD_ALIASES, similarity } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

export const ACTIONS = ['register', 'list', 'get', 'update', 'delete', 'validate', 'seed_defaults'] as const
type ZoneTypeManageAction = typeof ACTIONS[number]
const ALIASES: Record<string, ZoneTypeManageAction> = {
  ...CRUD_ALIASES,
  register: 'register', check: 'validate', seed: 'seed_defaults', seed_default: 'seed_defaults',
} as Record<string, ZoneTypeManageAction>

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const NAME_PATTERN = /^[a-z][a-z0-9_]*$/

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  zoneTypeId: z.string().optional(),
  worldId: z.string().optional(),
  name: z.string().optional(),
  glyph: z.string().nullable().optional(),
  colorHex: z.string().nullable().optional(),
  description: z.string().optional(),
})

// The 4 zone types previously hardcoded in world_map.ts's ZONE_GLYPHS map,
// plus 'broadcast' (previously deliberately excluded from that map — a
// null glyph here reproduces the same "no overlay rendered" behavior).
// Seeded automatically for every newly-created world (world_manage.create/
// generate) so existing behavior is preserved by default; pre-existing
// worlds can opt in via seed_defaults.
export const DEFAULT_ZONE_TYPES: ReadonlyArray<{ name: string; glyph: string | null; colorHex: string | null }> = [
  { name: 'perimeter', glyph: '⚡', colorHex: null },
  { name: 'exclusion', glyph: '#', colorHex: null },
  { name: 'hazard', glyph: '!', colorHex: null },
  { name: 'territory', glyph: '@', colorHex: null },
  { name: 'broadcast', glyph: null, colorHex: null },
]

/** Idempotent — only inserts zone types not already registered for this world. Returns count actually inserted. */
export async function seedDefaultZoneTypes(db: D1Database, worldId: string): Promise<number> {
  const now = new Date().toISOString()
  const { results: existingRows } = await db.prepare('SELECT name FROM zone_types WHERE world_id = ?').bind(worldId).all() as { results: Array<{ name: string }> }
  const existing = new Set(existingRows.map(r => r.name))
  let seeded = 0
  for (const z of DEFAULT_ZONE_TYPES) {
    if (existing.has(z.name)) continue
    await db.prepare('INSERT INTO zone_types (id, world_id, name, glyph, color_hex, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), worldId, z.name, z.glyph, z.colorHex, null, now, now).run()
    seeded++
  }
  return seeded
}

/** Used by world_map.ts's preview action. A world with zero registered zone types is treated as unrestricted (backward compatible — no overlay glyphs render). */
export async function getZoneTypeRegistry(db: D1Database, worldId: string): Promise<Map<string, { glyph: string | null; colorHex: string | null }>> {
  const { results } = await db.prepare('SELECT name, glyph, color_hex FROM zone_types WHERE world_id = ?').bind(worldId).all() as
    { results: Array<{ name: string; glyph: string | null; color_hex: string | null }> }
  return new Map(results.map(r => [r.name, { glyph: r.glyph, colorHex: r.color_hex }]))
}

export async function handleZoneTypeManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'register': {
      if (!a.worldId || !a.name) return err('"worldId" and "name" are required')
      if (!NAME_PATTERN.test(a.name)) return err('"name" must be lowercase, start with a letter, and contain only letters/digits/underscore')
      const world = await db.prepare('SELECT id FROM worlds WHERE id = ?').bind(a.worldId).first()
      if (!world) return err(`World not found: ${a.worldId}`)
      const glyph = a.glyph ?? null
      if (glyph !== null && [...glyph].length !== 1) return err('"glyph" must be exactly 1 character, or null for no overlay')
      const colorHex = a.colorHex ?? null
      if (colorHex !== null && !HEX_COLOR.test(colorHex)) return err('"colorHex" must be a 6-digit hex color like #A1B2C3, or null')
      const existing = await db.prepare('SELECT id FROM zone_types WHERE world_id = ? AND name = ?').bind(a.worldId, a.name).first()
      if (existing) return err(`Zone type "${a.name}" already exists for this world`)
      const id = crypto.randomUUID()
      await db.prepare('INSERT INTO zone_types (id, world_id, name, glyph, color_hex, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, a.worldId, a.name, glyph, colorHex, a.description ?? null, now, now).run()
      return ok({ success: true, actionType: 'register', zoneTypeId: id, worldId: a.worldId, name: a.name, glyph, colorHex })
    }
    case 'list': {
      if (!a.worldId) return err('"worldId" is required')
      const { results } = await db.prepare('SELECT id, name, glyph, color_hex, description FROM zone_types WHERE world_id = ? ORDER BY name').bind(a.worldId).all()
      return ok({ success: true, actionType: 'list', worldId: a.worldId, zoneTypes: results, count: results.length })
    }
    case 'get': {
      const targetId = a.id ?? a.zoneTypeId
      if (!targetId && !(a.worldId && a.name)) return err('"id"/"zoneTypeId", or "worldId" + "name", is required')
      const row = targetId
        ? await db.prepare('SELECT * FROM zone_types WHERE id = ?').bind(targetId).first()
        : await db.prepare('SELECT * FROM zone_types WHERE world_id = ? AND name = ?').bind(a.worldId, a.name).first()
      if (!row) return err('Zone type not found')
      return ok({ success: true, actionType: 'get', zoneType: row })
    }
    case 'update': {
      const targetId = a.id ?? a.zoneTypeId
      if (!targetId) return err('"id" or "zoneTypeId" is required')
      const existing = await db.prepare('SELECT id FROM zone_types WHERE id = ?').bind(targetId).first()
      if (!existing) return err(`Zone type not found: ${targetId}`)
      const sets: string[] = ['updated_at = ?']
      const vals: unknown[] = [now]
      if (a.glyph !== undefined) {
        if (a.glyph !== null && [...a.glyph].length !== 1) return err('"glyph" must be exactly 1 character, or null for no overlay')
        sets.push('glyph = ?'); vals.push(a.glyph)
      }
      if (a.colorHex !== undefined) {
        if (a.colorHex !== null && !HEX_COLOR.test(a.colorHex)) return err('"colorHex" must be a 6-digit hex color like #A1B2C3, or null')
        sets.push('color_hex = ?'); vals.push(a.colorHex)
      }
      if (a.description !== undefined) { sets.push('description = ?'); vals.push(a.description) }
      vals.push(targetId)
      await db.prepare(`UPDATE zone_types SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
      return ok({ success: true, actionType: 'update', zoneTypeId: targetId })
    }
    case 'delete': {
      const targetId = a.id ?? a.zoneTypeId
      if (!targetId) return err('"id" or "zoneTypeId" is required')
      const zoneType = await db.prepare('SELECT world_id, name FROM zone_types WHERE id = ?').bind(targetId).first() as { world_id: string; name: string } | null
      if (!zoneType) return err(`Zone type not found: ${targetId}`)
      const landmarkRef = await db.prepare('SELECT 1 FROM landmarks WHERE world_id = ? AND zone_type = ? LIMIT 1').bind(zoneType.world_id, zoneType.name).first()
      if (landmarkRef) return err(`Cannot delete zone type "${zoneType.name}" — referenced by existing landmarks in this world`)
      await db.prepare('DELETE FROM zone_types WHERE id = ?').bind(targetId).run()
      return ok({ success: true, actionType: 'delete', zoneTypeId: targetId })
    }
    case 'validate': {
      if (!a.worldId || !a.name) return err('"worldId" and "name" are required')
      const row = await db.prepare('SELECT id FROM zone_types WHERE world_id = ? AND name = ?').bind(a.worldId, a.name).first()
      if (row) return ok({ success: true, actionType: 'validate', worldId: a.worldId, name: a.name, valid: true })
      const { results } = await db.prepare('SELECT name FROM zone_types WHERE world_id = ?').bind(a.worldId).all() as { results: Array<{ name: string }> }
      const scored = results
        .map(r => ({ name: r.name, similarity: similarity(a.name!, r.name) }))
        .sort((x, y) => y.similarity - x.similarity)
      const didYouMean = scored.filter(s => s.similarity >= 0.5).slice(0, 3).map(s => s.name)
      return ok({ success: true, actionType: 'validate', worldId: a.worldId, name: a.name, valid: false, didYouMean })
    }
    case 'seed_defaults': {
      if (!a.worldId) return err('"worldId" is required')
      const world = await db.prepare('SELECT id FROM worlds WHERE id = ?').bind(a.worldId).first()
      if (!world) return err(`World not found: ${a.worldId}`)
      const seeded = await seedDefaultZoneTypes(db, a.worldId)
      return ok({ success: true, actionType: 'seed_defaults', worldId: a.worldId, seeded, totalDefaults: DEFAULT_ZONE_TYPES.length })
    }
  }
}
