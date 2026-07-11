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

const ACTIONS = ['overview', 'region', 'tiles', 'patch', 'batch', 'preview', 'find_poi', 'suggest_poi', 'update_poi', 'query_zone', 'list_zones', 'render_svg'] as const
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
  edit_poi: 'update_poi', modify_poi: 'update_poi', poi_update: 'update_poi',
  zone_query: 'query_zone', check_zone: 'query_zone',
  zones: 'list_zones', get_zones: 'list_zones',
  svg: 'render_svg', export_svg: 'render_svg', map_svg: 'render_svg',
}

// #276 — zone shape math (circle/polygon/ring) shared by query_zone, list_zones,
// and preview's zone overlay.
type ZoneShape =
  | { type: 'circle'; circle: { radius: number } }
  | { type: 'polygon'; polygon: Array<[number, number]> }
  | { type: 'ring'; ring: { inner: number; outer: number; points?: number | null } }

function pointInCircle(px: number, py: number, cx: number, cy: number, radius: number): boolean {
  const dx = px - cx; const dy = py - cy
  return Math.sqrt(dx * dx + dy * dy) <= radius
}

function pointInRing(px: number, py: number, cx: number, cy: number, inner: number, outer: number): boolean {
  const dx = px - cx; const dy = py - cy
  const dist = Math.sqrt(dx * dx + dy * dy)
  return dist >= inner && dist <= outer
}

function pointInPolygon(px: number, py: number, polygon: Array<[number, number]>): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    const intersect = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function pointInZone(px: number, py: number, cx: number, cy: number, zone: ZoneShape): boolean {
  if (zone.type === 'circle') return pointInCircle(px, py, cx, cy, zone.circle.radius)
  if (zone.type === 'ring') return pointInRing(px, py, cx, cy, zone.ring.inner, zone.ring.outer)
  if (zone.type === 'polygon') return pointInPolygon(px, py, zone.polygon)
  return false
}

export interface ZoneMetadata {
  zone?: ZoneShape
  zoneType?: string
  predator?: string
  // #280 — optional threat/dominance data for encounter resolution. threatLevel
  // is a narrator-authored 0-100 scale; dominanceRank ranks overlapping zones
  // when more than one territory covers the same point (higher wins; the
  // loser becomes a "displaced" contributor in encounter.resolve).
  threatLevel?: number
  dominanceRank?: number
}

export function parseZoneMetadata(raw: string | null): ZoneMetadata | null {
  if (!raw) return null
  try {
    const meta = JSON.parse(raw)
    if (!meta || typeof meta !== 'object') return null
    return {
      zone: meta.zone, zoneType: meta.zone_type, predator: meta.predator,
      threatLevel: meta.threat_level, dominanceRank: meta.dominance_rank,
    }
  } catch {
    return null
  }
}

// Merges zone-shape params into a structure's existing metadata JSON. Shape
// fields (radius/polygon/ring) are replaced wholesale when any is given;
// zone_type/predator/threatLevel/dominanceRank are patched independently so a
// caller can update one without clobbering the others' existing values.
// Returns null when there is nothing zone-related to store (fully
// backward-compatible plain POIs).
function mergeZoneMetadata(
  existingMetaRaw: string | null,
  patch: {
    radius?: number
    polygon?: Array<[number, number]>
    ringInner?: number
    ringOuter?: number
    ringPoints?: number
    zoneType?: string
    predatorRef?: string
    threatLevel?: number
    dominanceRank?: number
  }
): string | null {
  const existing = parseZoneMetadata(existingMetaRaw)
  let zone: ZoneShape | undefined = existing?.zone
  if (patch.polygon !== undefined) {
    zone = { type: 'polygon', polygon: patch.polygon }
  } else if (patch.ringInner !== undefined && patch.ringOuter !== undefined) {
    zone = { type: 'ring', ring: { inner: patch.ringInner, outer: patch.ringOuter, points: patch.ringPoints ?? null } }
  } else if (patch.radius !== undefined) {
    zone = { type: 'circle', circle: { radius: patch.radius } }
  }
  const zoneType = patch.zoneType ?? existing?.zoneType
  const predator = patch.predatorRef ?? existing?.predator
  const threatLevel = patch.threatLevel ?? existing?.threatLevel
  const dominanceRank = patch.dominanceRank ?? existing?.dominanceRank
  const meta: Record<string, unknown> = {}
  if (zone) meta.zone = zone
  if (zoneType) meta.zone_type = zoneType
  if (predator) meta.predator = predator
  if (threatLevel !== undefined) meta.threat_level = threatLevel
  if (dominanceRank !== undefined) meta.dominance_rank = dominanceRank
  return Object.keys(meta).length > 0 ? JSON.stringify(meta) : null
}

