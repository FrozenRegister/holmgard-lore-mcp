// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/world-map.ts
//
// #320 (Phase 2 of #308) — rewritten to read/write the hex-axial `hexes`/
// `landmarks` tables (shared with holmgard-lore-editor, world-scoped by
// migration 0019/#319) instead of the retired square-grid `tiles`/
// `structures` tables. Coordinates are hex-axial `q,r`, not square `x,y`.
// `mapId` (default 'main', matching the editor's own default) identifies
// which hex map a world's rows live in — `hexes`/`landmarks`' primary key is
// `(q, r, map_id)`, so writes must know both `worldId` and `mapId`; reads
// filter by `worldId` alone unless a caller wants to disambiguate a
// multi-map world.
//
// Writes only ever touch the RPG-owned columns (biome, elevation, moisture,
// temperature, world_id and, on landmarks, region_id/population/zone_*) —
// never `terrain`/`label`/`data` (hexes) or `data` (landmarks), which are the
// editor's freeform, lore-linked fields. This is a shared row with two
// separate sets of column owners, not a takeover.

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'
import { getBiomeRegistry } from './biome-manage'
import { getZoneTypeRegistry } from './zone-type-manage'

const ACTIONS = ['overview', 'region', 'hexes', 'patch', 'batch', 'preview', 'find_poi', 'suggest_poi', 'update_poi', 'query_zone', 'list_zones', 'render_svg'] as const
type WorldMapAction = typeof ACTIONS[number]
const ALIASES: Record<string, WorldMapAction> = {
  summary: 'overview', world_view: 'overview',
  get_region: 'region', region_view: 'region', show_region: 'region',
  tiles: 'hexes', get_tiles: 'hexes', tile_data: 'hexes', get_hexes: 'hexes', hex_data: 'hexes',
  update: 'patch', update_tiles: 'patch', update_hexes: 'patch', modify: 'patch',
  bulk: 'batch', bulk_import: 'batch', import_tiles: 'batch', import_hexes: 'batch',
  render: 'preview', ascii: 'preview', view: 'preview',
  search_poi: 'find_poi', get_poi: 'find_poi',
  recommend_poi: 'suggest_poi', new_poi: 'suggest_poi',
  edit_poi: 'update_poi', modify_poi: 'update_poi', poi_update: 'update_poi',
  zone_query: 'query_zone', check_zone: 'query_zone',
  zones: 'list_zones', get_zones: 'list_zones',
  svg: 'render_svg', export_svg: 'render_svg', map_svg: 'render_svg',
}

// #276 — zone shape math (circle/polygon/ring) shared by query_zone, list_zones,
// and preview's zone overlay. Coordinates are hex-axial (q, r).
type ZoneShape =
  | { type: 'circle'; circle: { radius: number } }
  | { type: 'polygon'; polygon: Array<[number, number]> }
  | { type: 'ring'; ring: { inner: number; outer: number; points?: number | null } }

// Hex-axial distance (number of hex steps between two cells), NOT Euclidean —
// a "radius N" zone means N hexes away, matching how a narrator thinks about
// hex-grid range. See https://www.redblobgames.com/grids/hexagons/#distances.
function hexDistance(q1: number, r1: number, q2: number, r2: number): number {
  const dq = q1 - q2; const dr = r1 - r2
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
}

// Polygon zone shapes are defined by (q, r) vertices and tested with
// standard ray-casting over that plane — this is unchanged from the square
// grid (there's no natural "hex polygon" test; treating q,r as plain 2D
// coordinates for an arbitrary vertex list is the same math regardless of
// grid shape).
function pointInPolygon(pq: number, pr: number, polygon: Array<[number, number]>): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [qi, ri] = polygon[i]
    const [qj, rj] = polygon[j]
    const intersect = (ri > pr) !== (rj > pr) && pq < ((qj - qi) * (pr - ri)) / (rj - ri) + qi
    if (intersect) inside = !inside
  }
  return inside
}

