import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'

describe('list_topics', () => {
  it('lists keys present in KV', async () => {
    await seedKV('lore:alpha', 'Alpha lore')
    await seedKV('lore:beta', 'Beta lore')
    const res = await callTool('lore_manage', { action: 'list' })
    const text = res.result.content[0].text as string
    expect(text).toContain('lore:alpha')
    expect(text).toContain('lore:beta')
    expect(res.result.metadata.count).toBe(2)
  })

  it('excludes map:* keys from list_topics', async () => {
    await seedKV('lore:visible', 'Visible lore')
    await seedKV('map:world:continents', '{"type":"FeatureCollection"}')
    await seedKV('map:region:north', '{"type":"FeatureCollection"}')
    const res = await callTool('lore_manage', { action: 'list' })
    const text = res.result.content[0].text as string
    expect(text).toContain('lore:visible')
    expect(text).not.toContain('map:world:continents')
    expect(text).not.toContain('map:region:north')
    expect(res.result.metadata.count).toBe(1)
  })

  it('filters by prefix using the maintained _idx:prefix index', async () => {
    await callTool('lore_manage', { action: 'set', key: 'location:marsh-end', text: 'A muddy tidal flat.' })
    await callTool('lore_manage', { action: 'set', key: 'character:eira-holt', text: '**Status:** Active' })
    const res = await callTool('lore_manage', { action: 'list', prefix: 'location' })
    const text = res.result.content[0].text as string
    expect(text).toContain('location:marsh-end')
    expect(text).not.toContain('character:eira-holt')
    expect(res.result.metadata.count).toBe(1)
    expect(res.result.metadata.prefix).toBe('location')
  })

  it('falls back to a full scan when no prefix index exists yet', async () => {
    await seedKV('faction:crows', 'The Crowmark faction.')
    await seedKV('faction:hollow-court', 'The Hollow Court.')
    await seedKV('item:rusty-key', 'An old rusty key.')
    const res = await callTool('lore_manage', { action: 'list', prefix: 'faction' })
    const text = res.result.content[0].text as string
    expect(text).toContain('faction:crows')
    expect(text).toContain('faction:hollow-court')
    expect(text).not.toContain('item:rusty-key')
    expect(res.result.metadata.count).toBe(2)
  })
})

describe('list_maps', () => {
  it('lists only map:* keys', async () => {
    await seedKV('map:world:continents', '{"type":"FeatureCollection"}')
    await seedKV('map:region:north', '{"type":"FeatureCollection"}')
    const res = await callTool('lore_manage', { action: 'list_maps' })
    const text = res.result.content[0].text as string
    expect(text).toContain('map:world:continents')
    expect(text).toContain('map:region:north')
    expect(res.result.metadata.count).toBe(2)
  })

  it('excludes non-map keys from list_maps', async () => {
    await seedKV('lore:visible', 'Visible lore')
    await seedKV('map:world:rivers', '{"type":"FeatureCollection"}')
    const res = await callTool('lore_manage', { action: 'list_maps' })
    const text = res.result.content[0].text as string
    expect(text).toContain('map:world:rivers')
    expect(text).not.toContain('lore:visible')
    expect(res.result.metadata.count).toBe(1)
  })

  it('returns empty list when no maps exist', async () => {
    await seedKV('lore:alpha', 'Alpha lore')
    const res = await callTool('lore_manage', { action: 'list_maps' })
    const text = res.result.content[0].text as string
    expect(text).toBe('')
    expect(res.result.metadata.count).toBe(0)
    expect(res.result.metadata.total).toBe(0)
  })

  it('supports pagination with limit and offset', async () => {
    await seedKV('map:a', '{}')
    await seedKV('map:b', '{}')
    await seedKV('map:c', '{}')
    const res = await callTool('lore_manage', { action: 'list_maps', limit: 2, offset: 1 })
    expect(res.result.metadata.count).toBe(2)
    expect(res.result.metadata.total).toBe(3)
    expect(res.result.metadata.limit).toBe(2)
    expect(res.result.metadata.offset).toBe(1)
  })
})

