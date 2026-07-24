// Live smoke coverage for rpg{sub:'creature'} — creature AI state registry
// (#445, #440 Phase 3). Scoped to this new surface only.
import { describe, it, expect } from 'vitest'
import { MCP_API_KEY, tool, uid } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any) {
  if (res.error) return { error: true, message: res.error.message }
  return JSON.parse(res.result.content[0].text)
}

describe.skipIf(!MCP_API_KEY)('rpg creature (#445)', () => {
  it('register → get → update → place → list → delete round-trip', async () => {
    const worldRes = parseResult(
      await tool('rpg', { sub: 'world', action: 'create', name: `Creature Test World ${uid()}` }),
    )
    expect(worldRes.success).toBe(true)
    const worldId = worldRes.worldId
    const creatureKey = `creature:live-${uid()}`

    const reg = parseResult(
      await tool('rpg', {
        sub: 'creature',
        action: 'register',
        worldId,
        creatureKey,
        predatorTaxonomy: 'shaper',
        currentHexQ: 1,
        currentHexR: 1,
        creativeDrive: 40,
      }),
    )
    expect(reg.success).toBe(true)
    expect(reg.predatorTaxonomy).toBe('shaper')
    const creatureId = reg.creatureId

    const got = parseResult(await tool('rpg', { sub: 'creature', action: 'get', id: creatureId }))
    expect(got.creature.creature_key).toBe(creatureKey)

    const upd = parseResult(
      await tool('rpg', { sub: 'creature', action: 'update', id: creatureId, hunger: 33 }),
    )
    expect(upd.success).toBe(true)

    const placed = parseResult(
      await tool('rpg', { sub: 'creature', action: 'place', id: creatureId, q: 5, r: 6 }),
    )
    expect(placed.success).toBe(true)
    expect(placed.q).toBe(5)

    const list = parseResult(await tool('rpg', { sub: 'creature', action: 'list', worldId }))
    expect(list.creatures.some((c: { id: string }) => c.id === creatureId)).toBe(true)

    const del = parseResult(
      await tool('rpg', { sub: 'creature', action: 'delete', id: creatureId }),
    )
    expect(del.success).toBe(true)
  })
})