function pointInZone(q: number, r: number, cq: number, cr: number, zone: ZoneShape): boolean {
  if (zone.type === 'circle') return hexDistance(q, r, cq, cr) <= zone.circle.radius
  if (zone.type === 'ring') {
    const d = hexDistance(q, r, cq, cr)
    return d >= zone.ring.inner && d <= zone.ring.outer
  }
  if (zone.type === 'polygon') return pointInPolygon(q, r, zone.polygon)
  return false
}

function parseZoneShape(raw: string | null): ZoneShape | null {
  if (!raw) return null
  try {
    const zone = JSON.parse(raw)
    if (!zone || typeof zone !== 'object') return null
    return zone as ZoneShape
  } catch {
    return null
  }
}

interface ExistingZoneFields {
  zone_shape: string | null
  zone_type: string | null
  predator_ref: string | null
  threat_level: number | null
  dominance_rank: number | null
}

interface MergedZoneFields {
  zoneShape: string | null
  zoneType: string | null
  predatorRef: string | null
  threatLevel: number | null
  dominanceRank: number | null
}

// Merges zone-shape params into a landmark's existing zone_* columns. Shape
// fields (radius/polygon/ring) are replaced wholesale when any is given;
// zoneType/predatorRef/threatLevel/dominanceRank are patched independently so
// a caller can update one without clobbering the others. Returns all-null
// when there is nothing zone-related (fully backward-compatible plain POIs).
function mergeZoneFields(
  existing: ExistingZoneFields | null,
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
): MergedZoneFields {
  let zone: ZoneShape | null = existing?.zone_shape ? parseZoneShape(existing.zone_shape) : null
  if (patch.polygon !== undefined) {
    zone = { type: 'polygon', polygon: patch.polygon }
  } else if (patch.ringInner !== undefined && patch.ringOuter !== undefined) {
    zone = { type: 'ring', ring: { inner: patch.ringInner, outer: patch.ringOuter, points: patch.ringPoints ?? null } }
  } else if (patch.radius !== undefined) {
    zone = { type: 'circle', circle: { radius: patch.radius } }
  }
  return {
    zoneShape: zone ? JSON.stringify(zone) : null,
    zoneType: patch.zoneType ?? existing?.zone_type ?? null,
    predatorRef: patch.predatorRef ?? existing?.predator_ref ?? null,
    threatLevel: patch.threatLevel ?? existing?.threat_level ?? null,
    dominanceRank: patch.dominanceRank ?? existing?.dominance_rank ?? null,
  }
}

export interface ResolvedZone {
  landmarkId: string
  name: string
  zoneType: string | null
  predator: string | null
  threatLevel: number | null
  dominanceRank: number | null
  distanceToCenter: number
}

// Shared by query_zone and encounter-manage.ts (#280) — every zone shape
// containing (q, r), with the threat/dominance data encounter resolution
// needs to rank overlapping territories.
export async function resolveZonesAt(db: D1Database, worldId: string, q: number, r: number): Promise<ResolvedZone[]> {
  const { results } = await db.prepare(
    'SELECT id, name, q, r, zone_type, zone_shape, predator_ref, threat_level, dominance_rank FROM landmarks WHERE world_id = ? AND zone_shape IS NOT NULL'
  ).bind(worldId).all() as {
    results: Array<{ id: string; name: string; q: number; r: number; zone_type: string | null; zone_shape: string | null; predator_ref: string | null; threat_level: number | null; dominance_rank: number | null }>
  }
  const zones: ResolvedZone[] = []
  for (const lm of results) {
    const zone = parseZoneShape(lm.zone_shape)
    if (!zone) continue
    if (!pointInZone(q, r, lm.q, lm.r, zone)) continue
    zones.push({
      landmarkId: lm.id, name: lm.name, zoneType: lm.zone_type, predator: lm.predator_ref,
      threatLevel: lm.threat_level, dominanceRank: lm.dominance_rank,
      distanceToCenter: hexDistance(q, r, lm.q, lm.r),
    })
  }
  return zones
}

