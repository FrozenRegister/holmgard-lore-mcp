// Direct handler tests for party-manage's #328 additions (begin_march,
// get_march_status, tickAllPartiesMarch) — Gotland real-world-distance
// party movement.
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handlePartyManage, tickAllPartiesMarch } from '../rpg/handlers/party-manage'
import { handleWaypointManage } from '../rpg/handlers/waypoint-manage'

describe('handlePartyManage — waypoint march (#328)', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)
  const WORLD = 'world-1'

  async function createWorld(id = WORLD) {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare('INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, 'Test World', 'abc123', 100, 100, now, now).run()
  }

  async function createParty(worldId: string | null = WORLD) {
    const r = await handlePartyManage(db(), { action: 'create', name: 'Test Party', worldId: worldId ?? undefined })
    return JSON.parse(r.content[0].text).partyId as string
  }

  async function registerWaypoint(name: string, lat: number, lon: number, q: number, r: number) {
    const res = JSON.parse((await handleWaypointManage(db(), { action: 'register', worldId: WORLD, name, lat, lon, q, r })).content[0].text)
    return res.waypointId as string
  }

  async function setDistance(fromId: string, toId: string, distanceKm: number | null) {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare('INSERT INTO waypoint_distances (world_id, from_waypoint_id, to_waypoint_id, distance_km, route_source, computed_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(WORLD, fromId, toId, distanceKm, distanceKm === null ? 'osrm_foot_v1_no_route' : 'osrm_foot_v1', now).run()
  }

  // ── begin_march ──────────────────────────────────────────────────────────

  it('begin_march requires partyId', async () => {
    const r = await handlePartyManage(db(), { action: 'begin_march', toWaypointName: 'Visby' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('begin_march accepts "id" as an alias for "partyId"', async () => {
    await createWorld()
    const visbyId = await registerWaypoint('Visby', 57.6349, 18.2948, 0, 0)
    const romaId = await registerWaypoint('Roma Kloster', 57.5388, 18.4677, 1, 2)
    await setDistance(visbyId, romaId, 18.26)
    const partyId = await createParty()

    const r = await handlePartyManage(db(), { action: 'begin_march', id: partyId, fromWaypointName: 'Visby', toWaypointName: 'Roma Kloster' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.blocked).toBe(false)
  })

  it('begin_march requires toWaypointId or toWaypointName', async () => {
    await createWorld()
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'begin_march', partyId })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('begin_march returns not found for an unknown party', async () => {
    const r = await handlePartyManage(db(), { action: 'begin_march', partyId: 'no-party', toWaypointName: 'Visby' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('begin_march errors when the party has no world_id', async () => {
    const partyId = await createParty(null)
    const r = await handlePartyManage(db(), { action: 'begin_march', partyId, toWaypointName: 'Visby' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('world_id')
  })

  it('begin_march errors when the target waypoint does not exist', async () => {
    await createWorld()
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'begin_march', partyId, toWaypointName: 'Nowhere', fromWaypointName: 'Nowhere' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('Waypoint not found')
  })

  it('begin_march errors when the party has no current waypoint and no fromWaypoint is supplied', async () => {
    await createWorld()
    await registerWaypoint('Visby', 57.6349, 18.2948, 0, 0)
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'begin_march', partyId, toWaypointName: 'Visby' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('no current waypoint')
  })

  it('begin_march errors when the fromWaypoint does not exist', async () => {
    await createWorld()
    await registerWaypoint('Visby', 57.6349, 18.2948, 0, 0)
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'begin_march', partyId, toWaypointName: 'Visby', fromWaypointName: 'Nowhere' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('Waypoint not found')
  })

  it('begin_march returns a structured blocked response and does not mutate party state when not precomputed', async () => {
    await createWorld()
    const visbyId = await registerWaypoint('Visby', 57.6349, 18.2948, 0, 0)
    await registerWaypoint('Klintehamn', 57.3897, 18.2033, -4, 6)
    const partyId = await createParty()

    const r = await handlePartyManage(db(), { action: 'begin_march', partyId, fromWaypointName: 'Visby', toWaypointName: 'Klintehamn' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.blocked).toBe(true)
    expect(body.reason).toBe('not_precomputed')

    const party = await env.RPG_DB.prepare('SELECT travel_status, travel_target_waypoint_id FROM parties WHERE id = ?').bind(partyId).first() as any
    expect(party.travel_status).toBe('stationary')
    expect(party.travel_target_waypoint_id).toBeNull()
    void visbyId
  })

  it('begin_march returns a structured blocked response when distance_km is NULL (no route found)', async () => {
    await createWorld()
    const visbyId = await registerWaypoint('Visby', 57.6349, 18.2948, 0, 0)
    const farosundId = await registerWaypoint('Fårösund', 57.8607, 18.9757, 11, -6)
    await setDistance(visbyId, farosundId, null)
    const partyId = await createParty()

    const r = await handlePartyManage(db(), { action: 'begin_march', partyId, fromWaypointName: 'Visby', toWaypointName: 'Fårösund' })
    const body = JSON.parse(r.content[0].text)
    expect(body.blocked).toBe(true)
    expect(body.reason).toBe('no_route_found')
  })

  it('begin_march starts a march using the party\'s current_waypoint_id when fromWaypoint is omitted', async () => {
    await createWorld()
    const visbyId = await registerWaypoint('Visby', 57.6349, 18.2948, 0, 0)
    const romaId = await registerWaypoint('Roma Kloster', 57.5388, 18.4677, 1, 2)
    await setDistance(visbyId, romaId, 18.26)
    const partyId = await createParty()
    await env.RPG_DB.prepare('UPDATE parties SET current_waypoint_id = ? WHERE id = ?').bind(visbyId, partyId).run()

    const r = await handlePartyManage(db(), { action: 'begin_march', partyId, toWaypointName: 'Roma Kloster' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.blocked).toBe(false)
    expect(body.distanceKm).toBe(18.26)
    expect(body.travelStatus).toBe('marching')

    const party = await env.RPG_DB.prepare('SELECT travel_status, travel_target_waypoint_id, travel_remaining_km FROM parties WHERE id = ?').bind(partyId).first() as any
    expect(party.travel_status).toBe('marching')
    expect(party.travel_target_waypoint_id).toBe(romaId)
    expect(party.travel_remaining_km).toBe(18.26)
  })

  it('begin_march accepts fromWaypointId/toWaypointId directly (not just names)', async () => {
    await createWorld()
    const visbyId = await registerWaypoint('Visby', 57.6349, 18.2948, 0, 0)
    const romaId = await registerWaypoint('Roma Kloster', 57.5388, 18.4677, 1, 2)
    await setDistance(visbyId, romaId, 18.26)
    const partyId = await createParty()

    const r = await handlePartyManage(db(), { action: 'begin_march', partyId, fromWaypointId: visbyId, toWaypointId: romaId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.blocked).toBe(false)
    expect(body.toWaypoint.id).toBe(romaId)
  })

  it('begin_march accepts an explicit pace override', async () => {
    await createWorld()
    const visbyId = await registerWaypoint('Visby', 57.6349, 18.2948, 0, 0)
    const romaId = await registerWaypoint('Roma Kloster', 57.5388, 18.4677, 1, 2)
    await setDistance(visbyId, romaId, 18.26)
    const partyId = await createParty()

    await handlePartyManage(db(), { action: 'begin_march', partyId, fromWaypointName: 'Visby', toWaypointName: 'Roma Kloster', pace: 40 })
    const party = await env.RPG_DB.prepare('SELECT travel_pace_km_per_day FROM parties WHERE id = ?').bind(partyId).first() as any
    expect(party.travel_pace_km_per_day).toBe(40)
  })

  it('begin_march leaves the default pace untouched when no override is given', async () => {
    await createWorld()
    const visbyId = await registerWaypoint('Visby', 57.6349, 18.2948, 0, 0)
    const romaId = await registerWaypoint('Roma Kloster', 57.5388, 18.4677, 1, 2)
    await setDistance(visbyId, romaId, 18.26)
    const partyId = await createParty()

    await handlePartyManage(db(), { action: 'begin_march', partyId, fromWaypointName: 'Visby', toWaypointName: 'Roma Kloster' })
    const party = await env.RPG_DB.prepare('SELECT travel_pace_km_per_day FROM parties WHERE id = ?').bind(partyId).first() as any
    expect(party.travel_pace_km_per_day).toBe(24) // the D1 column DEFAULT, never hardcoded in .ts
  })

  // ── get_march_status ─────────────────────────────────────────────────────

  it('get_march_status requires partyId', async () => {
    const r = await handlePartyManage(db(), { action: 'get_march_status' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_march_status returns not found for an unknown party', async () => {
    const r = await handlePartyManage(db(), { action: 'get_march_status', partyId: 'no-party' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_march_status accepts "id" as an alias for "partyId"', async () => {
    await createWorld()
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'get_march_status', id: partyId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.travelStatus).toBe('stationary')
  })

  it('get_march_status reports stationary with null waypoints for a fresh party', async () => {
    await createWorld()
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'get_march_status', partyId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.travelStatus).toBe('stationary')
    expect(body.currentWaypoint).toBeNull()
    expect(body.targetWaypoint).toBeNull()
  })

  it('get_march_status reports resolved waypoint names while marching', async () => {
    await createWorld()
    const visbyId = await registerWaypoint('Visby', 57.6349, 18.2948, 0, 0)
    const romaId = await registerWaypoint('Roma Kloster', 57.5388, 18.4677, 1, 2)
    await setDistance(visbyId, romaId, 18.26)
    const partyId = await createParty()
    await env.RPG_DB.prepare('UPDATE parties SET current_waypoint_id = ? WHERE id = ?').bind(visbyId, partyId).run()
    await handlePartyManage(db(), { action: 'begin_march', partyId, toWaypointName: 'Roma Kloster' })

    const r = await handlePartyManage(db(), { action: 'get_march_status', partyId })
    const body = JSON.parse(r.content[0].text)
    expect(body.travelStatus).toBe('marching')
    expect(body.targetWaypoint.name).toBe('Roma Kloster')
    expect(body.remainingKm).toBe(18.26)
  })

  // ── tickAllPartiesMarch ──────────────────────────────────────────────────

  it('tickAllPartiesMarch defaults daysToAdvance to 1 when omitted', async () => {
    await createWorld()
    const visbyId = await registerWaypoint('Visby', 57.6349, 18.2948, 0, 0)
    const farosundId = await registerWaypoint('Fårösund', 57.8607, 18.9757, 11, -6)
    await setDistance(visbyId, farosundId, 54.22)
    const partyId = await createParty()
    await env.RPG_DB.prepare('UPDATE parties SET current_waypoint_id = ? WHERE id = ?').bind(visbyId, partyId).run()
    await handlePartyManage(db(), { action: 'begin_march', partyId, toWaypointName: 'Fårösund' })

    const results = await tickAllPartiesMarch(env.RPG_DB, WORLD)
    expect(results).toEqual([{ partyId, status: 'marching', remainingKm: 54.22 - 24 }])
  })

  it('tickAllPartiesMarch resolves exact and overshoot arrival, discarding leftover budget', async () => {
    await createWorld()
    const visbyId = await registerWaypoint('Visby', 57.6349, 18.2948, 0, 0)
    const romaId = await registerWaypoint('Roma Kloster', 57.5388, 18.4677, 1, 2)
    await setDistance(visbyId, romaId, 18.26)
    const partyId = await createParty()
    await env.RPG_DB.prepare('UPDATE parties SET current_waypoint_id = ? WHERE id = ?').bind(visbyId, partyId).run()
    await handlePartyManage(db(), { action: 'begin_march', partyId, toWaypointName: 'Roma Kloster' })

    const results = await tickAllPartiesMarch(env.RPG_DB, WORLD, 1)
    expect(results).toEqual([{ partyId, status: 'arrived', remainingKm: 0, arrivedAtWaypointId: romaId }])

    const party = await env.RPG_DB.prepare('SELECT current_waypoint_id, travel_target_waypoint_id, travel_remaining_km, travel_status, current_hex_q, current_hex_r FROM parties WHERE id = ?').bind(partyId).first() as any
    expect(party.current_waypoint_id).toBe(romaId)
    expect(party.travel_target_waypoint_id).toBeNull()
    expect(party.travel_remaining_km).toBeNull()
    expect(party.travel_status).toBe('stationary')
    expect(party.current_hex_q).toBe(1)
    expect(party.current_hex_r).toBe(2)
  })

  it('tickAllPartiesMarch keeps a party marching when distance remains after the tick', async () => {
    await createWorld()
    const visbyId = await registerWaypoint('Visby', 57.6349, 18.2948, 0, 0)
    const farosundId = await registerWaypoint('Fårösund', 57.8607, 18.9757, 11, -6)
    await setDistance(visbyId, farosundId, 54.22)
    const partyId = await createParty()
    await env.RPG_DB.prepare('UPDATE parties SET current_waypoint_id = ? WHERE id = ?').bind(visbyId, partyId).run()
    await handlePartyManage(db(), { action: 'begin_march', partyId, toWaypointName: 'Fårösund' })

    const results = await tickAllPartiesMarch(env.RPG_DB, WORLD, 1)
    expect(results).toEqual([{ partyId, status: 'marching', remainingKm: 54.22 - 24 }])

    const party = await env.RPG_DB.prepare('SELECT travel_status, travel_remaining_km FROM parties WHERE id = ?').bind(partyId).first() as any
    expect(party.travel_status).toBe('marching')
    expect(party.travel_remaining_km).toBeCloseTo(30.22, 6)
  })

  it('tickAllPartiesMarch resolves multiple marching parties in one world independently', async () => {
    await createWorld()
    const visbyId = await registerWaypoint('Visby', 57.6349, 18.2948, 0, 0)
    const romaId = await registerWaypoint('Roma Kloster', 57.5388, 18.4677, 1, 2)
    const farosundId = await registerWaypoint('Fårösund', 57.8607, 18.9757, 11, -6)
    await setDistance(visbyId, romaId, 18.26)
    await setDistance(visbyId, farosundId, 54.22)

    const partyA = await createParty()
    await env.RPG_DB.prepare('UPDATE parties SET current_waypoint_id = ? WHERE id = ?').bind(visbyId, partyA).run()
    await handlePartyManage(db(), { action: 'begin_march', partyId: partyA, toWaypointName: 'Roma Kloster' })

    const partyB = await createParty()
    await env.RPG_DB.prepare('UPDATE parties SET current_waypoint_id = ? WHERE id = ?').bind(visbyId, partyB).run()
    await handlePartyManage(db(), { action: 'begin_march', partyId: partyB, toWaypointName: 'Fårösund' })

    const results = await tickAllPartiesMarch(env.RPG_DB, WORLD, 1)
    const byId = new Map(results.map(r => [r.partyId, r]))
    expect(byId.get(partyA)?.status).toBe('arrived')
    expect(byId.get(partyB)?.status).toBe('marching')
  })

  it('tickAllPartiesMarch leaves non-marching parties untouched', async () => {
    await createWorld()
    const partyId = await createParty()
    const results = await tickAllPartiesMarch(env.RPG_DB, WORLD, 1)
    expect(results).toEqual([])
    const party = await env.RPG_DB.prepare('SELECT travel_status FROM parties WHERE id = ?').bind(partyId).first() as any
    expect(party.travel_status).toBe('stationary')
  })

  it('tickAllPartiesMarch supports advancing multiple days in one call', async () => {
    await createWorld()
    const visbyId = await registerWaypoint('Visby', 57.6349, 18.2948, 0, 0)
    const farosundId = await registerWaypoint('Fårösund', 57.8607, 18.9757, 11, -6)
    await setDistance(visbyId, farosundId, 54.22)
    const partyId = await createParty()
    await env.RPG_DB.prepare('UPDATE parties SET current_waypoint_id = ? WHERE id = ?').bind(visbyId, partyId).run()
    await handlePartyManage(db(), { action: 'begin_march', partyId, toWaypointName: 'Fårösund' })

    // 54.22km at 24km/day: 3 days (72km) is enough to arrive.
    const results = await tickAllPartiesMarch(env.RPG_DB, WORLD, 3)
    expect(results).toEqual([{ partyId, status: 'arrived', remainingKm: 0, arrivedAtWaypointId: farosundId }])
  })
})
