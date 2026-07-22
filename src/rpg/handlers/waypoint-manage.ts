// Per-world waypoint registry + real-world-distance party movement support
// for the Gotland campaign (#328). Mirrors zone-type-manage.ts's/
// biome-manage.ts's exact registry pattern: the mechanism (this handler,
// migration 0021's tables) is reusable by any world, but the actual named
// places (Visby, Roma Kloster, Fårösund, Klintehamn) are only seeded into a
// world that opts in via `seed_defaults` — unlike zone types/biomes, this is
// deliberately NOT auto-seeded on world_manage.create/generate, since real
// Swedish place names only make sense for a Gotland-set campaign.

import { z } from 'zod'
import {
  matchAction,
  isGuidingError,
  formatGuidingError,
  CRUD_ALIASES,
  similarity,
} from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import { latLonToHex, hexToLatLon, type GeoOrigin } from '../utils/geo-transform'
import type { AppBindings } from '../../types'
import gotlandWaypoints from '../../../schema/seed-data/gotland-waypoints.json'
import gotlandDistanceMatrix from '../../../schema/seed-data/gotland-distance-matrix.json'

export const ACTIONS = [
  'register',
  'list',
  'get',
  'update',
  'delete',
  'validate',
  'seed_defaults',
  'calibrate',
  'hex_to_latlon',
] as const
type WaypointManageAction = (typeof ACTIONS)[number]
const ALIASES: Record<string, WaypointManageAction> = {
  ...CRUD_ALIASES,
  register: 'register',
  check: 'validate',
  seed: 'seed_defaults',
  seed_default: 'seed_defaults',
} as Record<string, WaypointManageAction>

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  waypointId: z.string().optional(),
  worldId: z.string().optional(),
  name: z.string().optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  q: z.number().optional(),
  r: z.number().optional(),
  kind: z.string().optional(),
  originLat: z.number().optional(),
  originLon: z.number().optional(),
  kmPerHex: z.number().optional(),
})

interface DefaultGotlandWaypoint {
  name: string
  lat: number
  lon: number
  kind: string
  q: number
  r: number
}
interface DefaultGotlandDistance {
  from: string
  to: string
  distanceKm: number | null
  routeSource: string
}

export const DEFAULT_GOTLAND_WAYPOINTS = gotlandWaypoints as DefaultGotlandWaypoint[]
export const DEFAULT_GOTLAND_DISTANCES = gotlandDistanceMatrix as DefaultGotlandDistance[]

export interface WaypointRow {
  id: string
  world_id: string
  name: string
  q: number
  r: number
  lat: number | null
  lon: number | null
  kind: string
}

/** Used by party-manage.ts to resolve a begin_march target/origin by id or name. */
export async function getWaypoint(
  db: D1Database,
  worldId: string,
  idOrName: string,
): Promise<WaypointRow | null> {
  const byId = (await db
    .prepare('SELECT * FROM waypoints WHERE world_id = ? AND id = ?')
    .bind(worldId, idOrName)
    .first()) as WaypointRow | null
  if (byId) return byId
  return (await db
    .prepare('SELECT * FROM waypoints WHERE world_id = ? AND name = ?')
    .bind(worldId, idOrName)
    .first()) as WaypointRow | null
}

export interface WaypointDistanceResult {
  found: boolean
  routable: boolean
  reason?: 'no_route_found' | 'not_precomputed'
  distanceKm?: number
}

/** Never a hard tool error — matches this repo's graceful-degradation philosophy for empty/incomplete registries. */
export async function getWaypointDistance(
  db: D1Database,
  worldId: string,
  fromWaypointId: string,
  toWaypointId: string,
): Promise<WaypointDistanceResult> {
  const row = (await db
    .prepare(
      'SELECT distance_km FROM waypoint_distances WHERE world_id = ? AND from_waypoint_id = ? AND to_waypoint_id = ?',
    )
    .bind(worldId, fromWaypointId, toWaypointId)
    .first()) as { distance_km: number | null } | null
  if (!row) return { found: false, routable: false, reason: 'not_precomputed' }
  if (row.distance_km === null) return { found: true, routable: false, reason: 'no_route_found' }
  return { found: true, routable: true, distanceKm: row.distance_km }
}

// #430 — also used by world_map.distance/pathfind for km-per-hex conversion.
export async function getGeoOrigin(db: D1Database, worldId: string): Promise<GeoOrigin | null> {
  const row = (await db
    .prepare(
      'SELECT geo_origin_lat, geo_origin_lon, geo_km_per_hex FROM world_state WHERE world_id = ?',
    )
    .bind(worldId)
    .first()) as {
    geo_origin_lat: number | null
    geo_origin_lon: number | null
    geo_km_per_hex: number | null
  } | null
  if (
    !row ||
    row.geo_origin_lat === null ||
    row.geo_origin_lon === null ||
    row.geo_km_per_hex === null
  )
    return null
  return {
    originLat: row.geo_origin_lat,
    originLon: row.geo_origin_lon,
    kmPerHex: row.geo_km_per_hex,
  }
}