// #275 — bulk hex import ceiling. ~200 bytes/hex row, comfortably under
// Worker request-body and response-time limits; a 100x100 world (10k hexes)
// needs 10 calls at this ceiling, which is an acceptable chunking cost.
const MAX_BATCH_HEXES = 1000

// #277 — server-side SVG map export. HEX_SIZE is the pixel distance from a
// hex's center to its corner (pointy-top orientation).
const HEX_SIZE = 10
const SQRT3 = Math.sqrt(3)

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// Pointy-top axial hex → pixel center. See
// https://www.redblobgames.com/grids/hexagons/#hex-to-pixel-axial
function hexToPixel(q: number, r: number, size: number): [number, number] {
  const x = size * (SQRT3 * q + (SQRT3 / 2) * r)
  const y = size * 1.5 * r
  return [x, y]
}

function hexCorners(cx: number, cy: number, size: number): Array<[number, number]> {
  const corners: Array<[number, number]> = []
  for (let i = 0; i < 6; i++) {
    const angleRad = (Math.PI / 180) * (60 * i - 30)
    corners.push([cx + size * Math.cos(angleRad), cy + size * Math.sin(angleRad)])
  }
  return corners
}

interface RenderLandmark { id: string; name: string; q: number; r: number; zone_type: string | null; zone_shape: string | null }
interface RenderHex { q: number; r: number; biome: string }
interface RenderHighlight { q: number; r: number; label?: string; color?: string }

