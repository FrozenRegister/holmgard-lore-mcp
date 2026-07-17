// Live smoke coverage for #431 — explicit per-hex water_depth fording,
// layered alongside #429's per-mode biome cost overrides (not a
// replacement). water_depth takes precedence over biome cost when set.
import { describe, it, expect, afterEach } from 'vitest'
import { MCP_API_KEY, tool, uid } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any) {
  if (res.error) return { error: true, message: res.error.message }
  return JSON.parse(res.result.content[0].text)
}

describe.skipIf(!MCP_API_KEY)('rpg world_map/travel water_depth fording (#431)', () => {
  const createdWorldIds: string[] = []
  const createdPartyIds: string[] = []

  afterEach(async () => {
    await Promise.all(createdPartyIds.splice(0).map(partyId => tool('rpg', { sub: 'party', action: 'delete', id: partyId })))
    await Promise.all(createdWorldIds.splice(0).map(worldId => tool('rpg', { sub: 'world', action: 'delete', worldId })))
  })

  async function createWorld() {
    const world = parseResult(await tool('rpg', { sub: 'world', action: 'create', name: `WaterDepthWorld ${uid()}`, theme: 'fantasy' }))
    createdWorldIds.push(world.worldId)
    return world.worldId as string
  }

  async function createParty(worldId: string) {
    const party = parseResult(await tool('rpg', { sub: 'party', action: 'create', name: `Water Depth Party ${uid()}`, worldId }))
    createdPartyIds.push(party.partyId)
    return party.partyId as string
  }

  it('an explicit water_depth overrides a permissive biome and blocks carriage, while foot fords with swimRisk', async () => {
    const worldId = await createWorld()
    const partyId = await createParty(worldId)
    await tool('rpg', { sub: 'world_map', action: 'patch', worldId, hexes: [{ q: 14, r: 14, biome: 'grass', waterDepth: 0.9 }] })

    const blocked = parseResult(await tool('rpg', { sub: 'travel', action: 'move_hex', partyId, worldId, toQ: 14, toR: 14, mode: 'carriage' }))
    expect(blocked.error).toBe(true)
    expect(blocked.message).toContain('water too deep to ford')

    const forded = parseResult(await tool('rpg', { sub: 'travel', action: 'move_hex', partyId, worldId, toQ: 14, toR: 14, mode: 'foot' }))
    expect(forded.success).toBe(true)
    expect(forded.swimRisk).toBe(true)
    expect(forded.effectiveSpeedKmPerDay).toBe(5 / 2.0)
  })

  it('aircraft ignores water_depth entirely', async () => {
    const worldId = await createWorld()
    const partyId = await createParty(worldId)
    await tool('rpg', { sub: 'world_map', action: 'patch', worldId, hexes: [{ q: 15, r: 15, biome: 'grass', waterDepth: 3.0 }] })

    const res = parseResult(await tool('rpg', { sub: 'travel', action: 'move_hex', partyId, worldId, toQ: 15, toR: 15, mode: 'aircraft' }))
    expect(res.success).toBe(true)
    expect(res.effectiveSpeedKmPerDay).toBe(600)
    expect(res.swimRisk).toBeUndefined()
  })
})
