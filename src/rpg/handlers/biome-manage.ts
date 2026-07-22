// Dynamic per-world biome registry (#274) — replaces the hardcoded biome
// glyph map in world_map.ts's preview action and the unvalidated free-string
// biome field on world_map.ts's patch action. Each world registers whatever
// biomes its narrative needs (e.g. Gotland's limestone_karst, bog, sea_cliff)
// without a source change + redeploy.
//
// Deliberately NOT integrated with spatial_manage/room_nodes yet — see the
// note in migration 0010 for why (room_nodes.biome_context is a DB-level
// CHECK constraint with no world_id column to scope against).

import { z } from 'zod'
import {
  matchAction,
  isGuidingError,
  formatGuidingError,
  CRUD_ALIASES,
  similarity,
} from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const CATEGORIES = [
  'terrain',
  'aquatic',
  'urban',
  'hazard',
  'magical',
  'coastal',
  'subterranean',
  'void',
  'custom',
] as const
type BiomeCategory = (typeof CATEGORIES)[number]

export const ACTIONS = [
  'register',
  'list',
  'get',
  'update',
  'delete',
  'validate',
  'seed_defaults',
] as const
type BiomeManageAction = (typeof ACTIONS)[number]
const ALIASES: Record<string, BiomeManageAction> = {
  ...CRUD_ALIASES,
  register: 'register',
  check: 'validate',
  seed: 'seed_defaults',
  seed_default: 'seed_defaults',
} as Record<string, BiomeManageAction>

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const NAME_PATTERN = /^[a-z][a-z0-9_]*$/

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  biomeId: z.string().optional(),
  worldId: z.string().optional(),
  name: z.string().optional(),
  glyph: z.string().optional(),
  category: z.enum(CATEGORIES).optional(),
  colorHex: z.string().optional(),
  movementCost: z.number().min(0).optional(),
  // #280 — baseline threat contribution ("biome_base" in encounter.resolve's
  // formula). Defaults to 0 so every existing biome is unaffected until a
  // narrator opts in.
  baseThreat: z.number().min(0).max(100).optional(),
  description: z.string().optional(),
  // #429 — per-travel-mode cost overrides, same semantics as movementCost
  // (higher = slower, 0 = impassable). A mode absent from this object falls
  // back to movementCost — every existing biome/world is unaffected until a
  // narrator opts a mode in. On `update`, this is shallow-merged into the
  // existing object (one mode can be set without clobbering the others).
  modeCosts: z.record(z.string(), z.number().min(0)).optional(),
})

// The 15 biomes previously hardcoded across world_map.ts's BIOME_GLYPHS map
// (9) and spatial-manage.ts's BIOMES enum (8), unioned and deduplicated
// ('forest'/'mountain' appeared in both). Seeded automatically for every
// newly-created world (world_manage.create/generate) so existing behavior
// is preserved by default; pre-existing worlds can opt in via seed_defaults.
export const DEFAULT_BIOMES: ReadonlyArray<{
  name: string
  glyph: string
  category: BiomeCategory
  colorHex: string
  movementCost: number
}> = [
  { name: 'grass', glyph: '.', category: 'terrain', colorHex: '#8B9A46', movementCost: 1.0 },
  { name: 'forest', glyph: 'T', category: 'terrain', colorHex: '#1A472A', movementCost: 1.5 },
  { name: 'mountain', glyph: 'M', category: 'terrain', colorHex: '#808080', movementCost: 3.0 },
  { name: 'water', glyph: '~', category: 'aquatic', colorHex: '#1A5276', movementCost: 0.0 },
  { name: 'desert', glyph: 'd', category: 'terrain', colorHex: '#EDC9AF', movementCost: 1.5 },
  { name: 'swamp', glyph: 'S', category: 'terrain', colorHex: '#3D5724', movementCost: 2.0 },
  { name: 'plains', glyph: ',', category: 'terrain', colorHex: '#C2B280', movementCost: 1.0 },
  { name: 'tundra', glyph: '_', category: 'terrain', colorHex: '#D6E5E3', movementCost: 1.5 },
  { name: 'wasteland', glyph: 'X', category: 'hazard', colorHex: '#5C4033', movementCost: 2.0 },
  { name: 'coastal', glyph: '≈', category: 'coastal', colorHex: '#2980B9', movementCost: 1.0 },
  { name: 'urban', glyph: 'U', category: 'urban', colorHex: '#999999', movementCost: 1.0 },
  { name: 'dungeon', glyph: 'D', category: 'subterranean', colorHex: '#4A4A4A', movementCost: 1.0 },
  { name: 'cavern', glyph: 'C', category: 'subterranean', colorHex: '#3A3A3A', movementCost: 1.5 },
  { name: 'divine', glyph: '^', category: 'magical', colorHex: '#FFD700', movementCost: 1.0 },
  { name: 'arcane', glyph: '*', category: 'magical', colorHex: '#8E44AD', movementCost: 1.0 },
]

