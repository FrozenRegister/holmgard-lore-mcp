// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/world-map.ts
// map_tiles → tiles (columns: world_id, x, y, biome, elevation, moisture, temperature)
// world_pois → structures (world_id, region_id, name, type, x, y, population, metadata)

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'
import { getBiomeRegistry } from './biome-manage'

// Legacy fallback glyphs for worlds with zero registered biomes (#274) — kept
// only so pre-existing worlds that never ran biome.seed_defaults still render
// a sensible preview instead of '?' for every tile.
const LEGACY_BIOME_GLYPHS: Record<string, string> = { grass: '.', forest: 'T', mountain: 'M', water: '~', desert: 'd', swamp: 'S', plains: ',', tundra: '_', wasteland: 'X' }

const ACTIONS = ['overview', 'region', 'tiles', 'patch', 'batch', 'preview', 'find_poi', 'suggest_poi'] as const
type WorldMapAction = typeof ACTIONS[number]
const ALIASES: Record<string, WorldMapAction> = {
  summary: 'overview', world_view: 'overview',
  get_region: 'region', region_view: 'region', show_region: 'region',
  get_tiles: 'tiles', tile_data: 'tiles',
  update: 'patch', update_tiles: 'patch', modify: 'patch',
  bulk: 'batch', bulk_import: 'batch', import_tiles: 'batch',
  render: 'preview', ascii: 'preview', view: 'preview',
  search_poi: 'find_poi', get_poi: 'find_poi',
  recommend_poi: 'suggest_poi', new_poi: 'suggest_poi',
}

// #275 — bulk tile import ceiling. ~200 bytes/tile row, comfortably under
// Worker request-body and response-time limits; a 100x100 world (10k tiles)
// needs 10 calls at this ceiling, which is an acceptable chunking cost.
const MAX_BATCH_TILES = 1000

const TilePatch = z.object({
  x: z.number().int(), y: z.number().int(),
  biome: z.string().optional().default('grass'),
  elevation: z.number().int().optional().default(0),
  moisture: z.number().int().optional().default(50),
  temperature: z.number().int().optional().default(15),
})

const InputSchema = z.object({
  action: z.string(),
  worldId: z.string().optional(),
  regionId: z.string().optional(),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().min(1).max(20).optional().default(5),
  height: z.number().int().min(1).max(20).optional().default(5),
  tiles: z.array(TilePatch).optional().default([]),
  validateBiomes: z.boolean().optional().default(true),
  query: z.string().optional(),
  structureType: z.string().optional(),
})