export async function handleWaypointManage(
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
      if (a.q === undefined || a.r === undefined) return err('"q" and "r" are required')
      const world = await db.prepare('SELECT id FROM worlds WHERE id = ?').bind(a.worldId).first()
      if (!world) return err(`World not found: ${a.worldId}`)
      // #399 — lat/lon are only required for a world that has been geo-calibrated
      // (waypoint.calibrate). A purely grid/hex world has no meaningful geo
      // origin, so forcing placeholder lat/lon values there would store
      // fabricated data that looks real. For a calibrated world, lat/lon stay
      // required — dropping real geo data silently would be worse.
      const origin = await getGeoOrigin(db, a.worldId)
      if (origin && (a.lat === undefined || a.lon === undefined)) {
        return err('"lat" and "lon" are required for a geo-calibrated world')
      }
      const existing = await db
        .prepare('SELECT id FROM waypoints WHERE world_id = ? AND name = ?')
        .bind(a.worldId, a.name)
        .first()
      if (existing) return err(`Waypoint "${a.name}" already exists for this world`)
      const id = crypto.randomUUID()
      const kind = a.kind ?? 'settlement'
      const lat = a.lat ?? null
      const lon = a.lon ?? null
      await db
        .prepare(
          'INSERT INTO waypoints (id, world_id, name, q, r, lat, lon, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(id, a.worldId, a.name, a.q, a.r, lat, lon, kind, now, now)
        .run()
      return ok({
        success: true,
        actionType: 'register',
        waypointId: id,
        worldId: a.worldId,
        name: a.name,
        q: a.q,
        r: a.r,
        lat,
        lon,
        kind,
      })
    }
    case 'list': {
      if (!a.worldId) return err('"worldId" is required')
      const { results } = await db
        .prepare(
          'SELECT id, name, q, r, lat, lon, kind FROM waypoints WHERE world_id = ? ORDER BY name',
        )
        .bind(a.worldId)
        .all()
      return ok({
        success: true,
        actionType: 'list',
        worldId: a.worldId,
        waypoints: results,
        count: results.length,
      })
    }
    case 'get': {
      const targetId = a.id ?? a.waypointId
      if (!targetId && !(a.worldId && a.name))
        return err('"id"/"waypointId", or "worldId" + "name", is required')
      const row = targetId
        ? await db.prepare('SELECT * FROM waypoints WHERE id = ?').bind(targetId).first()
        : await db
            .prepare('SELECT * FROM waypoints WHERE world_id = ? AND name = ?')
            .bind(a.worldId, a.name)
            .first()
      if (!row) return err('Waypoint not found')
      return ok({ success: true, actionType: 'get', waypoint: row })
    }
    case 'update': {
      const targetId = a.id ?? a.waypointId
      if (!targetId) return err('"id" or "waypointId" is required')
      const existing = await db
        .prepare('SELECT id FROM waypoints WHERE id = ?')
        .bind(targetId)
        .first()
      if (!existing) return err(`Waypoint not found: ${targetId}`)
      const sets: string[] = ['updated_at = ?']
      const vals: unknown[] = [now]
      if (a.lat !== undefined) {
        sets.push('lat = ?')
        vals.push(a.lat)
      }
      if (a.lon !== undefined) {
        sets.push('lon = ?')
        vals.push(a.lon)
      }
      if (a.q !== undefined) {
        sets.push('q = ?')
        vals.push(a.q)
      }
      if (a.r !== undefined) {
        sets.push('r = ?')
        vals.push(a.r)
      }
      if (a.kind !== undefined) {
        sets.push('kind = ?')
        vals.push(a.kind)
      }
      vals.push(targetId)
      await db
        .prepare(`UPDATE waypoints SET ${sets.join(', ')} WHERE id = ?`)
        .bind(...vals)
        .run()
      return ok({ success: true, actionType: 'update', waypointId: targetId })
    }
    case 'delete': {
      const targetId = a.id ?? a.waypointId
      if (!targetId) return err('"id" or "waypointId" is required')
      const waypoint = (await db
        .prepare('SELECT world_id, name FROM waypoints WHERE id = ?')
        .bind(targetId)
        .first()) as { world_id: string; name: string } | null
      if (!waypoint) return err(`Waypoint not found: ${targetId}`)
      const partyRef = await db
        .prepare(
          'SELECT 1 FROM parties WHERE current_waypoint_id = ? OR travel_target_waypoint_id = ? LIMIT 1',
        )
        .bind(targetId, targetId)
        .first()
      if (partyRef)
        return err(
          `Cannot delete waypoint "${waypoint.name}" — referenced by an existing party's location or march target`,
        )
      await db.prepare('DELETE FROM waypoints WHERE id = ?').bind(targetId).run()
      await db
        .prepare('DELETE FROM waypoint_distances WHERE from_waypoint_id = ? OR to_waypoint_id = ?')
        .bind(targetId, targetId)
        .run()
      return ok({ success: true, actionType: 'delete', waypointId: targetId })
    }
    case 'validate': {
      if (!a.worldId || !a.name) return err('"worldId" and "name" are required')
      const row = await db
        .prepare('SELECT id FROM waypoints WHERE world_id = ? AND name = ?')
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
        .prepare('SELECT name FROM waypoints WHERE world_id = ?')
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
      const { results: existingRows } = (await db
        .prepare('SELECT name FROM waypoints WHERE world_id = ?')
        .bind(a.worldId)
        .all()) as { results: Array<{ name: string }> }
      const existingNames = new Set(existingRows.map((r) => r.name))
      let waypointsSeeded = 0
      const nameToId = new Map<string, string>()
      for (const wp of DEFAULT_GOTLAND_WAYPOINTS) {
        if (existingNames.has(wp.name)) {
          const row = (await db
            .prepare('SELECT id FROM waypoints WHERE world_id = ? AND name = ?')
            .bind(a.worldId, wp.name)
            .first()) as { id: string }
          nameToId.set(wp.name, row.id)
          continue
        }
        const id = crypto.randomUUID()
        await db
          .prepare(
            'INSERT INTO waypoints (id, world_id, name, q, r, lat, lon, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(id, a.worldId, wp.name, wp.q, wp.r, wp.lat, wp.lon, wp.kind, now, now)
          .run()
        nameToId.set(wp.name, id)
        waypointsSeeded++
      }
      let distancesSeeded = 0
      for (const dist of DEFAULT_GOTLAND_DISTANCES) {
        const fromId = nameToId.get(dist.from)
        const toId = nameToId.get(dist.to)
        if (!fromId || !toId) continue
        const existingDist = await db
          .prepare(
            'SELECT 1 FROM waypoint_distances WHERE world_id = ? AND from_waypoint_id = ? AND to_waypoint_id = ?',
          )
          .bind(a.worldId, fromId, toId)
          .first()
        if (existingDist) continue
        await db
          .prepare(
            'INSERT INTO waypoint_distances (world_id, from_waypoint_id, to_waypoint_id, distance_km, route_source, computed_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .bind(a.worldId, fromId, toId, dist.distanceKm, dist.routeSource, now)
          .run()
        distancesSeeded++
      }
      return ok({
        success: true,
        actionType: 'seed_defaults',
        worldId: a.worldId,
        waypointsSeeded,
        totalDefaultWaypoints: DEFAULT_GOTLAND_WAYPOINTS.length,
        distancesSeeded,
        totalDefaultDistances: DEFAULT_GOTLAND_DISTANCES.length,
      })
    }
    case 'calibrate': {
      if (!a.worldId) return err('"worldId" is required')
      if (a.originLat === undefined || a.originLon === undefined || a.kmPerHex === undefined) {
        return err('"originLat", "originLon", and "kmPerHex" are required')
      }
      if (a.kmPerHex <= 0) return err('"kmPerHex" must be greater than 0')
      const world = await db.prepare('SELECT id FROM worlds WHERE id = ?').bind(a.worldId).first()
      if (!world) return err(`World not found: ${a.worldId}`)
      await db
        .prepare(
          `INSERT INTO world_state (world_id, geo_origin_lat, geo_origin_lon, geo_km_per_hex)
                  VALUES (?, ?, ?, ?)
                  ON CONFLICT(world_id) DO UPDATE SET
                    geo_origin_lat = excluded.geo_origin_lat,
                    geo_origin_lon = excluded.geo_origin_lon,
                    geo_km_per_hex = excluded.geo_km_per_hex`,
        )
        .bind(a.worldId, a.originLat, a.originLon, a.kmPerHex)
        .run()
      return ok({
        success: true,
        actionType: 'calibrate',
        worldId: a.worldId,
        originLat: a.originLat,
        originLon: a.originLon,
        kmPerHex: a.kmPerHex,
      })
    }
    case 'hex_to_latlon': {
      if (!a.worldId) return err('"worldId" is required')
      if (a.q === undefined || a.r === undefined) return err('"q" and "r" are required')
      const origin = await getGeoOrigin(db, a.worldId)
      if (!origin)
        return err(`World ${a.worldId} has not been geo-calibrated yet — call "calibrate" first`)
      const latLon = hexToLatLon({ q: a.q, r: a.r }, origin)
      return ok({
        success: true,
        actionType: 'hex_to_latlon',
        worldId: a.worldId,
        q: a.q,
        r: a.r,
        lat: latLon.lat,
        lon: latLon.lon,
      })
    }
  }
}

/** Exported for the offline precompute script and any future narrator-added waypoint. */
export function computeHexForLatLon(
  lat: number,
  lon: number,
  origin: GeoOrigin,
): { q: number; r: number } {
  return latLonToHex({ lat, lon }, origin)
}