describe('get_lore', () => {
  it('retrieves an existing entry', async () => {
    await seedKV('character:bob', 'Bob is a warrior')
    const res = await callTool('lore_manage', { action: 'get', query: 'character:bob' })
    expect(res.result.content[0].text).toBe('Bob is a warrior')
    expect(res.result.key).toBe('character:bob')
  })

  it('normalizes query to lowercase', async () => {
    await seedKV('character:carol', 'Carol lore')
    const res = await callTool('lore_manage', { action: 'get', query: 'Character:Carol' })
    expect(res.result.content[0].text).toBe('Carol lore')
  })

  it('returns error code -32602 for missing key', async () => {
    const res = await callTool('lore_manage', { action: 'get', query: 'nonexistent:key-9999' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.message).toContain('No lore found')
  })
})

describe('get_lore D1 redirect', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const CHAR_KEY = 'character:redirect-test'
  const CHAR_LORE = [
    '# Character:Redirect Test Char',
    '**Status:** Active, Healthy',
    '**Race:** Human',
    '**Class:** Fighter',
  ].join('\n')

  it('transparently returns D1 data when entry has D1-Migrated marker', async () => {
    // Use admin migrate endpoint — creates D1 row + KV redirect marker in one step
    await seedKV(CHAR_KEY, CHAR_LORE)
    const migrateRes = await SELF.fetch('http://example.com/admin/migrate-character', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: CHAR_KEY, secret: ADMIN_SECRET }),
    })
    const migrateBody = await migrateRes.json() as Record<string, any>
    expect(migrateBody.ok).toBe(true)
    const d1Id = migrateBody.d1Id

    const res = await callTool('lore_manage', { action: 'get', query: CHAR_KEY })
    expect(res.error).toBeUndefined()
    const text = res.result.content[0].text as string
    expect(text).toContain('Redirect Test Char')
    expect(text).toContain('*Source: D1 database (auto-redirected from legacy KV entry)*')
    expect(res.result.meta?.d1_redirect).toBe(true)
    expect(res.result.meta?.d1_id).toBe(d1Id)
  })

  it('returns stale KV text when D1 row is missing (deleted)', async () => {
    // Seed KV with a redirect marker pointing to a nonexistent D1 row.
    // The handler try-catches D1 errors and falls through to the KV text.
    const staleText = [
      '## D1-Migrated: true',
      '## D1-Character-ID: nonexistent-uuid-999',
      '## Status: Legacy entry — see D1 for current data',
      '',
      '# Character:Stale Entry',
    ].join('\n')
    await seedKV('character:stale-test', staleText)

    const res = await callTool('lore_manage', { action: 'get', query: 'character:stale-test' })
    expect(res.error).toBeUndefined()
    const text = res.result.content[0].text as string
    expect(text).toContain('D1-Migrated: true')
    expect(text).toContain('Stale Entry')
    expect(text).not.toContain('*Source: D1 database*')
  })
})

describe('get_lore_batch', () => {
  it('retrieves multiple keys, marks missing ones null', async () => {
    await seedKV('batch:k1', 'Text 1')
    await seedKV('batch:k2', 'Text 2')
    const res = await callTool('lore_manage', { action: 'get_batch', keys: ['batch:k1', 'batch:k2', 'batch:missing'] })
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
    const res = await callTool('lore_manage', { action: 'set', key: 'write:new-entry', text: 'Hello world' })
    expect(res.result.metadata.version).toBe(1)
    expect(res.result.metadata.key).toBe('write:new-entry')
    const get = await callTool('lore_manage', { action: 'get', query: 'write:new-entry' })
    expect(get.result.content[0].text).toBe('Hello world')
  })

  it('increments version on subsequent writes', async () => {
    await callTool('lore_manage', { action: 'set', key: 'write:versioned', text: 'v1' })
    const res = await callTool('lore_manage', { action: 'set', key: 'write:versioned', text: 'v2' })
    expect(res.result.metadata.version).toBe(2)
  })
})