/** Idempotent — only inserts biomes not already registered for this world. Returns count actually inserted. */
export async function seedDefaultBiomes(db: D1Database, worldId: string): Promise<number> {
  const now = new Date().toISOString()
  const { results: existingRows } = (await db
    .prepare('SELECT name FROM biomes WHERE world_id = ?')
    .bind(worldId)
    .all()) as { results: Array<{ name: string }> }
  const existing = new Set(existingRows.map((r) => r.name))
  let seeded = 0
  for (const b of DEFAULT_BIOMES) {
    if (existing.has(b.name)) continue
    await db
      .prepare(
        'INSERT INTO biomes (id, world_id, name, glyph, category, color_hex, movement_cost, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        crypto.randomUUID(),
        worldId,
        b.name,
        b.glyph,
        b.category,
        b.colorHex,
        b.movementCost,
        null,
        now,
        now,
      )
      .run()
    seeded++
  }
  return seeded
}

/** Used by world_map.ts and encounter-manage.ts. A world with zero registered biomes is treated as unrestricted (backward compatible). */
export async function getBiomeRegistry(
  db: D1Database,
  worldId: string,
): Promise<
  Map<
    string,
    {
      glyph: string
      colorHex: string
      movementCost: number
      baseThreat: number
      modeCosts: Record<string, number>
    }
  >
> {
  const { results } = (await db
    .prepare(
      'SELECT name, glyph, color_hex, movement_cost, base_threat, mode_costs FROM biomes WHERE world_id = ?',
    )
    .bind(worldId)
    .all()) as {
    results: Array<{
      name: string
      glyph: string
      color_hex: string
      movement_cost: number
      base_threat: number
      mode_costs: string
    }>
  }
  return new Map(
    results.map((r) => [
      r.name,
      {
        glyph: r.glyph,
        colorHex: r.color_hex,
        movementCost: r.movement_cost,
        baseThreat: r.base_threat,
        modeCosts: parseModeCosts(r.mode_costs),
      },
    ]),
  )
}

// mode_costs is NOT NULL DEFAULT '{}' at the schema level — the only failure
// mode this guards against is direct DB corruption (malformed JSON), not a
// missing/null value.
function parseModeCosts(raw: string): Record<string, number> {
  try {
    return JSON.parse(raw) as Record<string, number>
  } catch {
    return {}
  }
}

// #429 — a mode absent from a biome's mode_costs falls back to movementCost
// (the pre-existing, mode-agnostic cost). Shared by travel-manage.ts (move_hex
// passability) and world-map.ts (distance/pathfind terrain cost).
export function effectiveMovementCost(
  entry: { movementCost: number; modeCosts: Record<string, number> } | undefined,
  mode: string,
): number {
  if (!entry) return 1.0
  return entry.modeCosts[mode] ?? entry.movementCost
}