// Pure string-concatenation SVG builder — no external library, no browser
// dependency, matching #277's "no client-side rendering" requirement. Renders
// hex polygons (not squares) at their true axial pixel positions; the canvas
// bounds are computed analytically from the requested (q, r) viewport rather
// than measured, since hexToPixel is monotonic in both q and r for the
// pointy-top orientation used here.
function buildMapSvg(params: {
  hexes: RenderHex[]
  registry: Map<string, { glyph: string; colorHex: string; movementCost: number }>
  landmarks: RenderLandmark[]
  q: number; r: number; width: number; height: number
  showStructures: boolean; showZones: boolean; showPerimeter: boolean; gridLabels: boolean
  highlight: RenderHighlight[]
}): { svg: string; hexCount: number; structureCount: number; zoneCount: number; width: number; height: number } {
  const { hexes, registry, landmarks, q: vq, r: vr, width, height, showStructures, showZones, showPerimeter, gridLabels, highlight } = params

  const [minCornerX] = hexToPixel(vq, vr, HEX_SIZE)
  const [maxCornerX] = hexToPixel(vq + width - 1, vr + height - 1, HEX_SIZE)
  const [, minCornerY] = hexToPixel(vq, vr, HEX_SIZE)
  const [, maxCornerY] = hexToPixel(vq, vr + height - 1, HEX_SIZE)
  const marginX = HEX_SIZE * SQRT3
  const marginY = HEX_SIZE * 2
  const originX = minCornerX - marginX
  const originY = minCornerY - marginY
  const canvasW = Math.ceil(maxCornerX - minCornerX + marginX * 2)
  const canvasH = Math.ceil(maxCornerY - minCornerY + marginY * 2)

  const toCanvas = (q: number, r: number): [number, number] => {
    const [px, py] = hexToPixel(q, r, HEX_SIZE)
    return [px - originX, py - originY]
  }

  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">`)
  parts.push(`<rect x="0" y="0" width="${canvasW}" height="${canvasH}" fill="#000000"/>`)

  for (const h of hexes) {
    const [cx, cy] = toCanvas(h.q, h.r)
    const color = registry.get(h.biome)?.colorHex ?? '#888888'
    const pts = hexCorners(cx, cy, HEX_SIZE).map(([px, py]) => `${px},${py}`).join(' ')
    parts.push(`<polygon points="${pts}" fill="${color}"/>`)
  }

  let zoneCount = 0
  if (showZones || showPerimeter) {
    for (const lm of landmarks) {
      const zone = parseZoneShape(lm.zone_shape)
      if (!zone) continue
      const zoneType = lm.zone_type ?? 'territory'
      if (zoneType === 'perimeter' ? !showPerimeter : !showZones) continue
      zoneCount++
      const [cx, cy] = toCanvas(lm.q, lm.r)
      // Zone radii are in hex-distance units; approximated in pixels as
      // radius * 1.5 hex-widths — a visual approximation for narrator-facing
      // debug rendering, not pixel-precise cartography.
      if (zone.type === 'circle') {
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${zone.circle.radius * HEX_SIZE * 1.5}" fill="#ff0000" fill-opacity="0.2" stroke="#ff0000" stroke-opacity="0.5"/>`)
      } else if (zone.type === 'polygon') {
        const pts = zone.polygon.map(([pq, pr]) => toCanvas(pq, pr)).map(([px, py]) => `${px},${py}`).join(' ')
        parts.push(`<polygon points="${pts}" fill="#ff0000" fill-opacity="0.2" stroke="#ff0000" stroke-opacity="0.5"/>`)
      } else if (zone.type === 'ring') {
        const avgR = ((zone.ring.inner + zone.ring.outer) / 2) * HEX_SIZE * 1.5
        const strokeWidth = (zone.ring.outer - zone.ring.inner) * HEX_SIZE * 1.5
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${avgR}" fill="none" stroke="#ff0000" stroke-width="${strokeWidth}" stroke-dasharray="4 4" stroke-opacity="0.6"/>`)
      }
    }
  }

  let structureCount = 0
  if (showStructures) {
    for (const lm of landmarks) {
      const zone = parseZoneShape(lm.zone_shape)
      // A ring zone's perimeter visual already represents it — skip the
      // redundant center-point marker for that landmark.
      if (zone?.type === 'ring') continue
      structureCount++
      const [cx, cy] = toCanvas(lm.q, lm.r)
      parts.push(`<circle cx="${cx}" cy="${cy}" r="3" fill="#ffffff" stroke="#000000"/>`)
      parts.push(`<text x="${cx + 5}" y="${cy}" font-size="8" fill="#ffffff">${escapeXml(lm.name)}</text>`)
    }
  }

  for (const hl of highlight) {
    const [cx, cy] = toCanvas(hl.q, hl.r)
    const color = hl.color ?? '#FF4444'
    parts.push(`<circle cx="${cx}" cy="${cy}" r="4" fill="${color}"/>`)
    if (hl.label) parts.push(`<text x="${cx + 6}" y="${cy}" font-size="8" fill="${color}">${escapeXml(hl.label)}</text>`)
  }

  if (gridLabels) {
    for (let dq = 0; dq < width; dq += 10) {
      const [cx, cy] = toCanvas(vq + dq, vr)
      parts.push(`<text x="${cx}" y="${cy - HEX_SIZE}" font-size="8" fill="#ffffff">${vq + dq}</text>`)
    }
    for (let dr = 0; dr < height; dr += 10) {
      const [cx, cy] = toCanvas(vq, vr + dr)
      parts.push(`<text x="${cx - HEX_SIZE * SQRT3}" y="${cy}" font-size="8" fill="#ffffff">${vr + dr}</text>`)
    }
  }

  parts.push('</svg>')
  return { svg: parts.join(''), hexCount: hexes.length, structureCount, zoneCount, width: canvasW, height: canvasH }
}

const HexPatch = z.object({
  q: z.number().int(), r: z.number().int(),
  biome: z.string().optional().default('grass'),
  elevation: z.number().int().optional().default(0),
  moisture: z.number().int().optional().default(50),
  temperature: z.number().int().optional().default(15),
  // #431 — explicit per-hex fording depth in meters. null/omitted = no
  // fording rule for this hex (defers to the biome's own movement cost).
  waterDepth: z.number().min(0).nullable().optional().default(null),
})

