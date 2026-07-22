// Live smoke coverage for #430 — world_map.distance and world_map.pathfind.
// Reuses #429/#431's per-hex effective cost model rather than separate math.
import { describe, it, expect, afterEach } from 'vitest'
import { MCP_API_KEY, tool, uid } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any) {
  if (res.error) return { error: true, message: res.error.message }
  return JSON.parse(res.result.content[0].text)
}

describe.skipIf(!MCP_API_KEY)('rpg world_map distance/pathfind (#430)', () => {
  const createdWorldIds: string[] = []

  afterEach(async () => {
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
        name: `DistancePathfindWorld ${uid()}`,
        theme: 'fantasy',
      }),
    )
    createdWorldIds.push(world.worldId)
    return world.worldId as string
  }

  it('distance reports hexDistance and null km on a non-geo-calibrated world', async () => {
    const worldId = await createWorld()
    const res = parseResult(
      await tool('rpg', {
        sub: 'world_map',
        action: 'distance',
        worldId,
        from: { q: 0, r: 0 },
        to: { q: 3, r: 0 },
      }),
    )
    expect(res.success).toBe(true)
    expect(res.hexDistance).toBe(3)
    expect(res.straightLineKm).toBeNull()
    expect(res.note).toContain('not geo-calibrated')
  })

  it('distance computes straightLineKm once geo-calibrated', async () => {
    const worldId = await createWorld()
    await tool('rpg', {
      sub: 'waypoint',
      action: 'calibrate',
      worldId,
      originLat: 57.6,
      originLon: 18.3,
      kmPerHex: 1,
    })
    const res = parseResult(
      await tool('rpg', {
        sub: 'world_map',
        action: 'distance',
        worldId,
        from: { q: 0, r: 0 },
        to: { q: 3, r: 0 },
      }),
    )
    expect(res.success).toBe(true)
    expect(res.straightLineKm).toBe(5.2)
  })

  it('pathfind routes around an impassable hex and reports the path', async () => {
    const worldId = await createWorld()
    const biomeName = `wall_live_${uid()}`
    await tool('rpg', {
      sub: 'biome',
      action: 'register',
      worldId,
      name: biomeName,
      movementCost: 1.0,
      modeCosts: { foot: 0 },
    })
    await tool('rpg', {
      sub: 'world_map',
      action: 'patch',
      worldId,
      hexes: [{ q: 1, r: 0, biome: biomeName }],
    })

    const res = parseResult(
      await tool('rpg', {
        sub: 'world_map',
        action: 'pathfind',
        worldId,
        from: { q: 0, r: 0 },
        to: { q: 2, r: 0 },
        mode: 'foot',
      }),
    )
    expect(res.routable).toBe(true)
    expect(res.path.some((p: { q: number; r: number }) => p.q === 1 && p.r === 0)).toBe(false)
  })

  it('pathfind avoids a requested zone_type', async () => {
    const worldId = await createWorld()
    await tool('rpg', {
      sub: 'world_map',
      action: 'suggest_poi',
      worldId,
      query: `Territory ${uid()}`,
      q: 1,
      r: 0,
      radius: 0,
      zoneType: 'predator_zone',
    })

    const res = parseResult(
      await tool('rpg', {
        sub: 'world_map',
        action: 'pathfind',
        worldId,
        from: { q: 0, r: 0 },
        to: { q: 2, r: 0 },
        avoid: ['predator_zone'],
      }),
    )
    expect(res.routable).toBe(true)
    expect(res.path.some((p: { q: number; r: number }) => p.q === 1 && p.r === 0)).toBe(false)
  })
})
