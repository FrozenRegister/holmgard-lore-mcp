import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('list_topics', () => {
  it('lists keys present in KV', async () => {
    await seedKV('lore:alpha', 'Alpha lore')
    await seedKV('lore:beta', 'Beta lore')
    const res = await callTool('list_topics')
    const text = res.result.content[0].text as string
    expect(text).toContain('lore:alpha')
    expect(text).toContain('lore:beta')
    expect(res.result.metadata.count).toBe(2)
  })

  it('excludes map:* keys from list_topics', async () => {
    await seedKV('lore:visible', 'Visible lore')
    await seedKV('map:world:continents', '{"type":"FeatureCollection"}')
    await seedKV('map:region:north', '{"type":"FeatureCollection"}')
    const res = await callTool('list_topics')
    const text = res.result.content[0].text as string
    expect(text).toContain('lore:visible')
    expect(text).not.toContain('map:world:continents')
    expect(text).not.toContain('map:region:north')
    expect(res.result.metadata.count).toBe(1)
  })
})

describe('list_maps', () => {
  it('lists only map:* keys', async () => {
    await seedKV('map:world:continents', '{"type":"FeatureCollection"}')
    await seedKV('map:region:north', '{"type":"FeatureCollection"}')
    const res = await callTool('list_maps')
    const text = res.result.content[0].text as string
    expect(text).toContain('map:world:continents')
    expect(text).toContain('map:region:north')
    expect(res.result.metadata.count).toBe(2)
  })

  it('excludes non-map keys from list_maps', async () => {
    await seedKV('lore:visible', 'Visible lore')
    await seedKV('map:world:rivers', '{"type":"FeatureCollection"}')
    const res = await callTool('list_maps')
    const text = res.result.content[0].text as string
    expect(text).toContain('map:world:rivers')
    expect(text).not.toContain('lore:visible')
    expect(res.result.metadata.count).toBe(1)
  })

  it('returns empty list when no maps exist', async () => {
    await seedKV('lore:alpha', 'Alpha lore')
    const res = await callTool('list_maps')
    const text = res.result.content[0].text as string
    expect(text).toBe('')
    expect(res.result.metadata.count).toBe(0)
    expect(res.result.metadata.total).toBe(0)
  })

  it('supports pagination with limit and offset', async () => {
    await seedKV('map:a', '{}')
    await seedKV('map:b', '{}')
    await seedKV('map:c', '{}')
    const res = await callTool('list_maps', { limit: 2, offset: 1 })
    expect(res.result.metadata.count).toBe(2)
    expect(res.result.metadata.total).toBe(3)
    expect(res.result.metadata.limit).toBe(2)
    expect(res.result.metadata.offset).toBe(1)
  })
})

describe('get_lore', () => {
  it('retrieves an existing entry', async () => {
    await seedKV('character:bob', 'Bob is a warrior')
    const res = await callTool('get_lore', { query: 'character:bob' })
    expect(res.result.content[0].text).toBe('Bob is a warrior')
    expect(res.result.key).toBe('character:bob')
  })

  it('normalizes query to lowercase', async () => {
    await seedKV('character:carol', 'Carol lore')
    const res = await callTool('get_lore', { query: 'Character:Carol' })
    expect(res.result.content[0].text).toBe('Carol lore')
  })

  it('returns error code -32602 for missing key', async () => {
    const res = await callTool('get_lore', { query: 'nonexistent:key-9999' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.message).toContain('No lore found')
  })
})

describe('get_lore_batch', () => {
  it('retrieves multiple keys, marks missing ones null', async () => {
    await seedKV('batch:k1', 'Text 1')
    await seedKV('batch:k2', 'Text 2')
    const res = await callTool('get_lore_batch', { keys: ['batch:k1', 'batch:k2', 'batch:missing'] })
    expect(res.result.metadata.retrieved).toBe(2)
    expect(res.result.metadata.total).toBe(3)
    expect(res.result.results['batch:k1']).not.toBeNull()
    expect(res.result.results['batch:k2']).not.toBeNull()
    expect(res.result.results['batch:missing']).toBeNull()
  })
})

describe('get_lore_batch legacy bare method', () => {
  it('resolves keys when called as bare method', async () => {
    await seedKV('batch:x1', 'X1 text')
    await seedKV('batch:x2', 'X2 text')
    // eslint-disable-next-line deprecation/deprecation
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'get_lore_batch', params: { keys: ['batch:x1', 'batch:x2', 'batch:missing'] } }),
    }).then(r => r.json() as Promise<Record<string, any>>)
    expect(res.result.results['batch:x1']).not.toBeNull()
    expect(res.result.results['batch:x2']).not.toBeNull()
    expect(res.result.results['batch:missing']).toBeNull()
  })

  it('returns error when keys array is missing', async () => {
    // eslint-disable-next-line deprecation/deprecation
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'get_lore_batch', params: {} }),
    }).then(r => r.json() as Promise<Record<string, any>>)
    expect(res.error.code).toBe(-32602)
  })
})

