// Live smoke coverage for the #290 biome-registry integration in
// rpg{sub:"spatial"}. `spatial` had no live coverage before this change —
// scoped here to the new worldId/biome-registry validation surface only,
// not a full backfill of spatial_manage's pre-existing actions.
import { describe, it, expect, afterEach } from 'vitest'
import { MCP_API_KEY, tool, uid } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any) {
  if (res.error) return { error: true, message: res.error.message }
  return JSON.parse(res.result.content[0].text)
}

describe.skipIf(!MCP_API_KEY)('rpg spatial biome registry (#290)', () => {
  const createdRoomIds: string[] = []

  afterEach(async () => {
    // spatial has no delete action — nothing to clean up server-side;
    // rooms created here are harmless, freeform-named test fixtures.
    createdRoomIds.length = 0
  })

  it('generate accepts any biome string when no worldId is given (backward compatible)', async () => {
    const res = parseResult(await tool('rpg', {
      sub: 'spatial', action: 'generate', name: `Test Room ${uid()}`, description: 'A room used for a live smoke test.', biome: 'anything_goes',
    }))
    expect(res.success).toBe(true)
    expect(res.biome).toBe('anything_goes')
    createdRoomIds.push(res.roomId)
  })

  it('generate accepts a legacy biome name for a worldId with no registered biomes', async () => {
    const res = parseResult(await tool('rpg', {
      sub: 'spatial', action: 'generate', name: `Test Room ${uid()}`, description: 'A room used for a live smoke test.',
      biome: 'urban', worldId: `nonexistent-${uid()}`,
    }))
    expect(res.success).toBe(true)
    createdRoomIds.push(res.roomId)
  })

  it('look reports worldId on a room created with one', async () => {
    const worldId = `nonexistent-${uid()}`
    const gen = parseResult(await tool('rpg', {
      sub: 'spatial', action: 'generate', name: `Test Room ${uid()}`, description: 'A room used for a live smoke test.', worldId,
    }))
    const look = parseResult(await tool('rpg', { sub: 'spatial', action: 'look', roomId: gen.roomId }))
    expect(look.worldId).toBe(worldId)
  })
})
