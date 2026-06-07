import { expect, it } from 'vitest'
import { describe, callTool, seedKV } from '../utils'

// ── list_topics ───────────────────────────────────────────────────────────────

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

// ── list_maps ──────────────────────────────────────────────────────────────────

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

// ── get_lore ──────────────────────────────────────────────────────────────────

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

// ── get_lore_batch ────────────────────────────────────────────────────────────

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

// ── validate_topic_exists ─────────────────────────────────────────────────────

describe('validate_topic_exists', () => {
  it('exact match: exists=true', async () => {
    await seedKV('character:sarah-weaver', 'Sarah is a weaver')
    await seedKV('character:molly-prime', 'Molly lore')
    const res = await callTool('validate_topic_exists', { query_string: 'character:sarah-weaver' })
    expect(res.result.exists).toBe(true)
    expect(res.result.exact_match).toBe('character:sarah-weaver')
    expect(res.result.namespace_matches).toHaveLength(0)
  })

  it('partial match: exists=false with suggestions', async () => {
    await seedKV('character:sarah-weaver', 'Sarah is a weaver')
    await seedKV('character:molly-prime', 'Molly lore')
    const res = await callTool('validate_topic_exists', { query_string: 'molly' })
    expect(res.result.exists).toBe(false)
    expect(res.result.namespace_matches).toContain('character:molly-prime')
    expect(res.result.suggestion).toBe('character:molly-prime')
  })

  it('no match: exists=false with empty suggestions', async () => {
    await seedKV('character:sarah-weaver', 'Sarah is a weaver')
    await seedKV('character:molly-prime', 'Molly lore')
    const res = await callTool('validate_topic_exists', { query_string: 'nonexistent-thing-12345' })
    expect(res.result.exists).toBe(false)
    expect(res.result.namespace_matches).toHaveLength(0)
    expect(res.result.suggestion).toBeNull()
  })
})

// ── search_lore ───────────────────────────────────────────────────────────────

describe('search_lore', () => {
  it('finds matches across all KV entries', async () => {
    await seedKV('location:magic-cave', 'The magic cave is full of wonder and sparkle.')
    await seedKV('character:witch', 'The witch has mastered magic arts.')
    await seedKV('item:sword', 'A sharp blade, no magic involved.')
    const res = await callTool('search_lore', { query: 'magic', max_results: 10 })
    expect(res.result.metadata.match_count).toBe(3)
  })

  it('each result has key and excerpt containing the term', async () => {
    await seedKV('location:magic-cave', 'The magic cave is full of wonder and sparkle.')
    await seedKV('character:witch', 'The witch has mastered magic arts.')
    await seedKV('item:sword', 'A sharp blade, no magic involved.')
    const res = await callTool('search_lore', { query: 'magic', max_results: 10 })
    const results = res.result.results as Array<{ key: string; excerpt: string }>
    expect(results[0].key).toBeDefined()
    expect(results[0].excerpt.toLowerCase()).toContain('magic')
  })

  it('respects max_results', async () => {
    await seedKV('location:magic-cave', 'The magic cave is full of wonder and sparkle.')
    await seedKV('character:witch', 'The witch has mastered magic arts.')
    await seedKV('item:sword', 'A sharp blade, no magic involved.')
    const res = await callTool('search_lore', { query: 'magic', max_results: 2 })
    expect(res.result.results.length).toBeLessThanOrEqual(2)
  })

  it('returns empty results when nothing matches', async () => {
    await seedKV('location:magic-cave', 'The magic cave is full of wonder and sparkle.')
    await seedKV('character:witch', 'The witch has mastered magic arts.')
    await seedKV('item:sword', 'A sharp blade, no magic involved.')
    const res = await callTool('search_lore', { query: 'xyznonexistentterm99' })
    expect(res.result.metadata.match_count).toBe(0)
    expect(res.result.content[0].text).toContain('No lore entries matching')
  })
})
