import { describe, it, expect } from 'vitest'
import { MCP_API_KEY, rpc, tool } from './helpers'

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

  it('list_topics (direct method)', async () => {
    const res = await rpc('list_topics')
    expect(res.error).toBeUndefined()
  })

  it('get_lore (direct method)', async () => {
    const res = await rpc('get_lore', { key: 'character:sarah-weaver' })
    expect(res.error).toBeUndefined()
  })
})

describe.skipIf(!MCP_API_KEY)('Basic Tools', () => {
  it('ping_tool', async () => {
    const res = await tool('ping_tool')
    expect(res.error).toBeUndefined()
  })

  it('list_topics', async () => {
    const res = await tool('list_topics')
    expect(res.error).toBeUndefined()
  })

  it('list_maps', async () => {
    const res = await tool('list_maps')
    expect(res.error).toBeUndefined()
  })

  it('get_lore', async () => {
    const res = await tool('get_lore', { query: 'character:sarah-weaver' })
    expect(res.error).toBeUndefined()
  })

  it('get_lore_batch', async () => {
    const res = await tool('get_lore_batch', {
      keys: [
        'character:sarah-weaver',
        'location:fernveil:outpost:deep-forest-cafe',
        'system:active-narratives',
      ],
    })
    expect(res.error).toBeUndefined()
  })
})
