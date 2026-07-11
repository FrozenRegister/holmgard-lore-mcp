// Direct handler tests for waypoint-manage (#328 — Gotland real-world-distance
// party movement)
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'
import {
  handleWaypointManage, getWaypoint, getWaypointDistance, computeHexForLatLon,
  DEFAULT_GOTLAND_WAYPOINTS, DEFAULT_GOTLAND_DISTANCES,
} from '../rpg/handlers/waypoint-manage'

describe('handleWaypointManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)
  const WORLD = 'world-1'

  async function createWorld(id = WORLD) {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare('INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, 'Test World', 'abc123', 100, 100, now, now).run()
  }

  it('returns guiding error for unknown action', async () => {
    const r = await handleWaypointManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  it('returns a schema error for malformed input (e.g. lat as a non-numeric string)', async () => {
    const r = await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Visby', lat: 'not-a-number', lon: 18.2948, q: 0, r: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  // register
  it('register requires worldId and name', async () => {
    const r = await handleWaypointManage(db(), { action: 'register' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('register requires lat and lon', async () => {
    await createWorld()
    const r = await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Visby', q: 0, r: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('lat')
  })

  it('register requires q and r', async () => {
    await createWorld()
    const r = await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Visby', lat: 57.6349, lon: 18.2948 })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('"q"')
  })

  it('register returns not found for unknown world', async () => {
    const r = await handleWaypointManage(db(), { action: 'register', worldId: 'no-world', name: 'Visby', lat: 57.6349, lon: 18.2948, q: 0, r: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('register creates a waypoint with default kind', async () => {
    await createWorld()
    const r = await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Visby', lat: 57.6349, lon: 18.2948, q: 0, r: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.kind).toBe('settlement')
    expect(body.waypointId).toBeTruthy()
  })

  it('register creates a waypoint with explicit kind', async () => {
    await createWorld()
    const r = await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Visby', lat: 57.6349, lon: 18.2948, q: 0, r: 0, kind: 'port' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.kind).toBe('port')
  })

  it('register rejects a duplicate name for the same world', async () => {
    await createWorld()
    await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Visby', lat: 57.6349, lon: 18.2948, q: 0, r: 0 })
    const r = await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Visby', lat: 57.6349, lon: 18.2948, q: 0, r: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('already exists')
  })

  // list
  it('list requires worldId', async () => {
    const r = await handleWaypointManage(db(), { action: 'list' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('list returns empty for a world with no waypoints', async () => {
    await createWorld()
    const r = await handleWaypointManage(db(), { action: 'list', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBe(0)
  })

  it('list returns registered waypoints ordered by name', async () => {
    await createWorld()
    await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Visby', lat: 57.6349, lon: 18.2948, q: 0, r: 0 })
    await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Klintehamn', lat: 57.3897, lon: 18.2033, q: -4, r: 6 })
    const r = await handleWaypointManage(db(), { action: 'list', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.count).toBe(2)
    expect(body.waypoints[0].name).toBe('Klintehamn')
  })

  // get
  it('get requires id/waypointId or worldId+name', async () => {
    const r = await handleWaypointManage(db(), { action: 'get' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get returns not found for an unknown id', async () => {
    const r = await handleWaypointManage(db(), { action: 'get', id: 'no-such-waypoint' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get fetches by id', async () => {
    await createWorld()
    const created = JSON.parse((await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Visby', lat: 57.6349, lon: 18.2948, q: 0, r: 0 })).content[0].text)
    const r = await handleWaypointManage(db(), { action: 'get', id: created.waypointId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.waypoint.name).toBe('Visby')
  })

  it('get fetches by worldId + name', async () => {
    await createWorld()
    await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Visby', lat: 57.6349, lon: 18.2948, q: 0, r: 0 })
    const r = await handleWaypointManage(db(), { action: 'get', worldId: WORLD, name: 'Visby' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.waypoint.name).toBe('Visby')
  })

  // update
  it('update requires id or waypointId', async () => {
    const r = await handleWaypointManage(db(), { action: 'update' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update returns not found for an unknown id', async () => {
    const r = await handleWaypointManage(db(), { action: 'update', id: 'no-such-waypoint', kind: 'port' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update applies all fields', async () => {
    await createWorld()
    const created = JSON.parse((await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Visby', lat: 57.6349, lon: 18.2948, q: 0, r: 0 })).content[0].text)
    const r = await handleWaypointManage(db(), { action: 'update', id: created.waypointId, lat: 57.7, lon: 18.3, q: 1, r: 1, kind: 'port' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    const fetched = JSON.parse((await handleWaypointManage(db(), { action: 'get', id: created.waypointId })).content[0].text)
    expect(fetched.waypoint.lat).toBe(57.7)
    expect(fetched.waypoint.q).toBe(1)
    expect(fetched.waypoint.kind).toBe('port')
  })

  it('update only touches the fields explicitly provided, leaving the rest unchanged', async () => {
    await createWorld()
    const created = JSON.parse((await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Visby', lat: 57.6349, lon: 18.2948, q: 0, r: 0, kind: 'port' })).content[0].text)
    await handleWaypointManage(db(), { action: 'update', id: created.waypointId, kind: 'landmark' })
    const fetched = JSON.parse((await handleWaypointManage(db(), { action: 'get', id: created.waypointId })).content[0].text)
    expect(fetched.waypoint.kind).toBe('landmark')
    expect(fetched.waypoint.lat).toBe(57.6349)
    expect(fetched.waypoint.lon).toBe(18.2948)
    expect(fetched.waypoint.q).toBe(0)
    expect(fetched.waypoint.r).toBe(0)
  })

  it('update can change lat/lon without touching kind', async () => {
    await createWorld()
    const created = JSON.parse((await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Visby', lat: 57.6349, lon: 18.2948, q: 0, r: 0, kind: 'port' })).content[0].text)
    await handleWaypointManage(db(), { action: 'update', id: created.waypointId, lat: 57.7 })
    const fetched = JSON.parse((await handleWaypointManage(db(), { action: 'get', id: created.waypointId })).content[0].text)
    expect(fetched.waypoint.lat).toBe(57.7)
    expect(fetched.waypoint.kind).toBe('port')
  })

  // delete
  it('delete requires id or waypointId', async () => {
    const r = await handleWaypointManage(db(), { action: 'delete' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('delete returns not found for an unknown id', async () => {
    const r = await handleWaypointManage(db(), { action: 'delete', id: 'no-such-waypoint' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('delete removes an unreferenced waypoint', async () => {
    await createWorld()
    const created = JSON.parse((await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Visby', lat: 57.6349, lon: 18.2948, q: 0, r: 0 })).content[0].text)
    const r = await handleWaypointManage(db(), { action: 'delete', id: created.waypointId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    const fetched = JSON.parse((await handleWaypointManage(db(), { action: 'get', id: created.waypointId })).content[0].text)
    expect(fetched.error).toBe(true)
  })

  it('delete rejects removal of a waypoint referenced by a party\'s current_waypoint_id', async () => {
    await createWorld()
    const created = JSON.parse((await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Visby', lat: 57.6349, lon: 18.2948, q: 0, r: 0 })).content[0].text)
    const now = new Date().toISOString()
    await env.RPG_DB.prepare('INSERT INTO parties (id, name, world_id, created_at, updated_at, current_waypoint_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('party-1', 'Test Party', WORLD, now, now, created.waypointId).run()
    const r = await handleWaypointManage(db(), { action: 'delete', id: created.waypointId })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('referenced by an existing party')
  })

  // validate
  it('validate requires worldId and name', async () => {
    const r = await handleWaypointManage(db(), { action: 'validate' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('validate returns valid: true for an existing waypoint', async () => {
    await createWorld()
    await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Visby', lat: 57.6349, lon: 18.2948, q: 0, r: 0 })
    const r = await handleWaypointManage(db(), { action: 'validate', worldId: WORLD, name: 'Visby' })
    const body = JSON.parse(r.content[0].text)
    expect(body.valid).toBe(true)
  })

  it('validate returns valid: false with didYouMean for a near-miss, ranked by similarity', async () => {
    await createWorld()
    await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Visby', lat: 57.6349, lon: 18.2948, q: 0, r: 0 })
    await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Klintehamn', lat: 57.3897, lon: 18.2033, q: -4, r: 6 })
    const r = await handleWaypointManage(db(), { action: 'validate', worldId: WORLD, name: 'Visbi' })
    const body = JSON.parse(r.content[0].text)
    expect(body.valid).toBe(false)
    expect(body.didYouMean[0]).toBe('Visby')
  })

  // seed_defaults
  it('seed_defaults requires worldId', async () => {
    const r = await handleWaypointManage(db(), { action: 'seed_defaults' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('seed_defaults returns not found for an unknown world', async () => {
    const r = await handleWaypointManage(db(), { action: 'seed_defaults', worldId: 'no-world' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('seed_defaults seeds all default waypoints and distances for a fresh world', async () => {
    await createWorld()
    const r = await handleWaypointManage(db(), { action: 'seed_defaults', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.waypointsSeeded).toBe(DEFAULT_GOTLAND_WAYPOINTS.length)
    expect(body.totalDefaultWaypoints).toBe(DEFAULT_GOTLAND_WAYPOINTS.length)
    expect(body.distancesSeeded).toBe(DEFAULT_GOTLAND_DISTANCES.length)
    expect(body.totalDefaultDistances).toBe(DEFAULT_GOTLAND_DISTANCES.length)
  })

  it('seed_defaults is idempotent — re-seeding inserts nothing new', async () => {
    await createWorld()
    await handleWaypointManage(db(), { action: 'seed_defaults', worldId: WORLD })
    const r = await handleWaypointManage(db(), { action: 'seed_defaults', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.waypointsSeeded).toBe(0)
    expect(body.distancesSeeded).toBe(0)
  })

  it('seed_defaults only seeds missing waypoints when some already exist', async () => {
    await createWorld()
    await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Visby', lat: 57.6349, lon: 18.2948, q: 0, r: 0 })
    const r = await handleWaypointManage(db(), { action: 'seed_defaults', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.waypointsSeeded).toBe(DEFAULT_GOTLAND_WAYPOINTS.length - 1)
  })

  // calibrate
  it('calibrate requires worldId', async () => {
    const r = await handleWaypointManage(db(), { action: 'calibrate', originLat: 57.6, originLon: 18.3, kmPerHex: 3 })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('calibrate requires originLat/originLon/kmPerHex', async () => {
    await createWorld()
    const r = await handleWaypointManage(db(), { action: 'calibrate', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('calibrate rejects a non-positive kmPerHex', async () => {
    await createWorld()
    const r = await handleWaypointManage(db(), { action: 'calibrate', worldId: WORLD, originLat: 57.6, originLon: 18.3, kmPerHex: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('calibrate returns not found for unknown world', async () => {
    const r = await handleWaypointManage(db(), { action: 'calibrate', worldId: 'no-world', originLat: 57.6, originLon: 18.3, kmPerHex: 3 })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('calibrate upserts world_state geo columns', async () => {
    await createWorld()
    const r = await handleWaypointManage(db(), { action: 'calibrate', worldId: WORLD, originLat: 57.6349, originLon: 18.2948, kmPerHex: 3 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    const row = await env.RPG_DB.prepare('SELECT geo_origin_lat, geo_origin_lon, geo_km_per_hex FROM world_state WHERE world_id = ?').bind(WORLD).first() as any
    expect(row.geo_origin_lat).toBe(57.6349)
    expect(row.geo_km_per_hex).toBe(3)
  })

  it('calibrate can be called again to update an existing world_state row', async () => {
    await createWorld()
    await handleWaypointManage(db(), { action: 'calibrate', worldId: WORLD, originLat: 57.6349, originLon: 18.2948, kmPerHex: 3 })
    await handleWaypointManage(db(), { action: 'calibrate', worldId: WORLD, originLat: 57.0, originLon: 18.0, kmPerHex: 5 })
    const row = await env.RPG_DB.prepare('SELECT geo_origin_lat, geo_km_per_hex FROM world_state WHERE world_id = ?').bind(WORLD).first() as any
    expect(row.geo_origin_lat).toBe(57.0)
    expect(row.geo_km_per_hex).toBe(5)
  })

  // hex_to_latlon
  it('hex_to_latlon requires worldId', async () => {
    const r = await handleWaypointManage(db(), { action: 'hex_to_latlon', q: 0, r: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('hex_to_latlon requires q and r', async () => {
    await createWorld()
    const r = await handleWaypointManage(db(), { action: 'hex_to_latlon', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('hex_to_latlon errors when the world has not been calibrated', async () => {
    await createWorld()
    const r = await handleWaypointManage(db(), { action: 'hex_to_latlon', worldId: WORLD, q: 0, r: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('geo-calibrated')
  })

  it('hex_to_latlon returns the origin lat/lon for hex (0, 0)', async () => {
    await createWorld()
    await handleWaypointManage(db(), { action: 'calibrate', worldId: WORLD, originLat: 57.6349, originLon: 18.2948, kmPerHex: 3 })
    const r = await handleWaypointManage(db(), { action: 'hex_to_latlon', worldId: WORLD, q: 0, r: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.lat).toBeCloseTo(57.6349, 6)
    expect(body.lon).toBeCloseTo(18.2948, 6)
  })

  // getWaypoint (used by party-manage.ts)
  it('getWaypoint resolves by id', async () => {
    await createWorld()
    const created = JSON.parse((await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Visby', lat: 57.6349, lon: 18.2948, q: 0, r: 0 })).content[0].text)
    const found = await getWaypoint(env.RPG_DB, WORLD, created.waypointId)
    expect(found?.name).toBe('Visby')
  })

  it('getWaypoint resolves by name', async () => {
    await createWorld()
    await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'Visby', lat: 57.6349, lon: 18.2948, q: 0, r: 0 })
    const found = await getWaypoint(env.RPG_DB, WORLD, 'Visby')
    expect(found?.name).toBe('Visby')
  })

  it('getWaypoint returns null for an unknown id/name', async () => {
    await createWorld()
    const found = await getWaypoint(env.RPG_DB, WORLD, 'no-such-waypoint')
    expect(found).toBeNull()
  })

  // getWaypointDistance (used by party-manage.ts)
  it('getWaypointDistance returns not_precomputed when no row exists', async () => {
    const result = await getWaypointDistance(env.RPG_DB, WORLD, 'a', 'b')
    expect(result).toEqual({ found: false, routable: false, reason: 'not_precomputed' })
  })

  it('getWaypointDistance returns no_route_found when distance_km is NULL', async () => {
    await createWorld()
    const aId = (await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'A', lat: 57.6, lon: 18.2, q: 0, r: 0 }).then(r => JSON.parse(r.content[0].text))).waypointId
    const bId = (await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'B', lat: 57.7, lon: 18.3, q: 1, r: 1 }).then(r => JSON.parse(r.content[0].text))).waypointId
    const now = new Date().toISOString()
    await env.RPG_DB.prepare('INSERT INTO waypoint_distances (world_id, from_waypoint_id, to_waypoint_id, distance_km, route_source, computed_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(WORLD, aId, bId, null, 'osrm_foot_v1_no_route', now).run()
    const result = await getWaypointDistance(env.RPG_DB, WORLD, aId, bId)
    expect(result).toEqual({ found: true, routable: false, reason: 'no_route_found' })
  })

  it('getWaypointDistance returns the distance when routable', async () => {
    await createWorld()
    const aId = (await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'A', lat: 57.6, lon: 18.2, q: 0, r: 0 }).then(r => JSON.parse(r.content[0].text))).waypointId
    const bId = (await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name: 'B', lat: 57.7, lon: 18.3, q: 1, r: 1 }).then(r => JSON.parse(r.content[0].text))).waypointId
    const now = new Date().toISOString()
    await env.RPG_DB.prepare('INSERT INTO waypoint_distances (world_id, from_waypoint_id, to_waypoint_id, distance_km, route_source, computed_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(WORLD, aId, bId, 18.26, 'osrm_foot_v1', now).run()
    const result = await getWaypointDistance(env.RPG_DB, WORLD, aId, bId)
    expect(result).toEqual({ found: true, routable: true, distanceKm: 18.26 })
  })

  // computeHexForLatLon (used by the offline precompute script)
  it('computeHexForLatLon derives the origin waypoint\'s own hex as (0, 0)', () => {
    const origin = { originLat: 57.6349, originLon: 18.2948, kmPerHex: 3 }
    expect(computeHexForLatLon(57.6349, 18.2948, origin)).toEqual({ q: 0, r: 0 })
  })

  it('computeHexForLatLon derives a non-origin waypoint\'s hex position', () => {
    const origin = { originLat: 57.6349, originLon: 18.2948, kmPerHex: 3 }
    expect(computeHexForLatLon(57.5388, 18.4677, origin)).toEqual({ q: 1, r: 2 }) // Roma Kloster
  })
})