export async function handleBiomeManage(
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
      if (!a.worldId || !a.name) return err('"worldId" and "name" are required')
      if (!NAME_PATTERN.test(a.name))
        return err(
          '"name" must be lowercase, start with a letter, and contain only letters/digits/underscore',
        )
      const world = await db.prepare('SELECT id FROM worlds WHERE id = ?').bind(a.worldId).first()
      if (!world) return err(`World not found: ${a.worldId}`)
      const glyph = a.glyph ?? '?'
      if ([...glyph].length !== 1) return err('"glyph" must be exactly 1 character')
      const colorHex = a.colorHex ?? '#888888'
      if (!HEX_COLOR.test(colorHex))
        return err('"colorHex" must be a 6-digit hex color like #A1B2C3')
      const movementCost = a.movementCost ?? 1.0
      const category = a.category ?? 'terrain'
      const baseThreat = a.baseThreat ?? 0
      const modeCosts = a.modeCosts ?? {}
      const existing = await db
        .prepare('SELECT id FROM biomes WHERE world_id = ? AND name = ?')
        .bind(a.worldId, a.name)
        .first()
      if (existing) return err(`Biome "${a.name}" already exists for this world`)
      const id = crypto.randomUUID()
      await db
        .prepare(
          'INSERT INTO biomes (id, world_id, name, glyph, category, color_hex, movement_cost, base_threat, mode_costs, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          id,
          a.worldId,
          a.name,
          glyph,
          category,
          colorHex,
          movementCost,
          baseThreat,
          JSON.stringify(modeCosts),
          a.description ?? null,
          now,
          now,
        )
        .run()
      return ok({
        success: true,
        actionType: 'register',
        biomeId: id,
        worldId: a.worldId,
        name: a.name,
        glyph,
        category,
        colorHex,
        movementCost,
        baseThreat,
        modeCosts,
      })
    }
    case 'list': {
      if (!a.worldId) return err('"worldId" is required')
      const { results } = await db
        .prepare(
          'SELECT id, name, glyph, category, color_hex, movement_cost, base_threat, description FROM biomes WHERE world_id = ? ORDER BY name',
        )
        .bind(a.worldId)
        .all()
      return ok({
        success: true,
        actionType: 'list',
        worldId: a.worldId,
        biomes: results,
        count: results.length,
      })
    }
    case 'get': {
      const targetId = a.id ?? a.biomeId
      if (!targetId && !(a.worldId && a.name))
        return err('"id"/"biomeId", or "worldId" + "name", is required')
      const row = targetId
        ? await db.prepare('SELECT * FROM biomes WHERE id = ?').bind(targetId).first()
        : await db
            .prepare('SELECT * FROM biomes WHERE world_id = ? AND name = ?')
            .bind(a.worldId, a.name)
            .first()
      if (!row) return err('Biome not found')
      return ok({ success: true, actionType: 'get', biome: row })
    }
    case 'update': {
      const targetId = a.id ?? a.biomeId
      if (!targetId) return err('"id" or "biomeId" is required')
      const existing = (await db
        .prepare('SELECT id, mode_costs FROM biomes WHERE id = ?')
        .bind(targetId)
        .first()) as { id: string; mode_costs: string } | null
      if (!existing) return err(`Biome not found: ${targetId}`)
      const sets: string[] = ['updated_at = ?']
      const vals: unknown[] = [now]
      if (a.glyph !== undefined) {
        if ([...a.glyph].length !== 1) return err('"glyph" must be exactly 1 character')
        sets.push('glyph = ?')
        vals.push(a.glyph)
      }
      if (a.category !== undefined) {
        sets.push('category = ?')
        vals.push(a.category)
      }
      if (a.colorHex !== undefined) {
        if (!HEX_COLOR.test(a.colorHex))
          return err('"colorHex" must be a 6-digit hex color like #A1B2C3')
        sets.push('color_hex = ?')
        vals.push(a.colorHex)
      }
      if (a.movementCost !== undefined) {
        sets.push('movement_cost = ?')
        vals.push(a.movementCost)
      }
      if (a.baseThreat !== undefined) {
        sets.push('base_threat = ?')
        vals.push(a.baseThreat)
      }
      if (a.description !== undefined) {
        sets.push('description = ?')
        vals.push(a.description)
      }
      let mergedModeCosts: Record<string, number> | undefined
      if (a.modeCosts !== undefined) {
        mergedModeCosts = { ...parseModeCosts(existing.mode_costs), ...a.modeCosts }
        sets.push('mode_costs = ?')
        vals.push(JSON.stringify(mergedModeCosts))
      }
      vals.push(targetId)
      await db
        .prepare(`UPDATE biomes SET ${sets.join(', ')} WHERE id = ?`)
        .bind(...vals)
        .run()
      return ok({
        success: true,
        actionType: 'update',
        biomeId: targetId,
        ...(mergedModeCosts ? { modeCosts: mergedModeCosts } : {}),
      })
    }
    case 'delete': {
      const targetId = a.id ?? a.biomeId
      if (!targetId) return err('"id" or "biomeId" is required')
      const biome = (await db
        .prepare('SELECT world_id, name FROM biomes WHERE id = ?')
        .bind(targetId)
        .first()) as { world_id: string; name: string } | null
      if (!biome) return err(`Biome not found: ${targetId}`)
      // #320 — the RPG engine's terrain grid is now the hex-axial `hexes`
      // table (unified with the map editor, #308/#319).
      const hexRef = await db
        .prepare('SELECT 1 FROM hexes WHERE world_id = ? AND biome = ? LIMIT 1')
        .bind(biome.world_id, biome.name)
        .first()
      if (hexRef)
        return err(
          `Cannot delete biome "${biome.name}" — referenced by existing hexes in this world`,
        )
      await db.prepare('DELETE FROM biomes WHERE id = ?').bind(targetId).run()
      return ok({ success: true, actionType: 'delete', biomeId: targetId })
    }
    case 'validate': {
      if (!a.worldId || !a.name) return err('"worldId" and "name" are required')
      const row = await db
        .prepare('SELECT id FROM biomes WHERE world_id = ? AND name = ?')
        .bind(a.worldId, a.name)
        .first()
      if (row)
        return ok({
          success: true,
          actionType: 'validate',
          worldId: a.worldId,
          name: a.name,
          valid: true,
        })
      const { results } = (await db
        .prepare('SELECT name FROM biomes WHERE world_id = ?')
        .bind(a.worldId)
        .all()) as { results: Array<{ name: string }> }
      const scored = results
        .map((r) => ({ name: r.name, similarity: similarity(a.name!, r.name) }))
        .sort((x, y) => y.similarity - x.similarity)
      const didYouMean = scored
        .filter((s) => s.similarity >= 0.5)
        .slice(0, 3)
        .map((s) => s.name)
      return ok({
        success: true,
        actionType: 'validate',
        worldId: a.worldId,
        name: a.name,
        valid: false,
        didYouMean,
      })
    }
    case 'seed_defaults': {
      if (!a.worldId) return err('"worldId" is required')
      const world = await db.prepare('SELECT id FROM worlds WHERE id = ?').bind(a.worldId).first()
      if (!world) return err(`World not found: ${a.worldId}`)
      const seeded = await seedDefaultBiomes(db, a.worldId)
      return ok({
        success: true,
        actionType: 'seed_defaults',
        worldId: a.worldId,
        seeded,
        totalDefaults: DEFAULT_BIOMES.length,
      })
    }
  }
}