describe('set_lore', () => {
  it('stores text and returns version 1', async () => {
    const res = await callTool('set_lore', { key: 'write:new-entry', text: 'Hello world' })
    expect(res.result.metadata.version).toBe(1)
    expect(res.result.metadata.key).toBe('write:new-entry')
    const get = await callTool('get_lore', { query: 'write:new-entry' })
    expect(get.result.content[0].text).toBe('Hello world')
  })

  it('increments version on subsequent writes', async () => {
    await callTool('set_lore', { key: 'write:versioned', text: 'v1' })
    const res = await callTool('set_lore', { key: 'write:versioned', text: 'v2' })
    expect(res.result.metadata.version).toBe(2)
  })
})

describe('delete_lore', () => {
  it('removes the entry so get_lore returns an error', async () => {
    await callTool('set_lore', { key: 'write:to-delete', text: 'Temporary' })
    await callTool('delete_lore', { key: 'write:to-delete' })
    const get = await callTool('get_lore', { query: 'write:to-delete' })
    expect(get.error).toBeDefined()
  })
})

describe('search_lore', () => {
  beforeEach(async () => {
    await seedKV('location:magic-cave', 'The magic cave is full of wonder and sparkle.')
    await seedKV('character:witch', 'The witch has mastered magic arts.')
    await seedKV('item:sword', 'A sharp blade, no magic involved.')
  })

  it('finds matches across all KV entries', async () => {
    const res = await callTool('search_lore', { query: 'magic', max_results: 10 })
    expect(res.result.metadata.match_count).toBe(3)
  })

  it('each result has key and excerpt containing the term', async () => {
    const res = await callTool('search_lore', { query: 'magic', max_results: 10 })
    const results = res.result.results as Array<{ key: string; excerpt: string }>
    expect(results[0].key).toBeDefined()
    expect(results[0].excerpt.toLowerCase()).toContain('magic')
  })

  it('respects max_results', async () => {
    const res = await callTool('search_lore', { query: 'magic', max_results: 2 })
    expect(res.result.results.length).toBeLessThanOrEqual(2)
  })

  it('returns empty results when nothing matches', async () => {
    const res = await callTool('search_lore', { query: 'xyznonexistentterm99' })
    expect(res.result.metadata.match_count).toBe(0)
    expect(res.result.content[0].text).toContain('No lore entries matching')
  })
})

describe('validate_topic_exists', () => {
  beforeEach(async () => {
    await seedKV('character:sarah-weaver', 'Sarah is a weaver')
    await seedKV('character:molly-prime', 'Molly lore')
  })

  it('exact match: exists=true', async () => {
    const res = await callTool('validate_topic_exists', { query_string: 'character:sarah-weaver' })
    expect(res.result.exists).toBe(true)
    expect(res.result.exact_match).toBe('character:sarah-weaver')
    expect(res.result.namespace_matches).toHaveLength(0)
  })

  it('partial match: exists=false with suggestions', async () => {
    const res = await callTool('validate_topic_exists', { query_string: 'molly' })
    expect(res.result.exists).toBe(false)
    expect(res.result.namespace_matches).toContain('character:molly-prime')
    expect(res.result.suggestion).toBe('character:molly-prime')
  })

  it('no match: exists=false with empty suggestions', async () => {
    const res = await callTool('validate_topic_exists', { query_string: 'nonexistent-thing-12345' })
    expect(res.result.exists).toBe(false)
    expect(res.result.namespace_matches).toHaveLength(0)
    expect(res.result.suggestion).toBeNull()
  })
})

