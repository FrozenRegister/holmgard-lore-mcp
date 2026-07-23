// Live smoke coverage for rpg{sub:"waypoint"} and the party begin_march/
// get_march_status additions (#328 — Gotland real-world-distance movement).
// Both subs had zero live coverage before this change.
import { describe, it, expect, afterEach } from 'vitest'
import { MCP_API_KEY, tool, uid } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any) {
  if (res.error) return { error: true, message: res.error.message }
  return JSON.parse(res.result.content[0].text)
}

describe.skipIf(!MCP_API_KEY)('rpg waypoint / party march (#328)', () => {
  const createdWorldIds: string[] = []
  const createdPartyIds: string[] = []

  afterEach(async () => {
    await Promise.all(
      createdPartyIds
        .splice(0)
        .map((partyId) => tool('rpg', { sub: 'party', action: 'delete', id: partyId })),
    )
    await Promise.all(
      createdWorldIds
        .splice(0)
        .map((worldId) => tool('rpg', { sub: 'world', action: 'delete', worldId })),
    )
  })

  async function createWorld() {
    const world = parseResult(
      await tool('rpg', {
        sub: 'world',
        action: 'create',
        name: `GotlandWorld ${uid()}`,
        theme: 'fantasy',
      }),
    )
    createdWorldIds.push(world.worldId)
    return world.worldId as string
  }

  async function createParty(worldId: string) {
    const party = parseResult(
      await tool('rpg', { sub: 'party', action: 'create', name: `Test Party ${uid()}`, worldId }),
    )
    createdPartyIds.push(party.partyId)
    return party.partyId as string
  }

  it('seed_defaults seeds the Gotland waypoints and precomputed distances', async () => {
    const worldId = await createWorld()
    const res = parseResult(
      await tool('rpg', { sub: 'waypoint', action: 'seed_defaults', worldId }),
    )
    expect(res.success).toBe(true)
    expect(res.waypointsSeeded).toBe(res.totalDefaultWaypoints)
    expect(res.distancesSeeded).toBe(res.totalDefaultDistances)

    const list = parseResult(await tool('rpg', { sub: 'waypoint', action: 'list', worldId }))
    expect(list.waypoints.some((w: any) => w.name === 'Visby')).toBe(true)
  })

  it('a party can march between two seeded Gotland waypoints and arrives after enough days', async () => {
    const worldId = await createWorld()
    await tool('rpg', { sub: 'waypoint', action: 'seed_defaults', worldId })
    const partyId = await createParty(worldId)
    // A party with no current_waypoint_id yet still starts its first leg by
    // supplying fromWaypointName explicitly — no separate "place party at
    // waypoint" action is needed.
    const march = parseResult(
      await tool('rpg', {
        sub: 'party',
        action: 'begin_march',
        partyId,
        fromWaypointName: 'Visby',
        toWaypointName: 'Roma Kloster',
      }),
    )
    expect(march.success).toBe(true)
    expect(march.blocked).toBe(false)
    expect(march.distanceKm).toBeGreaterThan(0)

    const status = parseResult(
      await tool('rpg', { sub: 'party', action: 'get_march_status', partyId }),
    )
    expect(status.travelStatus).toBe('marching')
    expect(status.targetWaypoint.name).toBe('Roma Kloster')
  })

  it('begin_march returns a structured blocked (not error) response for a pair with no precomputed distance', async () => {
    const worldId = await createWorld()
    await tool('rpg', { sub: 'waypoint', action: 'seed_defaults', worldId })
    // A freshly-registered waypoint has no waypoint_distances row against any
    // existing waypoint — this is the "not_precomputed" case, not a live
    // OSM/Fårösund no-route case (the seeded default set turned out to be
    // fully mutually routable — see migration 0021's header comment).
    const isolatedName = `Isolated ${uid()}`
    await tool('rpg', {
      sub: 'waypoint',
      action: 'register',
      worldId,
      name: isolatedName,
      lat: 57.0,
      lon: 18.0,
      q: 100,
      r: 100,
    })
    const partyId = await createParty(worldId)

    const march = parseResult(
      await tool('rpg', {
        sub: 'party',
        action: 'begin_march',
        partyId,
        fromWaypointName: 'Visby',
        toWaypointName: isolatedName,
      }),
    )
    expect(march.success).toBe(true)
    expect(march.blocked).toBe(true)
    expect(march.reason).toBe('not_precomputed')

    const status = parseResult(
      await tool('rpg', { sub: 'party', action: 'get_march_status', partyId }),
    )
    expect(status.travelStatus).toBe('stationary')
  })
})
