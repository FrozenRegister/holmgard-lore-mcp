// Live smoke coverage for rpg{sub:"world_map"} and rpg{sub:"zone_type"} (#320).
// world_map had zero live coverage before this change — scoped here to the
// hex-axial rewrite (q/r coordinates, hexes/landmarks tables) and the new
// D1-backed zone-type registry, not a full backfill of every action.
import { describe, it, expect, afterEach } from 'vitest'
import { MCP_API_KEY, tool, uid } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any) {
  if (res.error) return { error: true, message: res.error.message }
  return JSON.parse(res.result.content[0].text)
}

describe.skipIf(!MCP_API_KEY)('rpg world_map / zone_type (#320)', () => {
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
        name: `LiveMapWorld ${uid()}`,
        theme: 'fantasy',
      }),
    )
    createdWorldIds.push(world.worldId)
    return world.worldId as string
  }

  it('world create auto-seeds the zone-type registry', async () => {
    const worldId = await createWorld()
    const zoneTypes = parseResult(await tool('rpg', { sub: 'zone_type', action: 'list', worldId }))
    expect(zoneTypes.success).toBe(true)
    expect(zoneTypes.zoneTypes.some((z: any) => z.name === 'perimeter')).toBe(true)
  })

  it('patch upserts a hex by q/r and preview renders its registered biome glyph', async () => {
    const worldId = await createWorld()
    const patch = parseResult(
      await tool('rpg', {
        sub: 'world_map',
        action: 'patch',
        worldId,
        hexes: [{ q: 0, r: 0, biome: 'forest' }],
      }),
    )
    expect(patch.success).toBe(true)
    expect(patch.hexesUpdated).toBe(1)

    const preview = parseResult(
      await tool('rpg', {
        sub: 'world_map',
        action: 'preview',
        worldId,
        q: 0,
        r: 0,
        width: 1,
        height: 1,
      }),
    )
    expect(preview.success).toBe(true)
    expect(preview.ascii).toBe('T')
  })

  it('suggest_poi creates a zone and preview overlays its registered zone-type glyph', async () => {
    const worldId = await createWorld()
    await tool('rpg', {
      sub: 'world_map',
      action: 'patch',
      worldId,
      hexes: [{ q: 5, r: 5, biome: 'grass' }],
    })
    const poi = parseResult(
      await tool('rpg', {
        sub: 'world_map',
        action: 'suggest_poi',
        worldId,
        query: `Live Territory ${uid()}`,
        q: 5,
        r: 5,
        radius: 2,
        zoneType: 'territory',
      }),
    )
    expect(poi.success).toBe(true)
    expect(poi.hasZone).toBe(true)

    const preview = parseResult(
      await tool('rpg', {
        sub: 'world_map',
        action: 'preview',
        worldId,
        q: 5,
        r: 5,
        width: 1,
        height: 1,
      }),
    )
    expect(preview.ascii).toBe('@')

    const zoneQuery = parseResult(
      await tool('rpg', { sub: 'world_map', action: 'query_zone', worldId, q: 5, r: 5 }),
    )
    expect(zoneQuery.zones).toHaveLength(1)
    expect(zoneQuery.zones[0].zoneType).toBe('territory')
  })

  it('render_svg returns a well-formed SVG for a hex map', async () => {
    const worldId = await createWorld()
    await tool('rpg', {
      sub: 'world_map',
      action: 'patch',
      worldId,
      hexes: [{ q: 0, r: 0, biome: 'water' }],
    })
    const svgResult = parseResult(
      await tool('rpg', {
        sub: 'world_map',
        action: 'render_svg',
        worldId,
        renderWidth: 5,
        renderHeight: 5,
      }),
    )
    expect(svgResult.success).toBe(true)
    expect(svgResult.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
    expect(svgResult.hexCount).toBe(1)
  })

  it('zone_type register/get/delete round-trip', async () => {
    const worldId = await createWorld()
    const registered = parseResult(
      await tool('rpg', {
        sub: 'zone_type',
        action: 'register',
        worldId,
        name: `live_zone_${uid()}`,
        glyph: 'L',
      }),
    )
    expect(registered.success).toBe(true)

    const fetched = parseResult(
      await tool('rpg', { sub: 'zone_type', action: 'get', id: registered.zoneTypeId }),
    )
    expect(fetched.zoneType.glyph).toBe('L')

    const deleted = parseResult(
      await tool('rpg', { sub: 'zone_type', action: 'delete', id: registered.zoneTypeId }),
    )
    expect(deleted.success).toBe(true)
  })
})