export interface ResolvedZone {
  structureId: string
  name: string
  zoneType: string | null
  predator: string | null
  threatLevel: number | null
  dominanceRank: number | null
  distanceToCenter: number
}

// Shared by query_zone and encounter-manage.ts (#280) — every zone shape
// containing (x, y), with the threat/dominance data encounter resolution
// needs to rank overlapping territories.
export async function resolveZonesAt(db: D1Database, worldId: string, x: number, y: number): Promise<ResolvedZone[]> {
  const { results } = await db.prepare('SELECT id, name, x, y, metadata FROM structures WHERE world_id = ?').bind(worldId).all() as
    { results: Array<{ id: string; name: string; x: number; y: number; metadata: string | null }> }
  const zones: ResolvedZone[] = []
  for (const s of results) {
    const meta = parseZoneMetadata(s.metadata)
    if (!meta?.zone) continue
    if (!pointInZone(x, y, s.x, s.y, meta.zone)) continue
    zones.push({
      structureId: s.id, name: s.name, zoneType: meta.zoneType ?? null, predator: meta.predator ?? null,
      threatLevel: meta.threatLevel ?? null, dominanceRank: meta.dominanceRank ?? null,
      distanceToCenter: Math.round(Math.hypot(x - s.x, y - s.y) * 10) / 10,
    })
  }
  return zones
}

// Overlay glyphs for zone types rendered in preview's ASCII grid — single
// Unicode code points only, so each grid cell stays exactly one character
// wide. 'broadcast' zones are deliberately not overlaid (informational only,
// queryable via query_zone/list_zones, but would add too much visual noise).
const ZONE_GLYPHS: Record<string, string> = { perimeter: '⚡', exclusion: '#', hazard: '!', territory: '@' }

// #275 — bulk tile import ceiling. ~200 bytes/tile row, comfortably under
// Worker request-body and response-time limits; a 100x100 world (10k tiles)
// needs 10 calls at this ceiling, which is an acceptable chunking cost.
const MAX_BATCH_TILES = 1000

// #277 — server-side SVG map export.
const SVG_TILE_PX = 10