describe('delete_lore', () => {
  it('removes the entry so get_lore returns an error', async () => {
    await callTool('lore_manage', { action: 'set', key: 'write:to-delete', text: 'Temporary' })
    await callTool('lore_manage', { action: 'delete', key: 'write:to-delete' })
    const get = await callTool('lore_manage', { action: 'get', query: 'write:to-delete' })
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
    const res = await callTool('lore_manage', { action: 'search', query: 'magic', max_results: 10 })
    expect(res.result.metadata.match_count).toBe(3)
  })

  it('each result has key and excerpt containing the term', async () => {
    const res = await callTool('lore_manage', { action: 'search', query: 'magic', max_results: 10 })
    const results = res.result.results as Array<{ key: string; excerpt: string }>
    expect(results[0].key).toBeDefined()
    expect(results[0].excerpt.toLowerCase()).toContain('magic')
  })

  it('respects max_results', async () => {
    const res = await callTool('lore_manage', { action: 'search', query: 'magic', max_results: 2 })
    expect(res.result.results.length).toBeLessThanOrEqual(2)
  })

  it('returns empty results when nothing matches', async () => {
    const res = await callTool('lore_manage', { action: 'search', query: 'xyznonexistentterm99' })
    expect(res.result.metadata.match_count).toBe(0)
    expect(res.result.content[0].text).toContain('No lore entries matching')
  })

  it('scan_limit caps the number of keys scanned', async () => {
    const res = await callTool('lore_manage', { action: 'search', query: 'magic', scan_limit: 1 })
    expect(res.result.metadata.keys_scanned).toBe(1)
    expect(res.result.metadata.scan_limit).toBe(1)
    expect(res.result.results.length).toBeLessThanOrEqual(1)
  })

  it('metadata includes keys_scanned and scan_limit', async () => {
    const res = await callTool('lore_manage', { action: 'search', query: 'magic', max_results: 10, scan_limit: 500 })
    expect(res.result.metadata.keys_scanned).toBeDefined()
    expect(res.result.metadata.scan_limit).toBe(500)
  })

  it('rejects scan_limit above maximum (2001)', async () => {
    const res = await callTool('lore_manage', { action: 'search', query: 'magic', scan_limit: 2001 })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('rejects scan_limit below minimum (0)', async () => {
    const res = await callTool('lore_manage', { action: 'search', query: 'magic', scan_limit: 0 })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

describe('validate_topic_exists', () => {
  beforeEach(async () => {
    await seedKV('character:sarah-weaver', 'Sarah is a weaver')
    await seedKV('character:molly-prime', 'Molly lore')
  })

  it('exact match: exists=true', async () => {
    const res = await callTool('lore_manage', { action: 'validate', query_string: 'character:sarah-weaver' })
    expect(res.result.exists).toBe(true)
    expect(res.result.exact_match).toBe('character:sarah-weaver')
    expect(res.result.namespace_matches).toHaveLength(0)
  })

  it('partial match: exists=false with suggestions', async () => {
    const res = await callTool('lore_manage', { action: 'validate', query_string: 'molly' })
    expect(res.result.exists).toBe(false)
    expect(res.result.namespace_matches).toContain('character:molly-prime')
    expect(res.result.suggestion).toBe('character:molly-prime')
  })

  it('no match: exists=false with empty suggestions', async () => {
    const res = await callTool('lore_manage', { action: 'validate', query_string: 'nonexistent-thing-12345' })
    expect(res.result.exists).toBe(false)
    expect(res.result.namespace_matches).toHaveLength(0)
    expect(res.result.suggestion).toBeNull()
  })
})

describe('restore_lore', () => {
  it('returns no-history message when key has never been written', async () => {
    await seedKV('restore:fresh', 'initial text')
    const res = await callTool('lore_manage', { action: 'restore', key: 'restore:fresh' })
    expect(res.result.metadata.restored).toBe(false)
    expect(res.result.content[0].text).toContain('No history')
  })

  it('restores to the previous value after one write', async () => {
    await seedKV('restore:target', 'original text')
    await callTool('lore_manage', { action: 'set', key: 'restore:target', text: 'overwritten text' })
    const restore = await callTool('lore_manage', { action: 'restore', key: 'restore:target' })
    expect(restore.result.metadata.restored).toBe(true)
    const get = await callTool('lore_manage', { action: 'get', query: 'restore:target' })
    expect(get.result.text).toBe('original text')
  })

  it('pops the stack — each restore goes one step further back', async () => {
    await seedKV('restore:stack', 'v1')
    await callTool('lore_manage', { action: 'set', key: 'restore:stack', text: 'v2' })
    await callTool('lore_manage', { action: 'set', key: 'restore:stack', text: 'v3' })
    await callTool('lore_manage', { action: 'restore', key: 'restore:stack' })
    const after1 = await callTool('lore_manage', { action: 'get', query: 'restore:stack' })
    expect(after1.result.text).toBe('v2')
    await callTool('lore_manage', { action: 'restore', key: 'restore:stack' })
    const after2 = await callTool('lore_manage', { action: 'get', query: 'restore:stack' })
    expect(after2.result.text).toBe('v1')
  })

  it('reports remaining snapshots in metadata', async () => {
    await seedKV('restore:count', 'a')
    await callTool('lore_manage', { action: 'set', key: 'restore:count', text: 'b' })
    await callTool('lore_manage', { action: 'set', key: 'restore:count', text: 'c' })
    const res = await callTool('lore_manage', { action: 'restore', key: 'restore:count' })
    expect(res.result.metadata.remaining_history).toBe(1)
  })

  it('caps history at 20 — oldest entry is dropped on the 21st write', async () => {
    await seedKV('restore:cap', 'v0')
    for (let i = 1; i <= 21; i++) {
      await callTool('lore_manage', { action: 'set', key: 'restore:cap', text: `v${i}` })
    }
    // Restore 20 times — should reach v1 (v0 was evicted)
    for (let i = 0; i < 20; i++) {
      await callTool('lore_manage', { action: 'restore', key: 'restore:cap' })
    }
    const get = await callTool('lore_manage', { action: 'get', query: 'restore:cap' })
    expect(get.result.text).toBe('v1')
    // One more restore should report no history
    const last = await callTool('lore_manage', { action: 'restore', key: 'restore:cap' })
    expect(last.result.metadata.restored).toBe(false)
  })

  it('history is invisible to list_topics', async () => {
    await seedKV('restore:hidden', 'text')
    await callTool('lore_manage', { action: 'set', key: 'restore:hidden', text: 'updated' })
    const list = await callTool('lore_manage', { action: 'list' })
    const text = list.result.content[0].text as string
    expect(text).not.toContain('_history:')
  })

  it('works after patch_lore writes', async () => {
    await seedKV('restore:patched', 'Status: Alive\nNotes: clean')
    await callTool('lore_manage', { action: 'patch', key: 'restore:patched', operation: 'replace', target: 'Status: Alive', value: 'Status: Dead' })
    await callTool('lore_manage', { action: 'restore', key: 'restore:patched' })
    const get = await callTool('lore_manage', { action: 'get', query: 'restore:patched' })
    expect(get.result.text).toContain('Status: Alive')
  })

  it('works after increment_topic_field writes', async () => {
    await seedKV('restore:incremented', '**days_remaining:** 10')
    await callTool('lore_manage', { action: 'increment', key: 'restore:incremented', field_path: 'days_remaining', increment: -3 })
    await callTool('lore_manage', { action: 'restore', key: 'restore:incremented' })
    const get = await callTool('lore_manage', { action: 'get', query: 'restore:incremented' })
    expect(get.result.text).toContain('**days_remaining:** 10')
  })
})

describe('list_tags (#96)', () => {
  it('lists all tags created via tag_topic', async () => {
    await seedKV('topic:one', 'Topic one')
    await seedKV('topic:two', 'Topic two')
    await callTool('continuity_manage', { action: 'tag_topic', key: 'topic:one', add: ['theme:betrayal', 'faction:guild'] })
    await callTool('continuity_manage', { action: 'tag_topic', key: 'topic:two', add: ['theme:redemption'] })
    const res = await callTool('continuity_manage', { action: 'list_tags' })
    const text = res.result.content[0].text as string
    expect(text).toContain('theme:betrayal')
    expect(text).toContain('theme:redemption')
    expect(text).toContain('faction:guild')
    expect(res.result.tags.length).toBe(3)
  })

  it('returns counts when with_counts is true', async () => {
    await seedKV('topic:a', 'A')
    await seedKV('topic:b', 'B')
    await seedKV('topic:c', 'C')
    await callTool('continuity_manage', { action: 'tag_topic', key: 'topic:a', add: ['status:active', 'priority:high'] })
    await callTool('continuity_manage', { action: 'tag_topic', key: 'topic:b', add: ['status:active'] })
    const res = await callTool('continuity_manage', { action: 'list_tags', with_counts: true })
    const statusTag = res.result.tags.find((t: any) => t.tag === 'status:active')
    expect(statusTag).toBeDefined()
    expect(statusTag.count).toBe(2)
    const priorityTag = res.result.tags.find((t: any) => t.tag === 'priority:high')
    expect(priorityTag.count).toBe(1)
  })

  it('filters tags by prefix', async () => {
    await seedKV('topic:a', 'A')
    await callTool('continuity_manage', { action: 'tag_topic', key: 'topic:a', add: ['theme:betrayal', 'faction:guild', 'status:active'] })
    const res = await callTool('continuity_manage', { action: 'list_tags', prefix: 'theme:' })
    expect(res.result.tags.length).toBe(1)
    expect(res.result.tags[0].tag).toBe('theme:betrayal')
  })

  it('returns empty list when no tags exist', async () => {
    const res = await callTool('continuity_manage', { action: 'list_tags' })
    expect(res.result.tags.length).toBe(0)
    expect(res.result.content[0].text).toBe('No tags found.')
  })

  it('with_counts: false returns tags sorted alphabetically without counts', async () => {
    await seedKV('topic:a', 'A')
    await callTool('continuity_manage', { action: 'tag_topic', key: 'topic:a', add: ['zebra:tag', 'apple:tag'] })
    const res = await callTool('continuity_manage', { action: 'list_tags', with_counts: false })
    expect(res.result.tags[0].tag).toBe('apple:tag')
    expect(res.result.tags[1].tag).toBe('zebra:tag')
    expect(res.result.content[0].text).not.toContain('(')
  })

  it('invalid params returns error', async () => {
    const res = await callTool('continuity_manage', { action: 'list_tags', limit: 0 })
    expect(res.error).toBeDefined()
  })

  it('exercises both with_counts branches for full coverage', async () => {
    await seedKV('topic:a', 'A')
    await seedKV('topic:b', 'B')
    await callTool('continuity_manage', { action: 'tag_topic', key: 'topic:a', add: ['test:tag1', 'test:tag2'] })
    await callTool('continuity_manage', { action: 'tag_topic', key: 'topic:b', add: ['test:tag1'] })

    // Test with_counts: true (line 342-343 sort branch)
    const withCounts = await callTool('continuity_manage', { action: 'list_tags', with_counts: true })
    expect(withCounts.error).toBeUndefined()
    const sorted = withCounts.result.tags
    expect(sorted[0].count).toBeGreaterThanOrEqual(sorted[1].count)

    // Test with_counts: false (line 344-345 sort branch)
    const noCounts = await callTool('continuity_manage', { action: 'list_tags', with_counts: false })
    expect(noCounts.error).toBeUndefined()
    expect(noCounts.result.tags[0].tag.localeCompare(noCounts.result.tags[1].tag)).toBeLessThanOrEqual(0)
  })

  it('handles JSON.parse error in tag count fetch gracefully', async () => {
    // Seed a topic and tag it
    await seedKV('topic:corrupt', 'Corrupt topic')
    await callTool('continuity_manage', { action: 'tag_topic', key: 'topic:corrupt', add: ['corrupt:tag'] })

    // Corrupt the tag count entry with invalid JSON
    await env.LORE_DB.put('_tags:corrupt:tag', 'not-valid-json-array')

    // Call list_tags with_counts should still succeed (catch block at line 325-326)
    const res = await callTool('continuity_manage', { action: 'list_tags', with_counts: true })
    expect(res.error).toBeUndefined()

    // The corrupt tag should be in the list with count: 0 (from catch block)
    const corruptTag = res.result.tags.find((t: any) => t.tag === 'corrupt:tag')
    expect(corruptTag).toBeDefined()
    expect(corruptTag.count).toBe(0)
  })

  it('exercises ALL list_tags code paths for 100% coverage', async () => {
    // Create multiple topics and tags with varying counts to exercise:
    // - Line 315-332: for loop for each key, collected counter, continue on prefix mismatch
    // - Line 320-330: with_counts branch split (if/else)
    // - Line 334-335: cursor pagination
    // - Line 342-345: sorting both branches

    await seedKV('topic:a', 'A')
    await seedKV('topic:b', 'B')
    await seedKV('topic:c', 'C')

    // Create tags with different counts
    await callTool('continuity_manage', { action: 'tag_topic', key: 'topic:a', add: ['xray:one', 'alpha:one'] })
    await callTool('continuity_manage', { action: 'tag_topic', key: 'topic:b', add: ['xray:one', 'beta:one'] })
    await callTool('continuity_manage', { action: 'tag_topic', key: 'topic:c', add: ['xray:one'] })

    // Test 1: with_counts=true with prefix filter (lines 318, 320-330, 342-343)
    const withCountsAndPrefix = await callTool('continuity_manage', {
      action: 'list_tags',
      with_counts: true,
      prefix: 'xray:',
    })
    expect(withCountsAndPrefix.error).toBeUndefined()
    expect(withCountsAndPrefix.result.tags[0].tag).toBe('xray:one')
    expect(withCountsAndPrefix.result.tags[0].count).toBe(3)

    // Test 2: with_counts=false no prefix (lines 328-330, 344-345)
    const noCounts = await callTool('continuity_manage', {
      action: 'list_tags',
      with_counts: false,
    })
    expect(noCounts.error).toBeUndefined()
    // Tags should be sorted alphabetically
    for (let i = 0; i < noCounts.result.tags.length - 1; i++) {
      expect(noCounts.result.tags[i].tag.localeCompare(noCounts.result.tags[i + 1].tag)).toBeLessThanOrEqual(0)
    }

    // Test 3: with_counts=true no prefix (lines 320-327 full execution)
    const withCounts = await callTool('continuity_manage', {
      action: 'list_tags',
      with_counts: true,
    })
    expect(withCounts.error).toBeUndefined()
    // Tags should be sorted by count descending
    for (let i = 0; i < withCounts.result.tags.length - 1; i++) {
      expect(withCounts.result.tags[i].count).toBeGreaterThanOrEqual(withCounts.result.tags[i + 1].count)
    }

    // Test 4: prefix filter that matches nothing (line 318 continue branch)
    const noMatch = await callTool('continuity_manage', {
      action: 'list_tags',
      prefix: 'nonexistent:',
    })
    expect(noMatch.error).toBeUndefined()
    expect(noMatch.result.tags.length).toBe(0)

    // Test 5: limit param to exercise loop break (line 316)
    const limited = await callTool('continuity_manage', {
      action: 'list_tags',
      limit: 1,
    })
    expect(limited.error).toBeUndefined()
    expect(limited.result.tags.length).toBeLessThanOrEqual(1)
  })
})
