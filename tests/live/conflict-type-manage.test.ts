// Live smoke coverage for rpg{sub:'conflict_type'} and scene's set_conflict_type/
// get_conflict_type actions (#316). Scoped to this new surface only.
import { describe, it, expect } from 'vitest'
import { MCP_API_KEY, tool, uid } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any) {
  if (res.error) return { error: true, message: res.error.message }
  return JSON.parse(res.result.content[0].text)
}

describe.skipIf(!MCP_API_KEY)('rpg conflict_type (#316)', () => {
  it('list includes the seeded physical/social/hybrid types', async () => {
    const res = parseResult(await tool('rpg', { sub: 'conflict_type', action: 'list' }))
    expect(res.success).toBe(true)
    const ids = res.conflictTypes.map((c: { id: string }) => c.id)
    expect(ids).toEqual(expect.arrayContaining(['physical', 'social', 'hybrid']))
  })

  it('create, update, and delete a custom conflict type round-trip', async () => {
    const name = `LiveTest ${uid()}`
    const createRes = parseResult(
      await tool('rpg', { sub: 'conflict_type', action: 'create', name, resolver: 'combat' }),
    )
    expect(createRes.success).toBe(true)

    const updateRes = parseResult(
      await tool('rpg', {
        sub: 'conflict_type',
        action: 'update',
        id: createRes.conflictTypeId,
        resolver: 'both',
      }),
    )
    expect(updateRes.success).toBe(true)

    const deleteRes = parseResult(
      await tool('rpg', { sub: 'conflict_type', action: 'delete', id: createRes.conflictTypeId }),
    )
    expect(deleteRes.success).toBe(true)
  })

  it('scene set_conflict_type / get_conflict_type round-trip', async () => {
    const worldRes = parseResult(
      await tool('rpg', {
        sub: 'world',
        action: 'create',
        name: `Conflict Type Test World ${uid()}`,
      }),
    )
    expect(worldRes.success).toBe(true)
    const worldId = worldRes.worldId

    const sceneRes = parseResult(
      await tool('rpg', {
        sub: 'scene',
        action: 'create',
        worldId,
        title: `Live Scene ${uid()}`,
        narration: 'Testing conflict-type routing.',
      }),
    )
    expect(sceneRes.success).toBe(true)
    const sceneId = sceneRes.sceneId

    const setRes = parseResult(
      await tool('rpg', {
        sub: 'scene',
        action: 'set_conflict_type',
        id: sceneId,
        conflictTypeId: 'social',
      }),
    )
    expect(setRes.success).toBe(true)
    expect(setRes.conflictTypeId).toBe('social')

    const getRes = parseResult(
      await tool('rpg', { sub: 'scene', action: 'get_conflict_type', id: sceneId }),
    )
    expect(getRes.conflictTypeId).toBe('social')
    expect(getRes.conflictType.resolver).toBe('drama')

    await tool('rpg', { sub: 'scene', action: 'delete', id: sceneId })
  })
})