// Fallback colors for the original 9 legacy biome names on worlds with no
// registered biome (mirrors LEGACY_BIOME_GLYPHS above; values match the
// DEFAULT_BIOMES color_hex entries in biome-manage.ts so a freshly-seeded
// world and a legacy unseeded world render identically).
const LEGACY_BIOME_COLORS: Record<string, string> = {
  grass: '#8B9A46', forest: '#1A472A', mountain: '#808080', water: '#1A5276',
  desert: '#EDC9AF', swamp: '#3D5724', plains: '#C2B280', tundra: '#D6E5E3', wasteland: '#5C4033',
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

interface RenderStructure { id: string; name: string; type: string; x: number; y: number; metadata: string | null }
interface RenderTile { x: number; y: number; biome: string }
interface RenderHighlight { x: number; y: number; label?: string; color?: string }

// Pure string-concatenation SVG builder — no external library, no browser
// dependency, matching #277's "no client-side rendering" requirement.
function buildMapSvg(params: {
  tiles: RenderTile[]
  registry: Map<string, { glyph: string; colorHex: string; movementCost: number }>
  structures: RenderStructure[]
  x: number; y: number; width: number; height: number
  showStructures: boolean; showZones: boolean; showPerimeter: boolean; gridLabels: boolean
  highlight: RenderHighlight[]
}): { svg: string; tileCount: number; structureCount: number; zoneCount: number } {
  const { tiles, registry, structures, x: vx, y: vy, width, height, showStructures, showZones, showPerimeter, gridLabels, highlight } = params
  const w = width * SVG_TILE_PX
  const h = height * SVG_TILE_PX
  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`)
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="#000000"/>`)

  for (const t of tiles) {
    const gx = t.x - vx; const gy = t.y - vy
    if (gx < 0 || gx >= width || gy < 0 || gy >= height) continue
    const color = registry.get(t.biome)?.colorHex ?? LEGACY_BIOME_COLORS[t.biome] ?? '#888888'
    parts.push(`<rect x="${gx * SVG_TILE_PX}" y="${gy * SVG_TILE_PX}" width="${SVG_TILE_PX}" height="${SVG_TILE_PX}" fill="${color}"/>`)
  }

  let zoneCount = 0
  if (showZones || showPerimeter) {
    for (const s of structures) {
      const meta = parseZoneMetadata(s.metadata)
      if (!meta?.zone) continue
      const zoneType = meta.zoneType ?? 'territory'
      if (zoneType === 'perimeter' ? !showPerimeter : !showZones) continue
      zoneCount++
      const cx = (s.x - vx) * SVG_TILE_PX + SVG_TILE_PX / 2
      const cy = (s.y - vy) * SVG_TILE_PX + SVG_TILE_PX / 2
      if (meta.zone.type === 'circle') {
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${meta.zone.circle.radius * SVG_TILE_PX}" fill="#ff0000" fill-opacity="0.2" stroke="#ff0000" stroke-opacity="0.5"/>`)
      } else if (meta.zone.type === 'polygon') {
        const pts = meta.zone.polygon.map(([px, py]) => `${(px - vx) * SVG_TILE_PX},${(py - vy) * SVG_TILE_PX}`).join(' ')
        parts.push(`<polygon points="${pts}" fill="#ff0000" fill-opacity="0.2" stroke="#ff0000" stroke-opacity="0.5"/>`)
      } else if (meta.zone.type === 'ring') {
        // Approximated as a single dashed ring rather than N individual pylon
        // markers — one shape, same visual read ("a dotted ring"), far
        // cheaper than emitting hundreds of point elements.
        const avgR = ((meta.zone.ring.inner + meta.zone.ring.outer) / 2) * SVG_TILE_PX
        const strokeWidth = (meta.zone.ring.outer - meta.zone.ring.inner) * SVG_TILE_PX
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${avgR}" fill="none" stroke="#ff0000" stroke-width="${strokeWidth}" stroke-dasharray="4 4" stroke-opacity="0.6"/>`)
      }
    }
  }

  let structureCount = 0
  if (showStructures) {
    for (const s of structures) {
      const meta = parseZoneMetadata(s.metadata)
      // A ring zone's perimeter visual already represents it — skip the
      // redundant center-point marker for that structure.
      if (meta?.zone?.type === 'ring') continue
      structureCount++
      const cx = (s.x - vx) * SVG_TILE_PX + SVG_TILE_PX / 2
      const cy = (s.y - vy) * SVG_TILE_PX + SVG_TILE_PX / 2
      parts.push(`<circle cx="${cx}" cy="${cy}" r="3" fill="#ffffff" stroke="#000000"/>`)
      parts.push(`<text x="${cx + 5}" y="${cy}" font-size="8" fill="#ffffff">${escapeXml(s.name)}</text>`)
    }
  }

  for (const hl of highlight) {
    const cx = (hl.x - vx) * SVG_TILE_PX + SVG_TILE_PX / 2
    const cy = (hl.y - vy) * SVG_TILE_PX + SVG_TILE_PX / 2
    const color = hl.color ?? '#FF4444'
    parts.push(`<circle cx="${cx}" cy="${cy}" r="4" fill="${color}"/>`)
    if (hl.label) parts.push(`<text x="${cx + 6}" y="${cy}" font-size="8" fill="${color}">${escapeXml(hl.label)}</text>`)
  }

  if (gridLabels) {
    for (let gx = 0; gx < width; gx += 10) {
      parts.push(`<text x="${gx * SVG_TILE_PX}" y="10" font-size="8" fill="#ffffff">${vx + gx}</text>`)
    }
    for (let gy = 0; gy < height; gy += 10) {
      parts.push(`<text x="0" y="${gy * SVG_TILE_PX + 10}" font-size="8" fill="#ffffff">${vy + gy}</text>`)
    }
  }

  parts.push('</svg>')
  return { svg: parts.join(''), tileCount: tiles.length, structureCount, zoneCount }
}

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
  structureId: z.string().optional(),
  name: z.string().optional(),
  radius: z.number().min(0).optional(),
  polygon: z.array(z.tuple([z.number(), z.number()])).optional(),
  ringInner: z.number().min(0).optional(),
  ringOuter: z.number().min(0).optional(),
  ringPoints: z.number().int().min(1).optional(),
  zoneType: z.string().optional(),
  predatorRef: z.string().optional(),
  threatLevel: z.number().min(0).max(100).optional(),
  dominanceRank: z.number().int().optional(),
  renderWidth: z.number().int().min(1).max(200).optional().default(100),
  renderHeight: z.number().int().min(1).max(200).optional().default(100),
  showStructures: z.boolean().optional().default(true),
  showZones: z.boolean().optional().default(true),
  showPerimeter: z.boolean().optional().default(true),
  gridLabels: z.boolean().optional().default(false),
  highlight: z.array(z.object({
    x: z.number(), y: z.number(), label: z.string().optional(), color: z.string().optional(),
  })).optional().default([]),
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

      // #276 — overlay zone glyphs (perimeter/territory/exclusion/hazard) on
      // top of the base terrain grid. First matching zone wins per cell.
      const { results: zoneStructs } = await db.prepare('SELECT x, y, metadata FROM structures WHERE world_id = ?').bind(a.worldId).all() as
        { results: Array<{ x: number; y: number; metadata: string | null }> }
      const zoneOverlays = zoneStructs
        .map(s => {
          const meta = parseZoneMetadata(s.metadata)
          if (!meta?.zone) return null
          return { x: s.x, y: s.y, zone: meta.zone, zoneType: meta.zoneType ?? 'territory' }
        })
        .filter((z): z is NonNullable<typeof z> => z !== null && ZONE_GLYPHS[z.zoneType] !== undefined)
      for (let gy = 0; gy < a.height; gy++) {
        for (let gx = 0; gx < a.width; gx++) {
          const worldX = a.x + gx; const worldY = a.y + gy
          for (const zo of zoneOverlays) {
            if (pointInZone(worldX, worldY, zo.x, zo.y, zo.zone)) {
              grid[gy][gx] = ZONE_GLYPHS[zo.zoneType]
              break
            }
          }
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
      if (a.polygon !== undefined && a.polygon.length < 3) return err('"polygon" requires at least 3 points')
      const id = crypto.randomUUID()
      const structType = a.structureType ?? 'landmark'
      const metadata = mergeZoneMetadata(null, {
        radius: a.radius, polygon: a.polygon, ringInner: a.ringInner, ringOuter: a.ringOuter, ringPoints: a.ringPoints,
        zoneType: a.zoneType, predatorRef: a.predatorRef, threatLevel: a.threatLevel, dominanceRank: a.dominanceRank,
      })
      const hasZone = a.radius !== undefined || a.polygon !== undefined || (a.ringInner !== undefined && a.ringOuter !== undefined)
      await db.prepare('INSERT INTO structures (id, world_id, region_id, name, type, x, y, population, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, a.worldId, a.regionId ?? null, a.query, structType, a.x, a.y, 0, now, now, metadata).run()
      return ok({ success: true, actionType: 'suggest_poi', structureId: id, name: a.query, type: structType, worldId: a.worldId, x: a.x, y: a.y, hasZone })
    }
    case 'update_poi': {
      if (!a.structureId) return err('"structureId" is required')
      const existing = await db.prepare('SELECT * FROM structures WHERE id = ?').bind(a.structureId).first() as Record<string, unknown> | null
      if (!existing) return err(`Structure not found: ${a.structureId}`)
      if (a.polygon !== undefined && a.polygon.length < 3) return err('"polygon" requires at least 3 points')

      const sets: string[] = ['updated_at = ?']
      const vals: unknown[] = [now]
      if (a.name !== undefined) { sets.push('name = ?'); vals.push(a.name) }
      if (a.structureType !== undefined) { sets.push('type = ?'); vals.push(a.structureType) }
      if (a.x !== undefined) { sets.push('x = ?'); vals.push(a.x) }
      if (a.y !== undefined) { sets.push('y = ?'); vals.push(a.y) }
      if (a.regionId !== undefined) { sets.push('region_id = ?'); vals.push(a.regionId) }

      const zoneFieldsTouched = a.radius !== undefined || a.polygon !== undefined || a.ringInner !== undefined
        || a.ringOuter !== undefined || a.zoneType !== undefined || a.predatorRef !== undefined
        || a.threatLevel !== undefined || a.dominanceRank !== undefined
      if (zoneFieldsTouched) {
        const metadata = mergeZoneMetadata(existing.metadata as string | null, {
          radius: a.radius, polygon: a.polygon, ringInner: a.ringInner, ringOuter: a.ringOuter, ringPoints: a.ringPoints,
          zoneType: a.zoneType, predatorRef: a.predatorRef, threatLevel: a.threatLevel, dominanceRank: a.dominanceRank,
        })
        sets.push('metadata = ?'); vals.push(metadata)
      }

      vals.push(a.structureId)
      await db.prepare(`UPDATE structures SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
      return ok({ success: true, actionType: 'update_poi', structureId: a.structureId })
    }
    case 'query_zone': {
      if (!a.worldId || a.x === undefined || a.y === undefined) return err('"worldId", "x", and "y" are required')
      const zones = await resolveZonesAt(db, a.worldId, a.x, a.y)
      const inPerimeter = zones.some(z => z.zoneType === 'perimeter')
      return ok({ success: true, actionType: 'query_zone', worldId: a.worldId, x: a.x, y: a.y, zones, inPerimeter })
    }
    case 'list_zones': {
      if (!a.worldId) return err('"worldId" is required')
      const { results } = await db.prepare('SELECT id, name, type, x, y, metadata FROM structures WHERE world_id = ?').bind(a.worldId).all() as
        { results: Array<{ id: string; name: string; type: string; x: number; y: number; metadata: string | null }> }
      const zones = results
        .map(s => {
          const meta = parseZoneMetadata(s.metadata)
          if (!meta?.zone) return null
          return {
            structureId: s.id, name: s.name, type: s.type, x: s.x, y: s.y, zoneType: meta.zoneType ?? null, zone: meta.zone,
            predator: meta.predator ?? null, threatLevel: meta.threatLevel ?? null, dominanceRank: meta.dominanceRank ?? null,
          }
        })
        .filter((z): z is NonNullable<typeof z> => z !== null)
        .filter(z => !a.zoneType || z.zoneType === a.zoneType)
      return ok({ success: true, actionType: 'list_zones', worldId: a.worldId, zones, count: zones.length })
    }
    case 'render_svg': {
      if (!a.worldId) return err('"worldId" is required')
      const vx = a.x ?? 0
      const vy = a.y ?? 0
      const vw = a.renderWidth
      const vh = a.renderHeight
      const { results: tiles } = await db.prepare('SELECT x, y, biome FROM tiles WHERE world_id = ? AND x >= ? AND x < ? AND y >= ? AND y < ?')
        .bind(a.worldId, vx, vx + vw, vy, vy + vh).all() as { results: RenderTile[] }
      const { results: structures } = await db.prepare('SELECT id, name, type, x, y, metadata FROM structures WHERE world_id = ? AND x >= ? AND x < ? AND y >= ? AND y < ?')
        .bind(a.worldId, vx, vx + vw, vy, vy + vh).all() as { results: RenderStructure[] }
      const registry = await getBiomeRegistry(db, a.worldId)
      const { svg, tileCount, structureCount, zoneCount } = buildMapSvg({
        tiles, registry, structures, x: vx, y: vy, width: vw, height: vh,
        showStructures: a.showStructures, showZones: a.showZones, showPerimeter: a.showPerimeter, gridLabels: a.gridLabels,
        highlight: a.highlight,
      })
      return ok({
        success: true, actionType: 'render_svg', worldId: a.worldId, svg,
        dimensions: { width: vw * SVG_TILE_PX, height: vh * SVG_TILE_PX },
        tileCount, structureCount, zoneCount,
      })
    }
  }
}