describe('restore_lore', () => {
  it('returns no-history message when key has never been written', async () => {
    await seedKV('restore:fresh', 'initial text')
    const res = await callTool('restore_lore', { key: 'restore:fresh' })
    expect(res.result.metadata.restored).toBe(false)
    expect(res.result.content[0].text).toContain('No history')
  })

  it('restores to the previous value after one write', async () => {
    await seedKV('restore:target', 'original text')
    await callTool('set_lore', { key: 'restore:target', text: 'overwritten text' })
    const restore = await callTool('restore_lore', { key: 'restore:target' })
    expect(restore.result.metadata.restored).toBe(true)
    const get = await callTool('get_lore', { query: 'restore:target' })
    expect(get.result.text).toBe('original text')
  })

  it('pops the stack — each restore goes one step further back', async () => {
    await seedKV('restore:stack', 'v1')
    await callTool('set_lore', { key: 'restore:stack', text: 'v2' })
    await callTool('set_lore', { key: 'restore:stack', text: 'v3' })
    await callTool('restore_lore', { key: 'restore:stack' })
    const after1 = await callTool('get_lore', { query: 'restore:stack' })
    expect(after1.result.text).toBe('v2')
    await callTool('restore_lore', { key: 'restore:stack' })
    const after2 = await callTool('get_lore', { query: 'restore:stack' })
    expect(after2.result.text).toBe('v1')
  })

  it('reports remaining snapshots in metadata', async () => {
    await seedKV('restore:count', 'a')
    await callTool('set_lore', { key: 'restore:count', text: 'b' })
    await callTool('set_lore', { key: 'restore:count', text: 'c' })
    const res = await callTool('restore_lore', { key: 'restore:count' })
    expect(res.result.metadata.remaining_history).toBe(1)
  })

  it('caps history at 20 — oldest entry is dropped on the 21st write', async () => {
    await seedKV('restore:cap', 'v0')
    for (let i = 1; i <= 21; i++) {
      await callTool('set_lore', { key: 'restore:cap', text: `v${i}` })
    }
    // Restore 20 times — should reach v1 (v0 was evicted)
    for (let i = 0; i < 20; i++) {
      await callTool('restore_lore', { key: 'restore:cap' })
    }
    const get = await callTool('get_lore', { query: 'restore:cap' })
    expect(get.result.text).toBe('v1')
    // One more restore should report no history
    const last = await callTool('restore_lore', { key: 'restore:cap' })
    expect(last.result.metadata.restored).toBe(false)
  })

  it('history is invisible to list_topics', async () => {
    await seedKV('restore:hidden', 'text')
    await callTool('set_lore', { key: 'restore:hidden', text: 'updated' })
    const list = await callTool('list_topics')
    const text = list.result.content[0].text as string
    expect(text).not.toContain('_history:')
  })

  it('works after patch_lore writes', async () => {
    await seedKV('restore:patched', 'Status: Alive\nNotes: clean')
    await callTool('patch_lore', { key: 'restore:patched', operation: 'replace', target: 'Status: Alive', value: 'Status: Dead' })
    await callTool('restore_lore', { key: 'restore:patched' })
    const get = await callTool('get_lore', { query: 'restore:patched' })
    expect(get.result.text).toContain('Status: Alive')
  })

  it('works after increment_topic_field writes', async () => {
    await seedKV('restore:incremented', '**days_remaining:** 10')
    await callTool('increment_topic_field', { key: 'restore:incremented', field_path: 'days_remaining', increment: -3 })
    await callTool('restore_lore', { key: 'restore:incremented' })
    const get = await callTool('get_lore', { query: 'restore:incremented' })
    expect(get.result.text).toContain('**days_remaining:** 10')
  })
})