export async function handleWorldMap(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'overview': {
      if (!a.worldId) return err('"worldId" is required')
      const world = await db.prepare('SELECT id, name, seed, width, height, created_at, updated_at FROM worlds WHERE id = ?').bind(a.worldId).first() as Record<string, unknown> | null
      if (!world) return err(`World not found: ${a.worldId}`)
      const { results: regions } = await db.prepare('SELECT id, name, type, owner_nation_id FROM regions WHERE world_id = ? ORDER BY name').bind(a.worldId).all()
      const { results: nations } = await db.prepare('SELECT id, name, ideology FROM nations WHERE world_id = ? ORDER BY name').bind(a.worldId).all()
      const { results: structures } = await db.prepare('SELECT id, name, type, x, y FROM structures WHERE world_id = ? ORDER BY type').bind(a.worldId).all()
      return ok({ success: true, actionType: 'overview', world, regions, nations, structures, summary: { regionCount: regions.length, nationCount: nations.length, structureCount: structures.length } })
    }
    case 'region': {
      if (!a.regionId) return err('"regionId" is required')
      const region = await db.prepare('SELECT * FROM regions WHERE id = ?').bind(a.regionId).first() as Record<string, unknown> | null
      if (!region) return err(`Region not found: ${a.regionId}`)
      const { results: structures } = await db.prepare('SELECT * FROM structures WHERE region_id = ?').bind(a.regionId).all()
      const { results: claims } = await db.prepare('SELECT * FROM territorial_claims WHERE region_id = ?').bind(a.regionId).all()
      return ok({ success: true, actionType: 'region', region, structures, claims })
    }
    case 'tiles': {
      if (!a.worldId || a.x === undefined || a.y === undefined) return err('"worldId", "x", and "y" are required')
      const { results } = await db.prepare('SELECT * FROM tiles WHERE world_id = ? AND x >= ? AND x < ? AND y >= ? AND y < ? ORDER BY y, x')
        .bind(a.worldId, a.x, a.x + a.width, a.y, a.y + a.height).all()
      return ok({ success: true, actionType: 'tiles', worldId: a.worldId, tiles: results, x: a.x, y: a.y, width: a.width, height: a.height })
    }
    case 'patch': {
      if (!a.worldId || a.tiles.length === 0) return err('"worldId" and "tiles" are required')
      const registry = await getBiomeRegistry(db, a.worldId)
      if (registry.size > 0) {
        const invalid = a.tiles.map(t => t.biome).filter(b => !registry.has(b))
        if (invalid.length > 0) {
          return err(`Unknown biome(s) for this world: ${[...new Set(invalid)].join(', ')}. Registered biomes: ${[...registry.keys()].sort().join(', ')}`)
        }
      }
      let updated = 0
      for (const tile of a.tiles) {
        const id = crypto.randomUUID()
        await db.prepare('INSERT INTO tiles (id, world_id, x, y, biome, elevation, moisture, temperature) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(world_id, x, y) DO UPDATE SET biome = excluded.biome, elevation = excluded.elevation, moisture = excluded.moisture, temperature = excluded.temperature')
          .bind(id, a.worldId, tile.x, tile.y, tile.biome, tile.elevation, tile.moisture, tile.temperature).run()
        updated++
      }
      return ok({ success: true, actionType: 'patch', worldId: a.worldId, tilesUpdated: updated })
    }
    case 'batch': {
      if (!a.worldId || a.tiles.length === 0) return err('"worldId" and "tiles" are required')
      if (a.tiles.length > MAX_BATCH_TILES) {
        return err(`"tiles" exceeds the ${MAX_BATCH_TILES}-tile-per-call limit (received ${a.tiles.length}). Chunk the payload at the application level.`)
      }
      const start = Date.now()
      const errors: Array<{ index: number; x: number; y: number; biome: string; error: string }> = []
      let validTiles = a.tiles

      if (a.validateBiomes) {
        const registry = await getBiomeRegistry(db, a.worldId)
        if (registry.size > 0) {
          validTiles = []
          a.tiles.forEach((t, index) => {
            if (registry.has(t.biome)) validTiles.push(t)
            else errors.push({ index, x: t.x, y: t.y, biome: t.biome, error: 'Unknown biome' })
          })
        }
      }

      let tilesInserted = 0
      let tilesUpdated = 0
      if (validTiles.length > 0) {
        const xs = validTiles.map(t => t.x)
        const ys = validTiles.map(t => t.y)
        const { results: existingRows } = await db.prepare(
          'SELECT x, y FROM tiles WHERE world_id = ? AND x >= ? AND x <= ? AND y >= ? AND y <= ?'
        ).bind(a.worldId, Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)).all() as { results: Array<{ x: number; y: number }> }
        const existingKeys = new Set(existingRows.map(r => `${r.x},${r.y}`))
        for (const t of validTiles) {
          if (existingKeys.has(`${t.x},${t.y}`)) tilesUpdated++
          else tilesInserted++
        }

        try {
          for (let i = 0; i < validTiles.length; i += 100) {
            const chunk = validTiles.slice(i, i + 100)
            await db.batch(chunk.map(t =>
              db.prepare('INSERT INTO tiles (id, world_id, x, y, biome, elevation, moisture, temperature) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(world_id, x, y) DO UPDATE SET biome = excluded.biome, elevation = excluded.elevation, moisture = excluded.moisture, temperature = excluded.temperature')
                .bind(crypto.randomUUID(), a.worldId, t.x, t.y, t.biome, t.elevation, t.moisture, t.temperature)
            ))
          }
        } catch (e) {
          return err(`Batch write failed: ${(e as Error).message}`)
        }
      }

      return ok({
        success: true, actionType: 'batch', worldId: a.worldId,
        tilesInserted, tilesUpdated, errors, duration_ms: Date.now() - start,
      })
    }
    case 'preview': {
      if (!a.worldId || a.x === undefined || a.y === undefined) return err('"worldId", "x", and "y" are required')
      const { results: tiles } = await db.prepare('SELECT x, y, biome FROM tiles WHERE world_id = ? AND x >= ? AND x < ? AND y >= ? AND y < ?')
        .bind(a.worldId, a.x, a.x + a.width, a.y, a.y + a.height).all() as { results: Array<{ x: number; y: number; biome: string }> }
      const registry = await getBiomeRegistry(db, a.worldId)
      const grid: string[][] = Array.from({ length: a.height }, () => Array(a.width).fill('?'))
      for (const t of tiles) {
        const gx = t.x - a.x; const gy = t.y - a.y
        if (gx >= 0 && gx < a.width && gy >= 0 && gy < a.height) {
          grid[gy][gx] = registry.get(t.biome)?.glyph ?? LEGACY_BIOME_GLYPHS[t.biome] ?? '?'
        }
      }
      const ascii = grid.map(row => row.join('')).join('\n')
      return ok({ success: true, actionType: 'preview', worldId: a.worldId, ascii, x: a.x, y: a.y, width: a.width, height: a.height })
    }
    case 'find_poi': {
      if (!a.worldId) return err('"worldId" is required')
      let query = 'SELECT id, name, type, x, y, region_id FROM structures WHERE world_id = ?'
      const binds: unknown[] = [a.worldId]
      if (a.structureType) { query += ' AND type = ?'; binds.push(a.structureType) }
      if (a.query) { query += ' AND name LIKE ?'; binds.push(`%${a.query}%`) }
      const { results } = await db.prepare(query + ' ORDER BY name LIMIT 50').bind(...binds).all()
      return ok({ success: true, actionType: 'find_poi', worldId: a.worldId, structures: results, count: results.length })
    }
    case 'suggest_poi': {
      if (!a.worldId || !a.query || a.x === undefined || a.y === undefined) return err('"worldId", "query" (name), "x", and "y" are required')
      const id = crypto.randomUUID()
      const structType = a.structureType ?? 'landmark'
      await db.prepare('INSERT INTO structures (id, world_id, region_id, name, type, x, y, population, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, a.worldId, a.regionId ?? null, a.query, structType, a.x, a.y, 0, now, now).run()
      return ok({ success: true, actionType: 'suggest_poi', structureId: id, name: a.query, type: structType, worldId: a.worldId, x: a.x, y: a.y })
    }
  }
}
