// Live smoke coverage for #425 — the `fields` passthrough on character.update
// against the deployed worker.
import { describe, it, expect } from 'vitest'
import { MCP_API_KEY, tool, uid } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any) {
  if (res.error) return { error: true, message: res.error.message }
  return JSON.parse(res.result.content[0].text)
}

describe.skipIf(!MCP_API_KEY)('dynamic fields passthrough (#425)', () => {
  it('character.update applies an arbitrary column via fields', async () => {
    const created = parseResult(await tool('rpg', { sub: 'character', action: 'create', name: `Fields Live Test ${uid()}` }))
    expect(created.success).toBe(true)

    const updated = parseResult(await tool('rpg', {
      sub: 'character', action: 'update', characterId: created.characterId, fields: { alias: 'Live Ghost' },
    }))
    expect(updated.success).toBe(true)
    expect(updated.fields_applied).toEqual(['alias'])

    const got = parseResult(await tool('rpg', { sub: 'character', action: 'get', characterId: created.characterId }))
    expect(got.character.alias).toBe('Live Ghost')

    await tool('rpg', { sub: 'character', action: 'delete', characterId: created.characterId })
  })

  it('rejects a blacklisted column without applying it', async () => {
    const created = parseResult(await tool('rpg', { sub: 'character', action: 'create', name: `Blacklist Live Test ${uid()}` }))
    const updated = parseResult(await tool('rpg', {
      sub: 'character', action: 'update', characterId: created.characterId, fields: { world_id: 'sneaky' },
    }))
    expect(updated.success).toBe(true)
    expect(updated.fields_rejected).toEqual([{ field: 'world_id', reason: 'blacklisted' }])

    await tool('rpg', { sub: 'character', action: 'delete', characterId: created.characterId })
  })
})