const InputSchema = z.object({
  action: z.string(),
  worldId: z.string().optional(),
  mapId: z.string().optional().default('main'),
  regionId: z.string().optional(),
  q: z.number().int().optional(),
  r: z.number().int().optional(),
  width: z.number().int().min(1).max(20).optional().default(5),
  height: z.number().int().min(1).max(20).optional().default(5),
  hexes: z.array(HexPatch).optional().default([]),
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
    q: z.number(), r: z.number(), label: z.string().optional(), color: z.string().optional(),
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
      const { results: landmarks } = await db.prepare('SELECT id, name, category, q, r FROM landmarks WHERE world_id = ? ORDER BY category').bind(a.worldId).all()
      return ok({ success: true, actionType: 'overview', world, regions, nations, landmarks, summary: { regionCount: regions.length, nationCount: nations.length, landmarkCount: landmarks.length } })
    }
    case 'region': {
      if (!a.regionId) return err('"regionId" is required')
      const region = await db.prepare('SELECT * FROM regions WHERE id = ?').bind(a.regionId).first() as Record<string, unknown> | null
      if (!region) return err(`Region not found: ${a.regionId}`)
      const { results: landmarks } = await db.prepare('SELECT * FROM landmarks WHERE region_id = ?').bind(a.regionId).all()
      const { results: claims } = await db.prepare('SELECT * FROM territorial_claims WHERE region_id = ?').bind(a.regionId).all()
      return ok({ success: true, actionType: 'region', region, landmarks, claims })
    }
    case 'hexes': {
      if (!a.worldId || a.q === undefined || a.r === undefined) return err('"worldId", "q", and "r" are required')
      const { results } = await db.prepare('SELECT * FROM hexes WHERE world_id = ? AND q >= ? AND q < ? AND r >= ? AND r < ? ORDER BY r, q')
        .bind(a.worldId, a.q, a.q + a.width, a.r, a.r + a.height).all()
      return ok({ success: true, actionType: 'hexes', worldId: a.worldId, hexes: results, q: a.q, r: a.r, width: a.width, height: a.height })
    }
    case 'patch': {
      if (!a.worldId || a.hexes.length === 0) return err('"worldId" and "hexes" are required')
      const registry = await getBiomeRegistry(db, a.worldId)
      if (registry.size > 0) {
        const invalid = a.hexes.map(h => h.biome).filter(b => !registry.has(b))
        if (invalid.length > 0) {
          return err(`Unknown biome(s) for this world: ${[...new Set(invalid)].join(', ')}. Registered biomes: ${[...registry.keys()].sort().join(', ')}`)
        }
      }
      let updated = 0
      for (const hex of a.hexes) {
        await db.prepare(
          `INSERT INTO hexes (q, r, map_id, biome, elevation, moisture, temperature, water_depth, world_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(q, r, map_id) DO UPDATE SET
             biome = excluded.biome, elevation = excluded.elevation, moisture = excluded.moisture,
             temperature = excluded.temperature, water_depth = excluded.water_depth,
             world_id = excluded.world_id, updated_at = excluded.updated_at`
        ).bind(hex.q, hex.r, a.mapId, hex.biome, hex.elevation, hex.moisture, hex.temperature, hex.waterDepth, a.worldId, now).run()
        updated++
      }
      return ok({ success: true, actionType: 'patch', worldId: a.worldId, mapId: a.mapId, hexesUpdated: updated })
    }
    case 'batch': {
      if (!a.worldId || a.hexes.length === 0) return err('"worldId" and "hexes" are required')
      if (a.hexes.length > MAX_BATCH_HEXES) {
        return err(`"hexes" exceeds the ${MAX_BATCH_HEXES}-hex-per-call limit (received ${a.hexes.length}). Chunk the payload at the application level.`)
      }
      const start = Date.now()
      const errors: Array<{ index: number; q: number; r: number; biome: string; error: string }> = []
      let validHexes = a.hexes

      if (a.validateBiomes) {
        const registry = await getBiomeRegistry(db, a.worldId)
        if (registry.size > 0) {
          validHexes = []
          a.hexes.forEach((h, index) => {
            if (registry.has(h.biome)) validHexes.push(h)
            else errors.push({ index, q: h.q, r: h.r, biome: h.biome, error: 'Unknown biome' })
          })
        }
      }

      let hexesInserted = 0
      let hexesUpdated = 0
      if (validHexes.length > 0) {
        const qs = validHexes.map(h => h.q)
        const rs = validHexes.map(h => h.r)
        const { results: existingRows } = await db.prepare(
          'SELECT q, r FROM hexes WHERE map_id = ? AND q >= ? AND q <= ? AND r >= ? AND r <= ?'
        ).bind(a.mapId, Math.min(...qs), Math.max(...qs), Math.min(...rs), Math.max(...rs)).all() as { results: Array<{ q: number; r: number }> }
        const existingKeys = new Set(existingRows.map(row => `${row.q},${row.r}`))
        for (const h of validHexes) {
          if (existingKeys.has(`${h.q},${h.r}`)) hexesUpdated++
          else hexesInserted++
        }

        try {
          for (let i = 0; i < validHexes.length; i += 100) {
            const chunk = validHexes.slice(i, i + 100)
            await db.batch(chunk.map(h =>
              db.prepare(
                `INSERT INTO hexes (q, r, map_id, biome, elevation, moisture, temperature, water_depth, world_id, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(q, r, map_id) DO UPDATE SET
                   biome = excluded.biome, elevation = excluded.elevation, moisture = excluded.moisture,
                   temperature = excluded.temperature, water_depth = excluded.water_depth,
                   world_id = excluded.world_id, updated_at = excluded.updated_at`
              ).bind(h.q, h.r, a.mapId, h.biome, h.elevation, h.moisture, h.temperature, h.waterDepth, a.worldId, now)
            ))
          }
        } catch (e) {
          return err(`Batch write failed: ${(e as Error).message}`)
        }
      }

      return ok({
        success: true, actionType: 'batch', worldId: a.worldId, mapId: a.mapId,
        hexesInserted, hexesUpdated, errors, duration_ms: Date.now() - start,
      })
    }
    case 'preview': {
      if (!a.worldId || a.q === undefined || a.r === undefined) return err('"worldId", "q", and "r" are required')
      const { results: hexes } = await db.prepare('SELECT q, r, biome FROM hexes WHERE world_id = ? AND q >= ? AND q < ? AND r >= ? AND r < ?')
        .bind(a.worldId, a.q, a.q + a.width, a.r, a.r + a.height).all() as { results: Array<{ q: number; r: number; biome: string }> }
      const registry = await getBiomeRegistry(db, a.worldId)
      const grid: string[][] = Array.from({ length: a.height }, () => Array(a.width).fill('?'))
      for (const h of hexes) {
        const gq = h.q - a.q; const gr = h.r - a.r
        if (gq >= 0 && gq < a.width && gr >= 0 && gr < a.height) {
          grid[gr][gq] = registry.get(h.biome)?.glyph ?? '?'
        }
      }

      // #276/#320 — overlay zone glyphs (per-world registered zone types, e.g.
      // perimeter/territory/exclusion/hazard) on top of the base terrain grid.
      // First matching zone wins per cell. A zone type with no registered
      // glyph (or not registered at all) renders no overlay — matching how
      // 'broadcast' zones were deliberately excluded from the old hardcoded map.
      const zoneTypeRegistry = await getZoneTypeRegistry(db, a.worldId)
      const { results: zoneRows } = await db.prepare(
        'SELECT q, r, zone_type, zone_shape FROM landmarks WHERE world_id = ? AND zone_shape IS NOT NULL'
      ).bind(a.worldId).all() as { results: Array<{ q: number; r: number; zone_type: string | null; zone_shape: string | null }> }
      const zoneOverlays = zoneRows
        .map(lm => {
          const zone = parseZoneShape(lm.zone_shape)
          if (!zone) return null
          return { q: lm.q, r: lm.r, zone, zoneType: lm.zone_type ?? 'territory' }
        })
        .filter((z): z is NonNullable<typeof z> => z !== null && zoneTypeRegistry.get(z.zoneType)?.glyph != null)
      for (let gr = 0; gr < a.height; gr++) {
        for (let gq = 0; gq < a.width; gq++) {
          const worldQ = a.q + gq; const worldR = a.r + gr
          for (const zo of zoneOverlays) {
            if (pointInZone(worldQ, worldR, zo.q, zo.r, zo.zone)) {
              grid[gr][gq] = zoneTypeRegistry.get(zo.zoneType)!.glyph!
              break
            }
          }
        }
      }

      const ascii = grid.map(row => row.join('')).join('\n')
      return ok({ success: true, actionType: 'preview', worldId: a.worldId, ascii, q: a.q, r: a.r, width: a.width, height: a.height })
    }
    case 'find_poi': {
      if (!a.worldId) return err('"worldId" is required')
      let query = 'SELECT id, name, category, q, r, region_id FROM landmarks WHERE world_id = ?'
      const binds: unknown[] = [a.worldId]
      if (a.structureType) { query += ' AND category = ?'; binds.push(a.structureType) }
      if (a.query) { query += ' AND name LIKE ?'; binds.push(`%${a.query}%`) }
      const { results } = await db.prepare(query + ' ORDER BY name LIMIT 50').bind(...binds).all()
      return ok({ success: true, actionType: 'find_poi', worldId: a.worldId, landmarks: results, count: results.length })
    }
    case 'suggest_poi': {
      if (!a.worldId || !a.query || a.q === undefined || a.r === undefined) return err('"worldId", "query" (name), "q", and "r" are required')
      if (a.polygon !== undefined && a.polygon.length < 3) return err('"polygon" requires at least 3 points')
      const id = crypto.randomUUID()
      const category = a.structureType ?? 'landmark'
      const { zoneShape, zoneType, predatorRef, threatLevel, dominanceRank } = mergeZoneFields(null, {
        radius: a.radius, polygon: a.polygon, ringInner: a.ringInner, ringOuter: a.ringOuter, ringPoints: a.ringPoints,
        zoneType: a.zoneType, predatorRef: a.predatorRef, threatLevel: a.threatLevel, dominanceRank: a.dominanceRank,
      })
      await db.prepare(
        `INSERT INTO landmarks (id, map_id, q, r, name, category, world_id, region_id, population, zone_type, zone_shape, predator_ref, threat_level, dominance_rank, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, a.mapId, a.q, a.r, a.query, category, a.worldId, a.regionId ?? null, 0, zoneType, zoneShape, predatorRef, threatLevel, dominanceRank, now).run()
      return ok({ success: true, actionType: 'suggest_poi', landmarkId: id, name: a.query, category, worldId: a.worldId, mapId: a.mapId, q: a.q, r: a.r, hasZone: zoneShape !== null })
    }
    case 'update_poi': {
      if (!a.structureId) return err('"structureId" is required')
      const existing = await db.prepare('SELECT * FROM landmarks WHERE id = ?').bind(a.structureId).first() as (Record<string, unknown> & ExistingZoneFields) | null
      if (!existing) return err(`Landmark not found: ${a.structureId}`)
      if (a.polygon !== undefined && a.polygon.length < 3) return err('"polygon" requires at least 3 points')

      const sets: string[] = ['updated_at = ?']
      const vals: unknown[] = [now]
      if (a.name !== undefined) { sets.push('name = ?'); vals.push(a.name) }
      if (a.structureType !== undefined) { sets.push('category = ?'); vals.push(a.structureType) }
      if (a.q !== undefined) { sets.push('q = ?'); vals.push(a.q) }
      if (a.r !== undefined) { sets.push('r = ?'); vals.push(a.r) }
      if (a.regionId !== undefined) { sets.push('region_id = ?'); vals.push(a.regionId) }

      const zoneFieldsTouched = a.radius !== undefined || a.polygon !== undefined || a.ringInner !== undefined
        || a.ringOuter !== undefined || a.zoneType !== undefined || a.predatorRef !== undefined
        || a.threatLevel !== undefined || a.dominanceRank !== undefined
      if (zoneFieldsTouched) {
        const { zoneShape, zoneType, predatorRef, threatLevel, dominanceRank } = mergeZoneFields(existing, {
          radius: a.radius, polygon: a.polygon, ringInner: a.ringInner, ringOuter: a.ringOuter, ringPoints: a.ringPoints,
          zoneType: a.zoneType, predatorRef: a.predatorRef, threatLevel: a.threatLevel, dominanceRank: a.dominanceRank,
        })
        sets.push('zone_shape = ?', 'zone_type = ?', 'predator_ref = ?', 'threat_level = ?', 'dominance_rank = ?')
        vals.push(zoneShape, zoneType, predatorRef, threatLevel, dominanceRank)
      }

      vals.push(a.structureId)
      await db.prepare(`UPDATE landmarks SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
      return ok({ success: true, actionType: 'update_poi', landmarkId: a.structureId })
    }
    case 'query_zone': {
      if (!a.worldId || a.q === undefined || a.r === undefined) return err('"worldId", "q", and "r" are required')
      const zones = await resolveZonesAt(db, a.worldId, a.q, a.r)
      const inPerimeter = zones.some(z => z.zoneType === 'perimeter')
      return ok({ success: true, actionType: 'query_zone', worldId: a.worldId, q: a.q, r: a.r, zones, inPerimeter })
    }
    case 'list_zones': {
      if (!a.worldId) return err('"worldId" is required')
      const { results } = await db.prepare(
        'SELECT id, name, category, q, r, zone_type, zone_shape, predator_ref, threat_level, dominance_rank FROM landmarks WHERE world_id = ? AND zone_shape IS NOT NULL'
      ).bind(a.worldId).all() as {
        results: Array<{ id: string; name: string; category: string; q: number; r: number; zone_type: string | null; zone_shape: string | null; predator_ref: string | null; threat_level: number | null; dominance_rank: number | null }>
      }
      const zones = results
        .map(lm => {
          const zone = parseZoneShape(lm.zone_shape)
          if (!zone) return null
          return {
            landmarkId: lm.id, name: lm.name, category: lm.category, q: lm.q, r: lm.r, zoneType: lm.zone_type, zone,
            predator: lm.predator_ref, threatLevel: lm.threat_level, dominanceRank: lm.dominance_rank,
          }
        })
        .filter((z): z is NonNullable<typeof z> => z !== null)
        .filter(z => !a.zoneType || z.zoneType === a.zoneType)
      return ok({ success: true, actionType: 'list_zones', worldId: a.worldId, zones, count: zones.length })
    }
    case 'render_svg': {
      if (!a.worldId) return err('"worldId" is required')
      const vq = a.q ?? 0
      const vr = a.r ?? 0
      const vw = a.renderWidth
      const vh = a.renderHeight
      const { results: hexes } = await db.prepare('SELECT q, r, biome FROM hexes WHERE world_id = ? AND q >= ? AND q < ? AND r >= ? AND r < ?')
        .bind(a.worldId, vq, vq + vw, vr, vr + vh).all() as { results: RenderHex[] }
      const { results: landmarks } = await db.prepare(
        'SELECT id, name, q, r, zone_type, zone_shape FROM landmarks WHERE world_id = ? AND q >= ? AND q < ? AND r >= ? AND r < ?'
      ).bind(a.worldId, vq, vq + vw, vr, vr + vh).all() as { results: RenderLandmark[] }
      const registry = await getBiomeRegistry(db, a.worldId)
      const { svg, hexCount, structureCount, zoneCount, width, height } = buildMapSvg({
        hexes, registry, landmarks, q: vq, r: vr, width: vw, height: vh,
        showStructures: a.showStructures, showZones: a.showZones, showPerimeter: a.showPerimeter, gridLabels: a.gridLabels,
        highlight: a.highlight,
      })
      return ok({
        success: true, actionType: 'render_svg', worldId: a.worldId, svg,
        dimensions: { width, height },
        hexCount, structureCount, zoneCount,
      })
    }
  }
}
