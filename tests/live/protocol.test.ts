import { describe, it, expect } from 'vitest'
import { MCP_API_KEY, rpc, tool, uid } from './helpers'

describe.skipIf(!MCP_API_KEY)('Core MCP Methods', () => {
  it('initialize', async () => {
    const res = await rpc('initialize')
    expect(res.error).toBeUndefined()
    expect(res.id).toBe(1)
  })

  it('ping', async () => {
    const res = await rpc('ping')
    expect(res.error).toBeUndefined()
  })

  it('tools/list', async () => {
    const res = await rpc('tools/list')
    expect(res.error).toBeUndefined()
    expect(res.result).toBeTruthy()
  })

  it('tools/list advertises world_id and entity_id on continuity_manage append_event (#267)', async () => {
    const res = await rpc('tools/list')
    const continuityManage = res.result.tools.find((t: { name: string }) => t.name === 'continuity_manage')
    const appendEventBranch = continuityManage.inputSchema.oneOf.find(
      (branch: { properties: { action: { const: string } } }) => branch.properties.action.const === 'append_event'
    )
    expect(appendEventBranch.properties.world_id).toBeDefined()
    expect(appendEventBranch.properties.entity_id).toBeDefined()
  })

  it('list_topics (direct method)', async () => {
    const res = await rpc('list_topics')
    expect(res.error).toBeUndefined()
  })

  it('get_lore (direct method)', async () => {
    const res = await rpc('get_lore', { key: 'character:sarah-weaver' })
    expect(res.error).toBeUndefined()
  })

  it('get_world_biomes (direct method, #321) requires worldId', async () => {
    const res = await rpc('get_world_biomes', {})
    expect(res.error).toBeDefined()
  })

  it('get_world_biomes (direct method, #321) returns an empty array for an unregistered worldId', async () => {
    const res = await rpc('get_world_biomes', { worldId: `nonexistent-${uid()}` })
    expect(res.error).toBeUndefined()
    expect(res.result.biomes).toEqual([])
    expect(res.result.count).toBe(0)
  })

  it('tools/list advertises tier on get_event_log and the taxonomy_* actions (#311)', async () => {
    const res = await rpc('tools/list')
    const continuityManage = res.result.tools.find((t: { name: string }) => t.name === 'continuity_manage')
    const branches = continuityManage.inputSchema.oneOf as Array<{ properties: { action: { const: string } } }>
    const getEventLogBranch = branches.find(b => b.properties.action.const === 'get_event_log')
    expect((getEventLogBranch!.properties as Record<string, unknown>).tier).toBeDefined()
    expect(branches.some(b => b.properties.action.const === 'taxonomy_list')).toBe(true)
    expect(branches.some(b => b.properties.action.const === 'taxonomy_set')).toBe(true)
    expect(branches.some(b => b.properties.action.const === 'taxonomy_delete')).toBe(true)
  })
})

describe.skipIf(!MCP_API_KEY)('Basic Tools', () => {
  it('ping_tool', async () => {
    const res = await tool('lore_manage', { action: 'ping' })
    expect(res.error).toBeUndefined()
  })

  it('list_topics', async () => {
    const res = await tool('lore_manage', { action: 'list' })
    expect(res.error).toBeUndefined()
  })

  it('list_topics with prefix filter', async () => {
    const res = await tool('lore_manage', { action: 'list', prefix: 'character' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.prefix).toBe('character')
  })

  it('list_maps', async () => {
    const res = await tool('lore_manage', { action: 'list_maps' })
    expect(res.error).toBeUndefined()
  })

  it('get_lore', async () => {
    const res = await tool('lore_manage', { action: 'get', query: 'character:sarah-weaver' })
    expect(res.error).toBeUndefined()
  })

  it('get_lore_batch', async () => {
    const res = await tool('lore_manage', {
      action: 'get_batch',
      keys: [
        'character:sarah-weaver',
        'location:fernveil:outpost:deep-forest-cafe',
        'system:active-narratives',
      ],
    })
    expect(res.error).toBeUndefined()
  })

  it('taxonomy_list (#311) — read-only smoke check against the seeded event_verb_taxonomy', async () => {
    const res = await tool('continuity_manage', { action: 'taxonomy_list', tier: 'high' })
    expect(res.error).toBeUndefined()
    expect(res.result.verbs.every((v: { tier: string }) => v.tier === 'high')).toBe(true)
  })
})
