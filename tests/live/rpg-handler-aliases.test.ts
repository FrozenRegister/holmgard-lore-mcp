// Live smoke coverage for #404 — cross-sub action aliases. Scoped to the
// new Tier 1 (sub-level) and Tier 2 (action-level) alias behavior only, not
// a full backfill of every sub these aliases point at.
import { describe, it, expect } from 'vitest'
import { MCP_API_KEY, tool, uid } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any) {
  if (res.error) return { error: true, message: res.error.message }
  return JSON.parse(res.result.content[0].text)
}

describe.skipIf(!MCP_API_KEY)('rpg cross-sub action aliases (#404)', () => {
  it('characters (Tier 1 sub alias) creates and reads back via character', async () => {
    const created = parseResult(
      await tool('rpg', { sub: 'characters', action: 'create', name: `Alias Live ${uid()}` }),
    )
    expect(created.success).toBe(true)

    const got = parseResult(
      await tool('rpg', { sub: 'character', action: 'get', characterId: created.characterId }),
    )
    expect(got.character.id).toBe(created.characterId)

    await tool('rpg', { sub: 'character', action: 'delete', characterId: created.characterId })
  })

  it('character.place_character (Tier 2 action alias) routes to spawn.place_character', async () => {
    const worldRes = parseResult(
      await tool('rpg', { sub: 'world', action: 'create', name: `Alias Live World ${uid()}` }),
    )
    const worldId = worldRes.worldId
    const charRes = parseResult(
      await tool('rpg', {
        sub: 'character',
        action: 'create',
        name: `Placeable Live ${uid()}`,
        worldId,
      }),
    )
    const characterId = charRes.characterId

    const placeRes = parseResult(
      await tool('rpg', { sub: 'character', action: 'place_character', characterId, q: 7, r: -3 }),
    )
    expect(placeRes.success).toBe(true)
    expect(placeRes.actionType).toBe('place_character')

    const got = parseResult(await tool('rpg', { sub: 'character', action: 'get', characterId }))
    expect(got.character.current_hex_q).toBe(7)
    expect(got.character.current_hex_r).toBe(-3)

    await tool('rpg', { sub: 'character', action: 'delete', characterId })
  })
})
