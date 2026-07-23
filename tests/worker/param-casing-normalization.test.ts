// #511 — normalizeParamCasing() bridges snake_case <-> camelCase for every
// tools/call argument at the transport boundary, before any tool's Zod
// schema runs. These are end-to-end regression tests through the actual
// /mcp JSON-RPC endpoint proving previously-broken RPG subs (which had no
// per-handler `world_id` bridge) and previously-broken non-RPG tools (which
// only ever accepted snake_case) now accept either casing.
import { describe } from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'

describe('global param casing normalization (#511)', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    })
    const json = (await res.json()) as Record<string, any>
    const text = json.result?.content?.[0]?.text
    if (!text) return json
    try {
      return JSON.parse(text)
    } catch {
      return { raw: text }
    }
  }

  it('rpg{sub:biome, action:register}: accepts snake_case world_id (no per-handler bridge existed for biome)', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'Casing World' })

    const res = await callTool('rpg', {
      sub: 'biome',
      action: 'register',
      world_id: world.worldId,
      name: 'lava_flow',
      category: 'hazard',
    })

    expect(res.error).toBeUndefined()
    expect(res.success).toBe(true)
    expect(res.worldId).toBe(world.worldId)
  })

  it('rpg{sub:biome, action:register}: still works with the native camelCase worldId', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'Casing World 2' })

    const res = await callTool('rpg', {
      sub: 'biome',
      action: 'register',
      worldId: world.worldId,
      name: 'lava_flow',
      category: 'hazard',
    })

    expect(res.error).toBeUndefined()
    expect(res.success).toBe(true)
  })

  it('entity_manage.get_attributes: accepts camelCase entityKey as an alias for entity_key (non-RPG tool, opposite direction)', async () => {
    await callTool('lore_manage', {
      action: 'set',
      key: 'character:casing-test-npc',
      text: 'A test NPC for casing normalization.',
    })

    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'entity_manage',
          arguments: { action: 'get_attributes', entityKey: 'character:casing-test-npc' },
        },
      }),
    })
    const json = (await res.json()) as { result?: Record<string, any>; error?: unknown }

    expect(json.error).toBeUndefined()
    expect(json.result?.entity_key).toBe('character:casing-test-npc')
  })

  it('does not override an explicit worldId when a conflicting world_id is also given', async () => {
    const worldA = await callTool('rpg', { sub: 'world', action: 'create', name: 'World A' })
    const worldB = await callTool('rpg', { sub: 'world', action: 'create', name: 'World B' })

    const res = await callTool('rpg', {
      sub: 'biome',
      action: 'register',
      worldId: worldA.worldId,
      world_id: worldB.worldId,
      name: 'lava_flow',
      category: 'hazard',
    })

    // Both keys were explicitly provided by the caller, so normalization
    // must not touch either — the handler reads worldId, which stays World A.
    expect(res.error).toBeUndefined()
    expect(res.worldId).toBe(worldA.worldId)
  })
})
