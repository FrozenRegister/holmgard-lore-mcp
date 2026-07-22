// Live smoke coverage for #429 — move_hex transport modes and per-biome
// per-mode passability. Deliberately uses freeform biome names (not a
// hardcoded matrix) to exercise the same per-world dynamic registry every
// world already uses.
import { describe, it, expect, afterEach } from 'vitest'
import { MCP_API_KEY, tool, uid } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any) {
  if (res.error) return { error: true, message: res.error.message }
  return JSON.parse(res.result.content[0].text)
}

describe.skipIf(!MCP_API_KEY)('rpg travel move_hex mode passability (#429)', () => {
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
        name: `TravelModeWorld ${uid()}`,
        theme: 'fantasy',
      }),
    )
    createdWorldIds.push(world.worldId)
    return world.worldId as string
  }

  async function createParty(worldId: string) {
    const party = parseResult(
      await tool('rpg', {
        sub: 'party',
        action: 'create',
        name: `Travel Mode Party ${uid()}`,
        worldId,
      }),
    )
    createdPartyIds.push(party.partyId)
    return party.partyId as string
  }

  it('move_hex defaults to foot and reports effective speed at the biome baseline', async () => {
    const worldId = await createWorld()
    const partyId = await createParty(worldId)
    const biomeName = `grass_live_${uid()}`
    await tool('rpg', {
      sub: 'biome',
      action: 'register',
      worldId,
      name: biomeName,
      movementCost: 1.0,
    })
    await tool('rpg', {
      sub: 'world_map',
      action: 'patch',
      worldId,
      hexes: [{ q: 11, r: 11, biome: biomeName }],
    })

    const res = parseResult(
      await tool('rpg', { sub: 'travel', action: 'move_hex', partyId, worldId, toQ: 11, toR: 11 }),
    )
    expect(res.success).toBe(true)
    expect(res.mode).toBe('foot')
    expect(res.effectiveSpeedKmPerDay).toBe(5)
  })

  it('a mode-specific 0-cost override blocks that mode and does not move the party', async () => {
    const worldId = await createWorld()
    const partyId = await createParty(worldId)
    const biomeName = `river_live_${uid()}`
    await tool('rpg', {
      sub: 'biome',
      action: 'register',
      worldId,
      name: biomeName,
      movementCost: 2.0,
      modeCosts: { carriage: 0, car: 0 },
    })
    await tool('rpg', {
      sub: 'world_map',
      action: 'patch',
      worldId,
      hexes: [{ q: 12, r: 12, biome: biomeName }],
    })

    const blocked = parseResult(
      await tool('rpg', {
        sub: 'travel',
        action: 'move_hex',
        partyId,
        worldId,
        toQ: 12,
        toR: 12,
        mode: 'car',
      }),
    )
    expect(blocked.error).toBe(true)
    expect(blocked.message).toContain('impassable')

    const allowed = parseResult(
      await tool('rpg', {
        sub: 'travel',
        action: 'move_hex',
        partyId,
        worldId,
        toQ: 12,
        toR: 12,
        mode: 'foot',
      }),
    )
    expect(allowed.success).toBe(true)
    expect(allowed.effectiveSpeedKmPerDay).toBe(5 / 2.0)
  })
})
