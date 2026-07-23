// Live smoke coverage for #420 — advance_stage's terminal-stage hook: writes a
// **Terminal-Status:** KV field and, when the entity resolves to a world-scoped
// D1 character, logs a discoverable timeline_events row (verb: 'dissolved').
// Deliberately does not touch D1 hp/conditions — that stays a separate,
// explicit character_manage.kill call (matches morale_roll's report-don't-
// auto-apply precedent).
import { describe, it, expect } from 'vitest'
import { MCP_API_KEY, tool, setLore, deleteLore, uid } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any) {
  if (res.error) return { error: true, message: res.error.message }
  return JSON.parse(res.result.content[0].text)
}

describe.skipIf(!MCP_API_KEY)('entity_manage advance_stage terminal-stage hook (#420)', () => {
  it('logs a timeline_events row and writes Terminal-Status for a world-linked staged character', async () => {
    const worldRes = parseResult(
      await tool('rpg', {
        sub: 'world',
        action: 'create',
        name: `Terminal Hook World ${uid()}`,
        theme: 'fantasy',
      }),
    )
    expect(worldRes.success).toBe(true)
    const worldId = worldRes.worldId

    const name = `Terminal Hook Subject ${uid()}`
    const charRes = parseResult(await tool('character_manage', { action: 'create', name, worldId }))
    expect(charRes.success).toBe(true)
    const characterId = charRes.characterId
    await tool('character_manage', {
      action: 'update',
      characterId,
      deathMode: 'staged',
      dissolutionStage: 4,
      dissolutionStages: 5,
      dissolutionTerminal: 'consumed by the live-test mycelium',
    })

    const entityKey = `character:${name.toLowerCase().replace(/\s+/g, '-')}`
    await setLore(entityKey, '**State-Stage:** 4\n**State-Total:** 5\n**Stage-Timer:** 1')

    const advanceRes = await tool('entity_manage', {
      action: 'advance_stage',
      entity_key: entityKey,
    })
    expect(advanceRes.result.is_terminal).toBe(true)
    expect(typeof advanceRes.result.terminal_timeline_event_id).toBe('string')

    const lore = parseResult(await tool('lore_manage', { action: 'get', query: entityKey }))
    expect(lore.text).toContain('**Terminal-Status:** consumed by the live-test mycelium')

    await deleteLore(entityKey)
    await tool('character_manage', { action: 'delete', characterId })
  })

  it('marks a generic Terminal-Status fallback for a pure-KV entity with no D1 link', async () => {
    const entityKey = `character:terminal-hook-pure-kv-${uid()}`
    await setLore(entityKey, '**State-Stage:** 4\n**State-Total:** 5\n**Stage-Timer:** 1')

    const advanceRes = await tool('entity_manage', {
      action: 'advance_stage',
      entity_key: entityKey,
    })
    expect(advanceRes.result.is_terminal).toBe(true)
    expect(advanceRes.result.terminal_timeline_event_id).toBeNull()

    const lore = parseResult(await tool('lore_manage', { action: 'get', query: entityKey }))
    expect(lore.text).toContain('**Terminal-Status:** reached terminal stage')

    await deleteLore(entityKey)
  })
})
