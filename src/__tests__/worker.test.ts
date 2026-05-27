// eslint-disable-next-line deprecation/deprecation
import { env, SELF, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Clean all KV storage after every test to prevent state leakage.
afterEach(() => reset())

// ── Helpers ───────────────────────────────────────────────────────────────────

async function rpc(method: string, params?: unknown) {
  // eslint-disable-next-line deprecation/deprecation
  const res = await SELF.fetch('http://example.com/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return res.json() as Promise<Record<string, any>>
}

function callTool(name: string, args: Record<string, unknown> = {}) {
  return rpc('tools/call', { name, arguments: args })
}

async function callToolWithApiKey(name: string, apiKey: string, args: Record<string, unknown> = {}) {
  // eslint-disable-next-line deprecation/deprecation
  const res = await SELF.fetch('http://example.com/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  return res.json() as Promise<Record<string, any>>
}

// Seed KV directly — avoids writing to the worker's in-memory loreDB fallback.
function seedKV(key: string, text: string) {
  // eslint-disable-next-line deprecation/deprecation
  return env.LORE_DB.put(key, JSON.stringify({ text, meta: { version: 1 } }))
}

const ADMIN_SECRET = 'test-secret-123'

// ── JSON-RPC protocol ─────────────────────────────────────────────────────────

describe('JSON-RPC protocol', () => {
  it('initialize returns server info and capabilities', async () => {
    const res = await rpc('initialize')
    expect(res.jsonrpc).toBe('2.0')
    expect(res.result.protocolVersion).toBe('2024-11-05')
    expect(res.result.serverInfo.name).toBe('holmgard-lore-mcp')
    expect(res.result.capabilities.tools.list).toBe(true)
    expect(res.result.capabilities.tools.call).toBe(true)
  })

  it('ping returns empty result', async () => {
    const res = await rpc('ping')
    expect(res.result).toEqual({})
  })

  it('tools/list returns exactly 56 tools', async () => {
    const res = await rpc('tools/list')
    const tools = res.result.tools as Array<{ name: string }>
    expect(tools).toHaveLength(56)
    const names = tools.map((t) => t.name)
    expect(names).toContain('ping_tool')
    expect(names).toContain('check_authentication')
    expect(names).toContain('list_topics')
    expect(names).toContain('get_lore')
    expect(names).toContain('set_lore')
    expect(names).toContain('delete_lore')
    expect(names).toContain('get_lore_batch')
    expect(names).toContain('get_lore_section')
    expect(names).toContain('list_consumption_timelines')
    expect(names).toContain('list_active_threads')
    expect(names).toContain('increment_topic_field')
    expect(names).toContain('validate_topic_exists')
    expect(names).toContain('search_lore')
    expect(names).toContain('patch_lore')
    expect(names).toContain('restore_lore')
    expect(names).toContain('resolve_interaction')
    expect(names).toContain('analyze_utility')
    expect(names).toContain('map_integration')
    expect(names).toContain('thread_tick')
    expect(names).toContain('batch_set_lore')
    expect(names).toContain('batch_mutate')
    expect(names).toContain('get_relationship')
    expect(names).toContain('get_faction_standing')
    expect(names).toContain('get_entity_knowledge')
    expect(names).toContain('get_location_occupants')
    expect(names).toContain('get_reachable_locations')
    expect(names).toContain('sense_environment')
    expect(names).toContain('get_inventory')
    expect(names).toContain('transfer_item')
    expect(names).toContain('activate_scene')
    expect(names).toContain('present_choices')
    expect(names).toContain('commit_choice')
    expect(names).toContain('get_choice_history')
    expect(names).toContain('advance_state_stage')
    expect(names).toContain('process_stage_batch')
    expect(names).toContain('generate_entity')
    expect(names).toContain('roll_encounter')
    expect(names).toContain('get_thread_comparison')
    expect(names).toContain('check_convergence')
    expect(names).toContain('get_sensory_profile')
    expect(names).toContain('get_compatibility')
    expect(names).toContain('append_event')
    expect(names).toContain('get_event_log')
    expect(names).toContain('recent_changes')
    expect(names).toContain('tag_topic')
    expect(names).toContain('find_by_tag')
    expect(names).toContain('bookmark_state')
    expect(names).toContain('world_diff')
    expect(names).toContain('plant_setup')
    expect(names).toContain('pay_off_setup')
    expect(names).toContain('list_unpaid_setups')
    expect(names).toContain('set_goal')
    expect(names).toContain('check_continuity')
    expect(names).toContain('scene_brief')
    expect(names).toContain('render_pov')
    expect(names).toContain('append_to_section')
  })

  it('rejects requests with wrong jsonrpc version', async () => {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'ping' }),
    }).then((r) => r.json() as Promise<Record<string, any>>)
    expect(res.error.code).toBe(-32600)
  })

  it('rejects batch requests', async () => {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }]),
    }).then((r) => r.json() as Promise<Record<string, any>>)
    expect(res.error.code).toBe(-32600)
    expect(res.error.message).toContain('Batch requests are not supported')
  })

  it('returns parse error on invalid JSON', async () => {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json {{',
    }).then((r) => r.json() as Promise<Record<string, any>>)
    expect(res.error.code).toBe(-32700)
  })

  it('returns method-not-found for unknown method', async () => {
    const res = await rpc('unknown_method_xyz')
    expect(res.error.code).toBe(-32601)
  })

  it('GET /mcp returns error directing caller to POST', async () => {
    const res = await SELF.fetch('http://example.com/mcp', { method: 'GET' })
    const body = await res.json() as Record<string, any>
    expect(body.error).toBeDefined()
  })
})

// ── ping_tool ─────────────────────────────────────────────────────────────────

describe('ping_tool', () => {
  it('returns pong', async () => {
    const res = await callTool('ping_tool')
    expect(res.result.content[0].text).toBe('pong')
    expect(res.result.metadata.source).toBe('internal')
  })
})

// ── check_authentication ──────────────────────────────────────────────────────

describe('check_authentication', () => {
  it('returns authenticated when correct X-Api-Key header is sent', async () => {
    const res = await callToolWithApiKey('check_authentication', 'test-api-key-xyz')
    expect(res.result.content[0].text).toBe('Authenticated.')
    expect(res.result.metadata.authenticated).toBe(true)
  })

  it('returns not authenticated when no X-Api-Key header is sent', async () => {
    const res = await callTool('check_authentication')
    expect(res.result.content[0].text).toBe('Not authenticated — request was made without a valid API key.')
    expect(res.result.metadata.authenticated).toBe(false)
  })

  it('returns not authenticated when wrong X-Api-Key header is sent', async () => {
    const res = await callToolWithApiKey('check_authentication', 'wrong-key')
    expect(res.result.content[0].text).toBe('Not authenticated — request was made without a valid API key.')
    expect(res.result.metadata.authenticated).toBe(false)
  })
})

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

// ── get_lore_batch (legacy bare method) ───────────────────────────────────────

describe('get_lore_batch legacy bare method', () => {
  it('resolves keys when called as bare method', async () => {
    await seedKV('batch:x1', 'X1 text')
    await seedKV('batch:x2', 'X2 text')
    // eslint-disable-next-line deprecation/deprecation
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'get_lore_batch', params: {} }),
    }).then(r => r.json() as Promise<Record<string, any>>)
    expect(res.error.code).toBe(-32602)
  })
})

// ── set_lore and delete_lore ──────────────────────────────────────────────────

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

// ── search_lore ───────────────────────────────────────────────────────────────

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

// ── validate_topic_exists ─────────────────────────────────────────────────────

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

// ── list_consumption_timelines ────────────────────────────────────────────────

describe('list_consumption_timelines', () => {
  it('returns empty when no character keys have timelines', async () => {
    await seedKV('location:dungeon', '**Consumption-Timeline:** 1 hour')
    const res = await callTool('list_consumption_timelines', { status_filter: 'all' })
    // location:* key is not scanned — only character:* keys
    expect(res.result.timelines).toHaveLength(0)
    expect(res.result.content[0].text).toBe('No consumption timelines found.')
  })

  it('parses Consumption-Timeline field from character:* entries', async () => {
    await seedKV('character:prey-alpha', '**Status:** Active\n**Consumption-Timeline:** 3 days\n**Processor:** Alpha')
    const res = await callTool('list_consumption_timelines', { status_filter: 'all' })
    expect(res.result.timelines).toHaveLength(1)
    expect(res.result.timelines[0].character_key).toBe('character:prey-alpha')
    expect(res.result.timelines[0].timeline_remaining).toBe('3 days')
    expect(res.result.timelines[0].current_status).toBe('Active')
  })

  it('skips characters with no timeline field', async () => {
    await seedKV('character:predator', 'No consumption timeline here.')
    const res = await callTool('list_consumption_timelines', { status_filter: 'all' })
    expect(res.result.timelines).toHaveLength(0)
  })

  it('status_filter=imminent matches hours', async () => {
    await seedKV('character:soon', '**Status:** Imminent\n**Consumption-Timeline:** 2 hours\n**Processor:** Beta')
    const res = await callTool('list_consumption_timelines', { status_filter: 'imminent' })
    expect(res.result.timelines).toHaveLength(1)
    expect(res.result.timelines[0].character_key).toBe('character:soon')
  })

  it('status_filter=imminent matches "1 day" (PS1 test 16D)', async () => {
    await seedKV('character:one-day', '**Status:** Imminent\n**Consumption-Timeline:** 1 day\n**Processor:** Alpha')
    const res = await callTool('list_consumption_timelines', { status_filter: 'imminent' })
    expect(res.result.timelines).toHaveLength(1)
    expect(res.result.timelines[0].character_key).toBe('character:one-day')
  })

  it('status_filter=imminent excludes weeks', async () => {
    await seedKV('character:weeks-away', '**Status:** Active\n**Consumption-Timeline:** 3 weeks\n**Processor:** Beta')
    const res = await callTool('list_consumption_timelines', { status_filter: 'imminent' })
    expect(res.result.timelines).toHaveLength(0)
  })

  it('status_filter=days-to-weeks includes days', async () => {
    await seedKV('character:days-prey', '**Status:** Active\n**Consumption-Timeline:** 5 days\n**Processor:** Gamma')
    const res = await callTool('list_consumption_timelines', { status_filter: 'days-to-weeks' })
    expect(res.result.timelines).toHaveLength(1)
  })

  it('status_filter=consumed matches consumed entries', async () => {
    await seedKV('character:done', '**Status:** Consumed\n**Consumption-Timeline:** consumed\n**Processor:** Delta')
    const res = await callTool('list_consumption_timelines', { status_filter: 'consumed' })
    expect(res.result.timelines).toHaveLength(1)
  })
})

// ── list_active_threads ───────────────────────────────────────────────────────

describe('list_active_threads', () => {
  it('returns message when system:active-narratives key is absent', async () => {
    const res = await callTool('list_active_threads')
    expect(res.result.content[0].text).toBe('No active narratives found.')
    expect(res.result.threads).toHaveLength(0)
  })

  it('parses Ascension and Dissolution thread entries', async () => {
    await seedKV('system:active-narratives', [
      '**Ascension Threads**',
      '  - **SilverThread** (alice)',
      '**Dissolution Threads**',
      '  - **DarkThread** (bob)',
    ].join('\n'))
    const res = await callTool('list_active_threads')
    expect(res.result.threads).toHaveLength(2)
    const names = res.result.threads.map((t: { thread_name: string }) => t.thread_name)
    expect(names).toContain('SilverThread')
    expect(names).toContain('DarkThread')
    const silver = res.result.threads.find((t: { thread_name: string }) => t.thread_name === 'SilverThread')
    expect(silver.category).toBe('Ascension')
    expect(silver.character).toBe('alice')
  })
})

// ── increment_topic_field ─────────────────────────────────────────────────────

describe('increment_topic_field', () => {
  beforeEach(() => seedKV('character:counter-test', '**days_remaining:** 10\n**status:** active'))

  it('decrements field value', async () => {
    const res = await callTool('increment_topic_field', {
      key: 'character:counter-test',
      field_path: 'days_remaining',
      increment: -1,
      reason: 'daily-decrement',
    })
    expect(res.result.metadata.old_value).toBe(10)
    expect(res.result.metadata.new_value).toBe(9)
    expect(res.result.metadata.version).toBe(2)
  })

  it('handles accelerated negative increment', async () => {
    const res = await callTool('increment_topic_field', {
      key: 'character:counter-test',
      field_path: 'days_remaining',
      increment: -3,
      reason: 'accelerated-decay',
    })
    expect(res.result.metadata.new_value).toBe(7)
  })

  it('handles positive increment', async () => {
    const res = await callTool('increment_topic_field', {
      key: 'character:counter-test',
      field_path: 'days_remaining',
      increment: 5,
    })
    expect(res.result.metadata.new_value).toBe(15)
  })

  it('updates the stored text so get_lore reflects the new value', async () => {
    await callTool('increment_topic_field', {
      key: 'character:counter-test',
      field_path: 'days_remaining',
      increment: -1,
    })
    const get = await callTool('get_lore', { query: 'character:counter-test' })
    expect(get.result.text).toContain('**days_remaining:** 9')
  })

  it('returns error when field value is not numeric', async () => {
    const res = await callTool('increment_topic_field', {
      key: 'character:counter-test',
      field_path: 'status',
      increment: 1,
    })
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('not numeric')
  })

  it('returns error when key does not exist', async () => {
    const res = await callTool('increment_topic_field', {
      key: 'nonexistent:key-99999',
      field_path: 'days_remaining',
    })
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('not found')
  })
})

// ── patch_lore ────────────────────────────────────────────────────────────────

describe('patch_lore — replace', () => {
  beforeEach(() => seedKV('test:patch-replace', 'Status: Alive\nDays: 14'))

  it('replaces a unique substring', async () => {
    const res = await callTool('patch_lore', {
      key: 'test:patch-replace',
      operation: 'replace',
      target: 'Status: Alive',
      value: 'Status: Sedated',
    })
    expect(res.result.content[0].text).toContain('Replaced 1 occurrence')
  })

  it('the replacement is reflected in get_lore', async () => {
    await callTool('patch_lore', {
      key: 'test:patch-replace',
      operation: 'replace',
      target: 'Status: Alive',
      value: 'Status: Sedated',
    })
    const get = await callTool('get_lore', { query: 'test:patch-replace' })
    expect(get.result.text).toContain('Status: Sedated')
    expect(get.result.text).not.toContain('Status: Alive')
  })

  it('returns not-found message when target is absent', async () => {
    const res = await callTool('patch_lore', {
      key: 'test:patch-replace',
      operation: 'replace',
      target: 'Nonexistent phrase',
      value: 'X',
    })
    expect(res.result.content[0].text).toContain('not found in')
  })
})

describe('patch_lore — replace with ambiguous target', () => {
  beforeEach(() => seedKV('test:patch-ambig', 'the cat chased the cat'))

  it('refuses when target matches more than once', async () => {
    const res = await callTool('patch_lore', {
      key: 'test:patch-ambig',
      operation: 'replace',
      target: 'the cat',
      value: 'a dog',
    })
    expect(res.result.content[0].text).toContain('Ambiguous')
  })
})

describe('patch_lore — append', () => {
  it('appends to end when no target given', async () => {
    await seedKV('test:patch-append', 'Line 1')
    const res = await callTool('patch_lore', {
      key: 'test:patch-append',
      operation: 'append',
      value: '\nLine 2',
    })
    expect(res.result.content[0].text).toContain('Appended to end')
    const get = await callTool('get_lore', { query: 'test:patch-append' })
    expect(get.result.text).toContain('Line 2')
  })

  it('appends directly after a specific target', async () => {
    await seedKV('test:patch-append-t', 'Header\nBody')
    const res = await callTool('patch_lore', {
      key: 'test:patch-append-t',
      operation: 'append',
      target: 'Header',
      value: '\nSubheader',
    })
    expect(res.result.content[0].text).toContain('Appended after')
    const get = await callTool('get_lore', { query: 'test:patch-append-t' })
    expect(get.result.text).toContain('Subheader')
  })
})

describe('patch_lore — delete_field', () => {
  beforeEach(() => seedKV('test:patch-delete', 'Keep this.\nDelete this.\nKeep that.'))

  it('removes matching substring', async () => {
    const res = await callTool('patch_lore', {
      key: 'test:patch-delete',
      operation: 'delete_field',
      target: 'Delete this.\n',
    })
    expect(res.result.content[0].text).toContain('Deleted 1 occurrence')
  })

  it('the deletion is reflected in get_lore', async () => {
    await callTool('patch_lore', {
      key: 'test:patch-delete',
      operation: 'delete_field',
      target: 'Delete this.\n',
    })
    const get = await callTool('get_lore', { query: 'test:patch-delete' })
    expect(get.result.text).not.toContain('Delete this.')
    expect(get.result.text).toContain('Keep this.')
  })
})

describe('patch_lore — parameter validation', () => {
  beforeEach(() => seedKV('test:patch-val', 'some text here'))

  it('requires target for replace', async () => {
    const res = await callTool('patch_lore', { key: 'test:patch-val', operation: 'replace', value: 'X' })
    expect(res.result.content[0].text).toContain('"target" required')
  })

  it('requires target for delete_field', async () => {
    const res = await callTool('patch_lore', { key: 'test:patch-val', operation: 'delete_field' })
    expect(res.result.content[0].text).toContain('"target" required')
  })

  it('requires value for replace', async () => {
    const res = await callTool('patch_lore', { key: 'test:patch-val', operation: 'replace', target: 'some text' })
    expect(res.result.content[0].text).toContain('"value" required')
  })

  it('requires value for append', async () => {
    const res = await callTool('patch_lore', { key: 'test:patch-val', operation: 'append' })
    expect(res.result.content[0].text).toContain('"value" required')
  })

  it('returns not-found message for nonexistent key', async () => {
    const res = await callTool('patch_lore', {
      key: 'nonexistent:key-99999',
      operation: 'replace',
      target: 'X',
      value: 'Y',
    })
    expect(res.result.content[0].text).toContain('not found')
  })

  it('rejects unknown operation', async () => {
    const res = await callTool('patch_lore', {
      key: 'test:patch-val',
      operation: 'unknown_op',
    })
    expect(res.result.content[0].text).toContain('Unknown operation')
  })
})

// ── Admin endpoints ───────────────────────────────────────────────────────────

describe('admin endpoints', () => {
  async function adminPost(path: string, body: Record<string, unknown>) {
    return SELF.fetch(`http://example.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  describe('/admin/set-lore', () => {
    it('stores lore and returns ok:true with correct secret', async () => {
      const res = await adminPost('/admin/set-lore', {
        key: 'admin:test', text: 'Admin content', secret: ADMIN_SECRET,
      })
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(true)
      expect(body.version).toBe(1)
    })

    it('returns 401 with wrong secret', async () => {
      const res = await adminPost('/admin/set-lore', {
        key: 'admin:test', text: 'Admin content', secret: 'wrong-secret',
      })
      expect(res.status).toBe(401)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(false)
    })

    it('returns 401 when secret is omitted', async () => {
      const res = await adminPost('/admin/set-lore', { key: 'admin:test', text: 'Admin content' })
      expect(res.status).toBe(401)
    })

    it('returns 400 when key is missing', async () => {
      const res = await adminPost('/admin/set-lore', { text: 'Admin content', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })
  })

  describe('/admin/delete-lore', () => {
    it('deletes lore and returns ok:true with correct secret', async () => {
      await env.LORE_DB.put('admin:del-target', JSON.stringify({ text: 'to delete', meta: {} }))
      const res = await adminPost('/admin/delete-lore', { key: 'admin:del-target', secret: ADMIN_SECRET })
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(true)
    })

    it('returns 401 with wrong secret', async () => {
      const res = await adminPost('/admin/delete-lore', { key: 'admin:test', secret: 'wrong' })
      expect(res.status).toBe(401)
    })

    it('returns 400 when key is missing', async () => {
      const res = await adminPost('/admin/delete-lore', { secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })
  })
})

// ── restore_lore ──────────────────────────────────────────────────────────────

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

// ── batch_set_lore ────────────────────────────────────────────────────────────

describe('batch_set_lore', () => {
  it('writes multiple new keys and reports set_count', async () => {
    const res = await callTool('batch_set_lore', {
      entries: [
        { key: 'batch:alpha', text: 'Alpha content' },
        { key: 'batch:beta', text: 'Beta content' },
      ],
    })
    expect(res.result.metadata.total).toBe(2)
    expect(res.result.metadata.set_count).toBe(2)
    expect(res.result.metadata.failed_count).toBe(0)
    expect(res.result.content[0].text).toContain('Saved 2')
    expect(res.result.results['batch:alpha'].ok).toBe(true)
    expect(res.result.results['batch:beta'].ok).toBe(true)
  })

  it('entries are retrievable via get_lore after batch write', async () => {
    await callTool('batch_set_lore', {
      entries: [
        { key: 'batch:verify-a', text: 'Verify A' },
        { key: 'batch:verify-b', text: 'Verify B' },
      ],
    })
    const a = await callTool('get_lore', { query: 'batch:verify-a' })
    expect(a.result.content[0].text).toBe('Verify A')
    const b = await callTool('get_lore', { query: 'batch:verify-b' })
    expect(b.result.content[0].text).toBe('Verify B')
  })

  it('increments version when overwriting an existing key', async () => {
    await seedKV('batch:existing', 'original text')
    const res = await callTool('batch_set_lore', {
      entries: [{ key: 'batch:existing', text: 'updated text' }],
    })
    expect(res.result.results['batch:existing'].version).toBe(2)
    const get = await callTool('get_lore', { query: 'batch:existing' })
    expect(get.result.text).toBe('updated text')
  })

  it('pushes history for overwritten keys', async () => {
    await seedKV('batch:hist', 'v1 text')
    await callTool('batch_set_lore', { entries: [{ key: 'batch:hist', text: 'v2 text' }] })
    const restore = await callTool('restore_lore', { key: 'batch:hist' })
    expect(restore.result.metadata.restored).toBe(true)
    const get = await callTool('get_lore', { query: 'batch:hist' })
    expect(get.result.text).toBe('v1 text')
  })

  it('returns validation error for empty entries array', async () => {
    const res = await callTool('batch_set_lore', { entries: [] })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('normalizes keys to lowercase', async () => {
    await callTool('batch_set_lore', { entries: [{ key: 'Batch:UPPER', text: 'lower key test' }] })
    const get = await callTool('get_lore', { query: 'batch:upper' })
    expect(get.result.content[0].text).toBe('lower key test')
  })
})

// ── batch_mutate ──────────────────────────────────────────────────────────────

describe('batch_mutate', () => {
  it('applies an increment mutation and returns old/new values', async () => {
    await seedKV('mutate:counter', '**days_remaining:** 10\n**status:** active')
    const res = await callTool('batch_mutate', {
      mutations: [{ key: 'mutate:counter', action: 'increment', field_path: 'days_remaining', increment: -1, reason: 'test-decrement' }],
    })
    expect(res.result.metadata.ok_count).toBe(1)
    expect(res.result.metadata.failed_count).toBe(0)
    expect(res.result.results[0].ok).toBe(true)
    expect(res.result.results[0].old_value).toBe(10)
    expect(res.result.results[0].new_value).toBe(9)
  })

  it('increment is reflected in KV', async () => {
    await seedKV('mutate:kv-check', '**days_remaining:** 5')
    await callTool('batch_mutate', {
      mutations: [{ key: 'mutate:kv-check', action: 'increment', field_path: 'days_remaining', increment: -2 }],
    })
    const get = await callTool('get_lore', { query: 'mutate:kv-check' })
    expect(get.result.text).toContain('**days_remaining:** 3')
  })

  it('applies a patch replace mutation', async () => {
    await seedKV('mutate:patch-test', 'Status: Alive\nNotes: none')
    const res = await callTool('batch_mutate', {
      mutations: [{ key: 'mutate:patch-test', action: 'patch', operation: 'replace', target: 'Status: Alive', value: 'Status: Sedated' }],
    })
    expect(res.result.results[0].ok).toBe(true)
    const get = await callTool('get_lore', { query: 'mutate:patch-test' })
    expect(get.result.text).toContain('Status: Sedated')
    expect(get.result.text).not.toContain('Status: Alive')
  })

  it('applies a patch append mutation', async () => {
    await seedKV('mutate:append-test', 'Line 1')
    await callTool('batch_mutate', {
      mutations: [{ key: 'mutate:append-test', action: 'patch', operation: 'append', value: '\nLine 2' }],
    })
    const get = await callTool('get_lore', { query: 'mutate:append-test' })
    expect(get.result.text).toContain('Line 2')
  })

  it('applies two mutations to the same key sequentially', async () => {
    await seedKV('mutate:double', 'Status: Alive\n**count:** 5')
    const res = await callTool('batch_mutate', {
      mutations: [
        { key: 'mutate:double', action: 'patch', operation: 'replace', target: 'Status: Alive', value: 'Status: Sedated' },
        { key: 'mutate:double', action: 'increment', field_path: 'count', increment: -1 },
      ],
    })
    expect(res.result.metadata.ok_count).toBe(2)
    const get = await callTool('get_lore', { query: 'mutate:double' })
    expect(get.result.text).toContain('Status: Sedated')
    expect(get.result.text).toContain('**count:** 4')
  })

  it('reports failure for missing key', async () => {
    const res = await callTool('batch_mutate', {
      mutations: [{ key: 'nonexistent:key-99999', action: 'increment', field_path: 'days_remaining' }],
    })
    expect(res.result.results[0].ok).toBe(false)
    expect(res.result.results[0].message).toContain('not found')
    expect(res.result.metadata.failed_count).toBe(1)
  })

  it('reports failure for non-numeric increment field', async () => {
    await seedKV('mutate:non-numeric', '**status:** active')
    const res = await callTool('batch_mutate', {
      mutations: [{ key: 'mutate:non-numeric', action: 'increment', field_path: 'status' }],
    })
    expect(res.result.results[0].ok).toBe(false)
    expect(res.result.results[0].message).toContain('not numeric')
  })

  it('reports failure for ambiguous patch target', async () => {
    await seedKV('mutate:ambig', 'cat cat cat')
    const res = await callTool('batch_mutate', {
      mutations: [{ key: 'mutate:ambig', action: 'patch', operation: 'replace', target: 'cat', value: 'dog' }],
    })
    expect(res.result.results[0].ok).toBe(false)
    expect(res.result.results[0].message).toContain('ambiguous')
  })

  it('continues applying remaining mutations after a failure', async () => {
    await seedKV('mutate:mixed', 'Status: Alive')
    const res = await callTool('batch_mutate', {
      mutations: [
        { key: 'nonexistent:missing', action: 'increment', field_path: 'x' },
        { key: 'mutate:mixed', action: 'patch', operation: 'replace', target: 'Status: Alive', value: 'Status: Dead' },
      ],
    })
    expect(res.result.metadata.ok_count).toBe(1)
    expect(res.result.metadata.failed_count).toBe(1)
    const get = await callTool('get_lore', { query: 'mutate:mixed' })
    expect(get.result.text).toContain('Status: Dead')
  })

  it('returns validation error for empty mutations array', async () => {
    const res = await callTool('batch_mutate', { mutations: [] })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('pushes history for mutated keys', async () => {
    await seedKV('mutate:hist', 'Status: Alive')
    await callTool('batch_mutate', {
      mutations: [{ key: 'mutate:hist', action: 'patch', operation: 'replace', target: 'Status: Alive', value: 'Status: Dead' }],
    })
    const restore = await callTool('restore_lore', { key: 'mutate:hist' })
    expect(restore.result.metadata.restored).toBe(true)
    const get = await callTool('get_lore', { query: 'mutate:hist' })
    expect(get.result.text).toContain('Status: Alive')
  })
})

// ── list_consumption_timelines — legacy Projected-Consumption-Timeline ────────

describe('list_consumption_timelines — Projected-Consumption-Timeline fallback', () => {
  it('parses legacy Projected-Consumption-Timeline field', async () => {
    await seedKV('character:legacy-prey', '**Status:** Imminent\n**Projected-Consumption-Timeline:** 2 days\n**Processor:** Beta')
    const res = await callTool('list_consumption_timelines', { status_filter: 'all' })
    expect(res.result.timelines).toHaveLength(1)
    expect(res.result.timelines[0].character_key).toBe('character:legacy-prey')
    expect(res.result.timelines[0].timeline_remaining).toBe('2 days')
  })

  it('prefers primary Consumption-Timeline over Projected fallback when both present', async () => {
    await seedKV(
      'character:dual-field',
      '**Status:** Active\n**Consumption-Timeline:** 5 days\n**Projected-Consumption-Timeline:** 10 days\n**Processor:** Gamma',
    )
    const res = await callTool('list_consumption_timelines', { status_filter: 'all' })
    expect(res.result.timelines[0].timeline_remaining).toBe('5 days')
  })

  it('legacy fallback entry appears in status_filter=imminent when matching', async () => {
    await seedKV('character:legacy-imminent', '**Status:** Imminent\n**Projected-Consumption-Timeline:** 3 hours\n**Processor:** Alpha')
    const res = await callTool('list_consumption_timelines', { status_filter: 'imminent' })
    expect(res.result.timelines).toHaveLength(1)
    expect(res.result.timelines[0].character_key).toBe('character:legacy-imminent')
  })
})

// ── batch_mutate — content text summary ───────────────────────────────────────

describe('batch_mutate — content[0].text summary', () => {
  it('reports "Applied N mutations." when all succeed', async () => {
    await seedKV('mutate:sum-alpha', 'Alpha batch content.')
    await seedKV('mutate:sum-beta', 'Beta batch content.')
    const res = await callTool('batch_mutate', {
      mutations: [
        { key: 'mutate:sum-alpha', action: 'patch', operation: 'replace', target: 'Alpha batch content.', value: 'Alpha mutated.' },
        { key: 'mutate:sum-beta', action: 'patch', operation: 'append', value: '\nAppended line.' },
      ],
    })
    expect(res.result.content[0].text).toContain('Applied 2')
    expect(res.result.metadata.ok_count).toBe(2)
    expect(res.result.metadata.failed_count).toBe(0)
  })

  it('reports "Applied X/Y mutations. N failed" on partial failure', async () => {
    await seedKV('mutate:sum-partial', 'Status: Alive')
    const res = await callTool('batch_mutate', {
      mutations: [
        { key: 'nonexistent:sum-missing', action: 'increment', field_path: 'days_remaining' },
        { key: 'mutate:sum-partial', action: 'patch', operation: 'replace', target: 'Status: Alive', value: 'Status: Dead' },
      ],
    })
    expect(res.result.content[0].text).toContain('Applied 1/2')
    expect(res.result.content[0].text).toContain('failed')
    expect(res.result.metadata.ok_count).toBe(1)
    expect(res.result.metadata.failed_count).toBe(1)
  })

  it('reports "Applied 1 mutation." (singular) when exactly one succeeds', async () => {
    await seedKV('mutate:sum-single', 'Note: initial')
    const res = await callTool('batch_mutate', {
      mutations: [
        { key: 'mutate:sum-single', action: 'patch', operation: 'replace', target: 'Note: initial', value: 'Note: updated' },
      ],
    })
    expect(res.result.content[0].text).toMatch(/Applied 1 mutation\./)
  })
})

// ── increment_topic_field — field not present ─────────────────────────────────

describe('increment_topic_field — field not present in text', () => {
  it('returns error when field_path does not exist in lore text', async () => {
    await seedKV('character:no-field', '**Status:** Active\n**character:** test-subject')
    const res = await callTool('increment_topic_field', {
      key: 'character:no-field',
      field_path: 'days_remaining',
      increment: -1,
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.message).toContain('days_remaining')
  })

  it('returns error when text has matching field name but no numeric value', async () => {
    await seedKV('character:non-numeric-field', '**Status:** Test\n**days_remaining:** pending\n**character:** test-subject')
    const res = await callTool('increment_topic_field', {
      key: 'character:non-numeric-field',
      field_path: 'days_remaining',
      increment: -1,
    })
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('not numeric')
  })
})

// ── batch_set_lore + batch_mutate integration ─────────────────────────────────

describe('batch_set_lore + batch_mutate integration', () => {
  it('writes two entries then mutates both: replace on one, append on the other', async () => {
    const alphaKey = 'integration:batch-alpha'
    const betaKey = 'integration:batch-beta'

    const setRes = await callTool('batch_set_lore', {
      entries: [
        { key: alphaKey, text: 'Alpha batch content.' },
        { key: betaKey, text: 'Beta batch content.' },
      ],
    })
    expect(setRes.result.content[0].text).toContain('Saved 2')

    const alphaGet = await callTool('get_lore', { query: alphaKey })
    expect(alphaGet.result.content[0].text).toContain('Alpha batch content')

    const mutRes = await callTool('batch_mutate', {
      mutations: [
        { key: alphaKey, action: 'patch', operation: 'replace', target: 'Alpha batch content.', value: 'Alpha mutated.' },
        { key: betaKey, action: 'patch', operation: 'append', value: '\nAppended line.' },
      ],
    })
    expect(mutRes.result.content[0].text).toContain('Applied 2')
    expect(mutRes.result.metadata.ok_count).toBe(2)

    const alphaVerify = await callTool('get_lore', { query: alphaKey })
    expect(alphaVerify.result.content[0].text).toContain('Alpha mutated')
    expect(alphaVerify.result.content[0].text).not.toContain('Alpha batch content')

    const betaVerify = await callTool('get_lore', { query: betaKey })
    expect(betaVerify.result.content[0].text).toContain('Appended line')
  })
})

// ── resolve_interaction ───────────────────────────────────────────────────────

describe('resolve_interaction', () => {
  it('returns error when entity_a not found', async () => {
    await seedKV('character:defender', '**Weight-2:** 5')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'nonexistent:attacker',
      entity_b_id: 'character:defender',
      action_type: 'test',
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.message).toContain('not found')
  })

  it('returns error when entity_b not found', async () => {
    await seedKV('character:attacker', '**Weight-1:** 5')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'character:attacker',
      entity_b_id: 'nonexistent:defender',
      action_type: 'test',
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('returns error when entity_a is missing Weight-1 field', async () => {
    await seedKV('character:no-weight', 'no numeric fields here')
    await seedKV('character:has-weight-2', '**Weight-2:** 3')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'character:no-weight',
      entity_b_id: 'character:has-weight-2',
      action_type: 'test',
    })
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('Weight-1')
  })

  it('always succeeds when P=1 (W1=1.0, W2=0)', async () => {
    // Formula: w1 - w2*0.3 → 1.0 - 0 = 1.0, clamped to 1.0 → roll always < 1
    await seedKV('character:strong', '**Weight-1:** 1.0\n**State-Level:** 0')
    await seedKV('character:weak', '**Weight-2:** 0')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'character:strong',
      entity_b_id: 'character:weak',
      action_type: 'consume',
    })
    expect(res.result.success).toBe(true)
    expect(res.result.delta_value).toBeGreaterThan(0)
    expect(res.result.metadata.probability).toBe(1)
  })

  it('always fails when P=0 (W1=0, high W2)', async () => {
    // Formula: 0 - 1.0*0.3 = -0.3, clamped to 0 → roll always >= 0
    await seedKV('character:zero-attacker', '**Weight-1:** 0')
    await seedKV('character:strong-defender', '**Weight-2:** 1.0')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'character:zero-attacker',
      entity_b_id: 'character:strong-defender',
      action_type: 'consume',
    })
    expect(res.result.success).toBe(false)
    expect(res.result.delta_value).toBe(0)
    expect(res.result.metadata.probability).toBe(0)
  })

  it('increments State-Level in KV on success', async () => {
    // W1=1.0, W2=0 → P=1.0 → guaranteed success
    await seedKV('character:winner', '**Weight-1:** 1.0\n**State-Level:** 5')
    await seedKV('character:loser', '**Weight-2:** 0')
    await callTool('resolve_interaction', {
      entity_a_id: 'character:winner',
      entity_b_id: 'character:loser',
      action_type: 'consume',
    })
    const get = await callTool('get_lore', { query: 'character:winner' })
    const level = parseInt(get.result.text.match(/\*\*State-Level:\*\*\s*(\d+)/)?.[1] ?? '5')
    expect(level).toBeGreaterThan(5)
  })

  it('does not modify KV on failure', async () => {
    // W1=0, W2=1.0 → P=0 → guaranteed failure
    await seedKV('character:guaranteed-fail', '**Weight-1:** 0\n**State-Level:** 3')
    await seedKV('character:guaranteed-win', '**Weight-2:** 1.0')
    await callTool('resolve_interaction', {
      entity_a_id: 'character:guaranteed-fail',
      entity_b_id: 'character:guaranteed-win',
      action_type: 'consume',
    })
    const get = await callTool('get_lore', { query: 'character:guaranteed-fail' })
    expect(get.result.text).toContain('**State-Level:** 3')
  })

  it('returns metadata with weight_1, weight_2, probability, and roll', async () => {
    // 0.6 and 0.2 are in [0,1] — no normalization applied
    await seedKV('character:meta-a', '**Weight-1:** 0.6')
    await seedKV('character:meta-b', '**Weight-2:** 0.2')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'character:meta-a',
      entity_b_id: 'character:meta-b',
      action_type: 'test-action',
    })
    expect(res.result.metadata.weight_1).toBe(0.6)
    expect(res.result.metadata.weight_2).toBe(0.2)
    // P = 0.6 - 0.2*0.3 = 0.6 - 0.06 = 0.54
    expect(res.result.metadata.probability).toBeCloseTo(0.54, 5)
    expect(typeof res.result.metadata.roll).toBe('number')
    expect(res.result.metadata.action_type).toBe('test-action')
  })

  it('normalizes integer-scale weights (>1) to [0,1] before computing probability', async () => {
    // Integer weights like "Weight-1: 30" mean 30/100 = 0.30 in float terms
    await seedKV('character:int-actor', '**Weight-1:** 30\n**State-Level:** 0')
    await seedKV('character:int-target', '**Weight-2:** 55')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'character:int-actor',
      entity_b_id: 'character:int-target',
      action_type: 'hunt',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1).toBeCloseTo(0.30, 5)
    expect(res.result.metadata.weight_2).toBeCloseTo(0.55, 5)
    expect(res.result.metadata.weight_1_raw).toBe(30)
    expect(res.result.metadata.weight_2_raw).toBe(55)
    // P = 0.30 - 0.55*0.3 = 0.30 - 0.165 = 0.135 — meaningful, not clamped to 1
    expect(res.result.metadata.probability).toBeCloseTo(0.135, 3)
  })

  it('reads weights from plain loose-format fields (no bold markers)', async () => {
    // AI-written lore may omit **bold:** syntax; loose Pass 3 should handle it
    // Weight-1: 10 → normalizes to 0.10
    await seedKV('character:loose-attacker', 'Weight-1: 10\nState-Level: 0')
    await seedKV('character:loose-defender', 'Weight-2: 0')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'character:loose-attacker',
      entity_b_id: 'character:loose-defender',
      action_type: 'hunt',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1).toBeCloseTo(0.1, 5)
    expect(res.result.metadata.weight_1_raw).toBe(10)
    expect(res.result.metadata.weight_2).toBe(0)
  })

  it('reads weights from markdown-header loose format (# Field: value)', async () => {
    await seedKV('character:header-attacker', '# Entity: subject-alpha\nWeight-1: 0.9\nState-Level: 0')
    await seedKV('character:header-defender', '# Entity: prey-beta\nWeight-2: 0.1')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'character:header-attacker',
      entity_b_id: 'character:header-defender',
      action_type: 'consume',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1).toBe(0.9)
    expect(res.result.metadata.weight_2).toBe(0.1)
  })

  it('reads float weights from bullet-style descriptor fields', async () => {
    // Format used in real character lore: - **Weight-1 (Aggression/Predator-Drive):** 0.9
    await seedKV('character:bullet-attacker', '- **Weight-1 (Aggression/Predator-Drive):** 0.9\n**State-Level:** 0')
    await seedKV('character:bullet-defender', '- **Weight-2 (Resilience):** 0.1')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'character:bullet-attacker',
      entity_b_id: 'character:bullet-defender',
      action_type: 'hunt',
    })
    // P = 0.9 - 0.1*0.3 = 0.87 — should not error
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1).toBe(0.9)
    expect(res.result.metadata.weight_2).toBe(0.1)
  })
})

// ── extractFieldFromText / updateFieldInText (via increment_topic_field) ──────

describe('field extraction — bullet-style and float formats', () => {
  it('extracts float from plain **Field:** format', async () => {
    await seedKV('character:plain-float', '**Weight-1:** 0.9\n**Status:** active')
    const res = await callTool('increment_topic_field', {
      key: 'character:plain-float',
      field_path: 'Weight-1',
      increment: 0.1,
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.old_value).toBe(0.9)
    expect(res.result.metadata.new_value).toBeCloseTo(1.0)
  })

  it('extracts float from bullet + descriptor format', async () => {
    await seedKV('character:bullet-float', '- **Weight-1 (Aggression/Predator-Drive):** 0.75\n**Status:** active')
    const res = await callTool('increment_topic_field', {
      key: 'character:bullet-float',
      field_path: 'Weight-1',
      increment: 0.1,
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.old_value).toBe(0.75)
    expect(res.result.metadata.new_value).toBeCloseTo(0.85)
  })

  it('preserves bullet + descriptor format when updating', async () => {
    await seedKV('character:preserve-format', '- **Weight-1 (Aggression):** 0.5\n**Status:** active')
    await callTool('increment_topic_field', {
      key: 'character:preserve-format',
      field_path: 'Weight-1',
      increment: 0.2,
    })
    const get = await callTool('get_lore', { query: 'character:preserve-format' })
    // The line should preserve its bullet and descriptor, only the value changes
    expect(get.result.text).toMatch(/- \*\*Weight-1 \(Aggression\):\*\*\s*0\.7/)
  })

  it('extracts numeric value from JSON block format', async () => {
    const jsonLore = '```json\n{\n  "Weight-1": 0.6,\n  "Status": "active"\n}\n```'
    await seedKV('character:json-block', jsonLore)
    const res = await callTool('increment_topic_field', {
      key: 'character:json-block',
      field_path: 'Weight-1',
      increment: 0.1,
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.old_value).toBe(0.6)
    expect(res.result.metadata.new_value).toBeCloseTo(0.7)
  })

  it('stores clean float without IEEE 754 noise', async () => {
    await seedKV('character:float-precision', '**Weight-1:** 0.75\n**Status:** active')
    await callTool('increment_topic_field', {
      key: 'character:float-precision',
      field_path: 'Weight-1',
      increment: 0.1,
    })
    const get = await callTool('get_lore', { query: 'character:float-precision' })
    // Should store 0.85, not 0.8500000000000001
    expect(get.result.text).toContain('**Weight-1:** 0.85')
  })
})

// ── extractRawField (via thread_tick) ─────────────────────────────────────────

describe('extractRawField — bullet-style format', () => {
  it('thread_tick finds entity whose Thread field uses bullet+descriptor format', async () => {
    await seedKV('character:bullet-thread-member', [
      '- **Thread (Active):** bullet-thread-test',
      '**Timeline-Value:** 5',
      '**Current-Date:** 2099-01-01',
    ].join('\n'))
    const res = await callTool('thread_tick', { thread_id: 'bullet-thread-test' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.entities_ticked).toBe(1)
  })
})

// ── analyze_utility v2 ────────────────────────────────────────────────────────

describe('analyze_utility', () => {
  it('returns error when entity not found', async () => {
    const res = await callTool('analyze_utility', { entity_id: 'nonexistent:entity', utility_vector: 'GASTRIC' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('rejects old VECTOR_* enum values', async () => {
    await seedKV('character:any', 'text')
    const res = await callTool('analyze_utility', { entity_id: 'character:any', utility_vector: 'VECTOR_A' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('returns grade F and empty breakdown when entity has no matching numeric fields', async () => {
    await seedKV('character:blank', 'No numeric fields here. Status: active.')
    const res = await callTool('analyze_utility', { entity_id: 'character:blank', utility_vector: 'GASTRIC' })
    expect(res.result.grade).toBe('F')
    expect(res.result.composite_score).toBe(0)
    expect(res.result.breakdown).toEqual([])
    expect(res.result.fields_analyzed).toEqual([])
    expect(res.result.projected_yield).toContain('No quantifiable metrics')
    expect(res.result.missing_fields.length).toBeGreaterThan(0)
  })

  it('GASTRIC: computes correct score from spec example values', async () => {
    // All 6 fields present — no redistribution needed (weights stay as-is)
    // Expected sum: 0.88*0.25 + 0.82*0.20 + 0.84*0.20 + 0.75*0.15 + 0.91*0.10 + (1-0.18)*0.10
    // = 0.22 + 0.164 + 0.168 + 0.1125 + 0.091 + 0.082 = 0.8375 → *100 = 83.75 → round = 84
    await seedKV('character:seraphine', [
      '**Tenderness-Index:** 0.88',
      '**Fat-Marbling-Index:** 0.82',
      '**Sensory-Receptivity:** 0.84',
      '**Weight-2 (Prey Vulnerability):** 0.75',
      '**Compliance-Potential:** 0.91',
      '**Cortisol-Level:** 0.18',
    ].join('\n'))
    const res = await callTool('analyze_utility', { entity_id: 'character:seraphine', utility_vector: 'GASTRIC' })
    expect(res.result.grade).toBe('A')
    expect(res.result.composite_score).toBe(84)
    expect(res.result.entity_role).toBe('subject')
    expect(res.result.fields_analyzed).toHaveLength(6)
  })

  it('GASTRIC: cortisol inversion is applied and noted in breakdown', async () => {
    await seedKV('character:cortisol-test', [
      '**Tenderness-Index:** 0.80',
      '**Fat-Marbling-Index:** 0.80',
      '**Sensory-Receptivity:** 0.80',
      '**Weight-2:** 0.80',
      '**Compliance-Potential:** 0.80',
      '**Cortisol-Level:** 0.80',
    ].join('\n'))
    const res = await callTool('analyze_utility', { entity_id: 'character:cortisol-test', utility_vector: 'GASTRIC' })
    const cortisolEntry = res.result.breakdown.find((b: any) => b.field === 'Cortisol-Level')
    expect(cortisolEntry).toBeDefined()
    expect(cortisolEntry.raw_value).toBe(0.8)
    expect(cortisolEntry.effective_value).toBeCloseTo(0.2, 2)
    expect(cortisolEntry.note).toMatch(/INVERTED/)
  })

  it('GASTRIC: missing fields reduce pool and redistribute weights', async () => {
    // Only 2 of 6 fields present — weights for present fields are scaled up
    await seedKV('character:partial', [
      '**Tenderness-Index:** 1.0',
      '**Compliance-Potential:** 1.0',
    ].join('\n'))
    const res = await callTool('analyze_utility', { entity_id: 'character:partial', utility_vector: 'GASTRIC' })
    // missing 4 fields — Tenderness (0.25) + Compliance (0.10) = 0.35 total present weight
    // redistributed: Tenderness = 0.25/0.35 ≈ 0.714, Compliance = 0.10/0.35 ≈ 0.286
    // score = 1.0*0.714*100 + 1.0*0.286*100 = 100 → clamped 100 → Grade S
    expect(res.result.grade).toBe('S')
    expect(res.result.composite_score).toBe(100)
    expect(res.result.missing_fields).toContain('Fat-Marbling-Index')
    expect(res.result.missing_fields).toContain('Sensory-Receptivity')
    expect(res.result.missing_fields).toContain('Cortisol-Level')
    // redistributed weights on the two present fields must sum to ~1.0
    const weightSum = res.result.breakdown.reduce((s: number, b: any) => s + b.weight, 0)
    expect(weightSum).toBeCloseTo(1.0, 1)
  })

  it('scans more than 4 numeric fields (regression for truncation bug)', async () => {
    // Previously capped at 4 — verify all 8 fields are picked up
    await seedKV('character:rich', [
      '**Tenderness-Index:** 0.90',
      '**Fat-Marbling-Index:** 0.85',
      '**Sensory-Receptivity:** 0.80',
      '**Weight-2:** 0.75',
      '**Compliance-Potential:** 0.70',
      '**Cortisol-Level:** 0.10',
      '**Resilience:** 0.60',
      '**Acceptance:** 0.65',
    ].join('\n'))
    const res = await callTool('analyze_utility', { entity_id: 'character:rich', utility_vector: 'GASTRIC' })
    // All 6 GASTRIC fields present — no missing, no redistribution
    expect(res.result.missing_fields).toEqual([])
    expect(res.result.fields_analyzed).toHaveLength(6)
  })

  it('parses bulleted parenthetical format: - **Weight-2 (Prey Vulnerability):** 0.75', async () => {
    await seedKV('character:bullet-fmt', [
      '- **Tenderness-Index:** 0.80',
      '- **Fat-Marbling-Index:** 0.80',
      '- **Sensory-Receptivity:** 0.80',
      '- **Weight-2 (Prey Vulnerability):** 0.80',
      '- **Compliance-Potential:** 0.80',
      '- **Cortisol-Level:** 0.20',
    ].join('\n'))
    const res = await callTool('analyze_utility', { entity_id: 'character:bullet-fmt', utility_vector: 'GASTRIC' })
    expect(res.result.missing_fields).toEqual([])
    expect(res.result.fields_analyzed).toHaveLength(6)
  })

  it('grade boundaries: S=90+, A=75-89, B=55-74, C=35-54, D=15-34, F=0-14', async () => {
    // Force exact scores by using THRALL with only compliance-potential present (weight=1.0 after redistribution)
    const cases: Array<[number, string]> = [
      [0.95, 'S'],  // 95 → S
      [0.80, 'A'],  // 80 → A
      [0.65, 'B'],  // 65 → B
      [0.45, 'C'],  // 45 → C
      [0.25, 'D'],  // 25 → D
      [0.05, 'F'],  // 5 → F
    ]
    for (const [val, expected] of cases) {
      const key = `character:grade-${expected.toLowerCase()}`
      await seedKV(key, `**Compliance-Potential:** ${val}`)
      const res = await callTool('analyze_utility', { entity_id: key, utility_vector: 'THRALL' })
      expect(res.result.grade).toBe(expected)
    }
  })

  it('all 7 vectors are accepted and produce distinct projected_yield narratives', async () => {
    await seedKV('character:all-vectors', [
      '**Tenderness-Index:** 0.70',
      '**Fat-Marbling-Index:** 0.70',
      '**Sensory-Receptivity:** 0.70',
      '**Weight-2:** 0.70',
      '**Compliance-Potential:** 0.70',
      '**Cortisol-Level:** 0.30',
      '**Caloric-Yield-Estimate:** 0.70',
    ].join('\n'))
    const vectors = ['GASTRIC', 'BUTCHERY', 'INCUBATION', 'SCULPTURE', 'PARASITISM', 'THRALL', 'DISTRIBUTED'] as const
    const results = await Promise.all(
      vectors.map(v => callTool('analyze_utility', { entity_id: 'character:all-vectors', utility_vector: v }))
    )
    for (const r of results) expect(r.error).toBeUndefined()
    const yields = results.map(r => r.result.projected_yield)
    const unique = new Set(yields)
    expect(unique.size).toBe(7)
  })

  it('entity_role actor uses actor field table (Weight-1, Aggression, Hunger)', async () => {
    await seedKV('character:predator', [
      '**Weight-1 (Predator Drive):** 0.90',
      '**Aggression:** 0.85',
      '**Hunger:** 0.80',
      '**Patience:** 0.70',
    ].join('\n'))
    const res = await callTool('analyze_utility', { entity_id: 'character:predator', utility_vector: 'GASTRIC', entity_role: 'actor' })
    expect(res.result.entity_role).toBe('actor')
    expect(res.result.fields_analyzed.some((f: string) => /Weight-1/i.test(f))).toBe(true)
    // subject fields like Tenderness-Index should not appear in actor breakdown
    expect(res.result.fields_analyzed.some((f: string) => /Tenderness/i.test(f))).toBe(false)
    expect(res.result.projected_yield).toContain('Actor capability')
  })

  it('breakdown entries have required structure', async () => {
    await seedKV('character:struct-check', [
      '**Tenderness-Index:** 0.70',
      '**Fat-Marbling-Index:** 0.65',
    ].join('\n'))
    const res = await callTool('analyze_utility', { entity_id: 'character:struct-check', utility_vector: 'GASTRIC' })
    expect(res.result.breakdown.length).toBeGreaterThan(0)
    for (const entry of res.result.breakdown) {
      expect(entry).toHaveProperty('field')
      expect(entry).toHaveProperty('raw_value')
      expect(entry).toHaveProperty('weight')
      expect(entry).toHaveProperty('effective_value')
      expect(entry).toHaveProperty('contribution')
      expect(typeof entry.contribution).toBe('number')
    }
  })

  it('composite_score is clamped to [0, 100] even when normalized caloric value exceeds 200,000', async () => {
    // 400,000 kcal / 200,000 = 2.0, clamped to 1.0 → contribution = 100 → score = 100
    await seedKV('character:overflow', '**Caloric-Yield-Estimate:** 400000')
    const res = await callTool('analyze_utility', { entity_id: 'character:overflow', utility_vector: 'DISTRIBUTED' })
    expect(res.result.composite_score).toBe(100)
  })

  it('parses comma-formatted Caloric-Yield-Estimate (135,000 kcal) and normalizes by 200,000', async () => {
    // 135,000 / 200,000 = 0.675; only caloric field present for DISTRIBUTED → weight redistributes to 1.0
    // contribution = 0.675 * 1.0 * 100 = 67.5 → round = 68; Grade B (55-74)
    await seedKV('character:caloric-comma', '**Caloric-Yield-Estimate:** 135,000 kcal')
    const res = await callTool('analyze_utility', { entity_id: 'character:caloric-comma', utility_vector: 'DISTRIBUTED' })
    expect(res.result.composite_score).toBe(68)
    expect(res.result.grade).toBe('B')
    const caloricEntry = res.result.breakdown.find((b: any) => /caloric/i.test(b.field))
    expect(caloricEntry.raw_value).toBe(135000)
    expect(caloricEntry.effective_value).toBeCloseTo(0.675, 2)
  })

  it('DISTRIBUTED: missing caloric-yield-estimate redistributes weight to remaining fields', async () => {
    // caloric-yield-estimate absent (weight 0.40) — remaining 4 fields present
    // present weights: 0.25 + 0.15 + 0.10 + 0.10 = 0.60
    // with all values at 0.80 and cortisol at 0.20 (inverted → 0.80), score redistributes to 100*0.60 ≈ 80
    await seedKV('character:dist-partial', [
      '**Fat-Marbling-Index:** 0.80',
      '**Tenderness-Index:** 0.80',
      '**Cortisol-Level:** 0.20',
      '**Weight-2:** 0.80',
    ].join('\n'))
    const res = await callTool('analyze_utility', { entity_id: 'character:dist-partial', utility_vector: 'DISTRIBUTED' })
    expect(res.result.missing_fields).toContain('Caloric-Yield-Estimate')
    expect(res.result.composite_score).toBe(80)
  })
})

// ── map_integration ───────────────────────────────────────────────────────────

describe('map_integration', () => {
  it('returns error when source not found', async () => {
    await seedKV('character:target-only', 'Target lore.')
    const res = await callTool('map_integration', {
      source_id: 'nonexistent:source',
      target_id: 'character:target-only',
      integration_depth: 0.5,
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.message).toContain('nonexistent:source')
  })

  it('returns error when target not found', async () => {
    await seedKV('character:source-only', 'Source lore. [Transferable]')
    const res = await callTool('map_integration', {
      source_id: 'character:source-only',
      target_id: 'nonexistent:target',
      integration_depth: 0.5,
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('returns empty updated_traits when source has no [Transferable] lines', async () => {
    await seedKV('character:plain-source', 'No transferable traits here.')
    await seedKV('character:plain-target', 'Target entry.')
    const res = await callTool('map_integration', {
      source_id: 'character:plain-source',
      target_id: 'character:plain-target',
      integration_depth: 1.0,
    })
    expect(res.result.updated_traits).toHaveLength(0)
    expect(res.result.content[0].text).toContain('No [Transferable]')
  })

  it('returns 0 traits when integration_depth is 0', async () => {
    await seedKV('character:depth-zero-src', 'Trait A [Transferable]\nTrait B [Transferable]')
    await seedKV('character:depth-zero-tgt', 'Target.')
    const res = await callTool('map_integration', {
      source_id: 'character:depth-zero-src',
      target_id: 'character:depth-zero-tgt',
      integration_depth: 0,
    })
    expect(res.result.updated_traits).toHaveLength(0)
  })

  it('transfers all traits at depth=1.0', async () => {
    await seedKV('character:full-src', 'Trait A [Transferable]\nTrait B [Transferable]\nTrait C [Transferable]')
    await seedKV('character:full-tgt', 'Target lore.')
    const res = await callTool('map_integration', {
      source_id: 'character:full-src',
      target_id: 'character:full-tgt',
      integration_depth: 1.0,
    })
    expect(res.result.updated_traits).toHaveLength(3)
    expect(res.result.metadata.transferred_count).toBe(3)
    expect(res.result.metadata.total_transferable).toBe(3)
  })

  it('floors the trait count at partial depth', async () => {
    // 3 traits × depth 0.6 = floor(1.8) = 1
    await seedKV('character:partial-src', 'Trait A [Transferable]\nTrait B [Transferable]\nTrait C [Transferable]')
    await seedKV('character:partial-tgt', 'Target.')
    const res = await callTool('map_integration', {
      source_id: 'character:partial-src',
      target_id: 'character:partial-tgt',
      integration_depth: 0.6,
    })
    expect(res.result.updated_traits).toHaveLength(1)
  })

  it('writes transferred traits into target lore', async () => {
    await seedKV('character:write-src', 'Unique-Trait-XYZ [Transferable]')
    await seedKV('character:write-tgt', 'Base target.')
    await callTool('map_integration', {
      source_id: 'character:write-src',
      target_id: 'character:write-tgt',
      integration_depth: 1.0,
    })
    const get = await callTool('get_lore', { query: 'character:write-tgt' })
    expect(get.result.text).toContain('Unique-Trait-XYZ')
    expect(get.result.text).toContain('Integrated-From')
  })

  it('pushes history for the target before writing', async () => {
    await seedKV('character:hist-src', 'Trait [Transferable]')
    await seedKV('character:hist-tgt', 'Original target text.')
    await callTool('map_integration', {
      source_id: 'character:hist-src',
      target_id: 'character:hist-tgt',
      integration_depth: 1.0,
    })
    const restore = await callTool('restore_lore', { key: 'character:hist-tgt' })
    expect(restore.result.metadata.restored).toBe(true)
    const get = await callTool('get_lore', { query: 'character:hist-tgt' })
    expect(get.result.text).toBe('Original target text.')
  })

  it('also matches **Transferable-* prefixed fields', async () => {
    await seedKV('character:prefixed-src', '**Transferable-Skill:** combat mastery\n**Non-Transferable:** secret')
    await seedKV('character:prefixed-tgt', 'Target.')
    const res = await callTool('map_integration', {
      source_id: 'character:prefixed-src',
      target_id: 'character:prefixed-tgt',
      integration_depth: 1.0,
    })
    expect(res.result.updated_traits).toHaveLength(1)
    expect(res.result.updated_traits[0]).toContain('Transferable-Skill')
  })
})

// ── thread_tick ───────────────────────────────────────────────────────────────

describe('thread_tick', () => {
  it('returns no-entities message when no entities match the thread', async () => {
    await seedKV('character:unthreaded', '**Status:** Active\n**Timeline-Value:** 5')
    const res = await callTool('thread_tick', { thread_id: 'thread-alpha' })
    expect(res.result.content[0].text).toContain('No entities')
    expect(res.result.local_shifts).toHaveLength(0)
  })

  it('decrements Timeline-Value for all entities in the thread', async () => {
    await seedKV('character:thread-member', '**Thread:** thread-alpha\n**Timeline-Value:** 8')
    await callTool('thread_tick', { thread_id: 'thread-alpha' })
    const get = await callTool('get_lore', { query: 'character:thread-member' })
    expect(get.result.text).toContain('**Timeline-Value:** 7')
  })

  it('reports old_value and new_value in local_shifts', async () => {
    await seedKV('character:shift-check', '**Thread:** shift-thread\n**Timeline-Value:** 4')
    const res = await callTool('thread_tick', { thread_id: 'shift-thread' })
    expect(res.result.local_shifts).toHaveLength(1)
    expect(res.result.local_shifts[0].old_value).toBe(4)
    expect(res.result.local_shifts[0].new_value).toBe(3)
    expect(res.result.local_shifts[0].key).toBe('character:shift-check')
  })

  it('marks status_change=true when Timeline-Value crosses zero', async () => {
    await seedKV('character:crossing-zero', '**Thread:** cross-thread\n**Timeline-Value:** 1')
    const res = await callTool('thread_tick', { thread_id: 'cross-thread' })
    expect(res.result.local_shifts[0].status_change).toBe(true)
  })

  it('marks status_change=false when Timeline-Value stays positive', async () => {
    await seedKV('character:stays-positive', '**Thread:** positive-thread\n**Timeline-Value:** 5')
    const res = await callTool('thread_tick', { thread_id: 'positive-thread' })
    expect(res.result.local_shifts[0].status_change).toBe(false)
  })

  it('ticks multiple entities in the same thread', async () => {
    await seedKV('character:multi-a', '**Thread:** multi-thread\n**Timeline-Value:** 10')
    await seedKV('character:multi-b', '**Thread:** multi-thread\n**Timeline-Value:** 3')
    const res = await callTool('thread_tick', { thread_id: 'multi-thread' })
    expect(res.result.local_shifts).toHaveLength(2)
    expect(res.result.metadata.entities_ticked).toBe(2)
  })

  it('does not decrement entities on other threads', async () => {
    await seedKV('character:thread-a-member', '**Thread:** thread-a\n**Timeline-Value:** 5')
    await seedKV('character:thread-b-member', '**Thread:** thread-b\n**Timeline-Value:** 5')
    await callTool('thread_tick', { thread_id: 'thread-a' })
    const get = await callTool('get_lore', { query: 'character:thread-b-member' })
    expect(get.result.text).toContain('**Timeline-Value:** 5')
  })

  it('skips entities in thread that lack a Timeline-Value field', async () => {
    await seedKV('character:no-timeline', '**Thread:** skip-thread\n**Status:** Active')
    const res = await callTool('thread_tick', { thread_id: 'skip-thread' })
    expect(res.result.local_shifts).toHaveLength(0)
    expect(res.result.content[0].text).toContain('No entities')
  })

  it('pushes history for decremented entities', async () => {
    await seedKV('character:tick-hist', '**Thread:** hist-thread\n**Timeline-Value:** 3')
    await callTool('thread_tick', { thread_id: 'hist-thread' })
    const restore = await callTool('restore_lore', { key: 'character:tick-hist' })
    expect(restore.result.metadata.restored).toBe(true)
    const get = await callTool('get_lore', { query: 'character:tick-hist' })
    expect(get.result.text).toContain('**Timeline-Value:** 3')
  })

  it('populates global_snapshot with other-thread entities sharing Current-Date', async () => {
    await seedKV('character:tick-source', '**Thread:** date-thread-a\n**Timeline-Value:** 2\n**Current-Date:** 2026-05-24')
    await seedKV('character:other-thread', '**Thread:** date-thread-b\n**Current-Date:** 2026-05-24\n**Status:** Waiting')
    const res = await callTool('thread_tick', { thread_id: 'date-thread-a' })
    expect(res.result.global_snapshot).toHaveLength(1)
    expect(res.result.global_snapshot[0].key).toBe('character:other-thread')
    expect(res.result.global_snapshot[0].thread).toBe('date-thread-b')
    expect(res.result.global_snapshot[0].status).toBe('Waiting')
  })

  it('global_snapshot is empty when no shared Current-Date exists', async () => {
    await seedKV('character:isolated-tick', '**Thread:** isolated-thread\n**Timeline-Value:** 1\n**Current-Date:** 2099-01-01')
    await seedKV('character:different-date', '**Thread:** other-thread\n**Current-Date:** 2026-05-24')
    const res = await callTool('thread_tick', { thread_id: 'isolated-thread' })
    expect(res.result.global_snapshot).toHaveLength(0)
  })
})

// ── Legacy bare-method handlers ───────────────────────────────────────────────

describe('legacy bare methods (pre-tools/call)', () => {
  it('list_topics direct method returns keys array', async () => {
    await seedKV('legacy:item1', 'text1')
    const res = await rpc('list_topics')
    expect(res.result.keys).toContain('legacy:item1')
  })

  it('get_lore direct method retrieves by key param', async () => {
    await seedKV('legacy:thing', 'Legacy content')
    const res = await rpc('get_lore', { key: 'legacy:thing' })
    expect(res.result.text).toBe('Legacy content')
  })
})

// ── get_relationship ──────────────────────────────────────────────────────────

describe('get_relationship', () => {
  it('finds affinity field and cross-references', async () => {
    await seedKV('character:alice', '**Affinity:** 0.8\n**Faction:** guild\nBob is a trusted ally.')
    await seedKV('character:bob', '**Faction:** guild\nAlice mentored me.')
    const res = await callTool('get_relationship', { entity_a: 'character:alice', entity_b: 'character:bob' })
    expect(res.result.relationship).not.toBeNull()
    expect(res.result.relationship.affinity).toBe(0.8)
    expect(res.result.relationship.faction_overlap).toContain('guild')
    expect(res.result.relationship.cross_references.a_mentions_b).toBe(true)
    expect(res.result.relationship.cross_references.b_mentions_a).toBe(true)
    expect(res.result.metadata.retrieved).toBe(2)
  })

  it('returns null relationship and suggestion when no data found', async () => {
    await seedKV('character:stranger-a', 'No connections here.')
    await seedKV('character:stranger-b', 'Likewise.')
    const res = await callTool('get_relationship', { entity_a: 'character:stranger-a', entity_b: 'character:stranger-b' })
    expect(res.result.relationship).toBeNull()
    expect(res.result.suggestion).toContain('relationship:')
  })

  it('returns error for missing entity', async () => {
    await seedKV('character:exists', 'text')
    const res = await callTool('get_relationship', { entity_a: 'character:exists', entity_b: 'character:no-such' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

// ── get_faction_standing ──────────────────────────────────────────────────────

describe('get_faction_standing', () => {
  it('detects membership when entity name appears in faction text', async () => {
    await seedKV('character:knight', '**Rank:** Captain\n**Reputation:** 0.9\n**Faction:** order')
    await seedKV('faction:order', 'Members: knight, paladin, squire.')
    const res = await callTool('get_faction_standing', { entity_key: 'character:knight', faction_key: 'faction:order' })
    expect(res.result.standing.is_member).toBe(true)
    expect(res.result.standing.rank).toBe('Captain')
    expect(res.result.standing.reputation).toBe(0.9)
  })

  it('returns non-member when entity not in faction text', async () => {
    await seedKV('character:outsider', '**Faction:** rival-guild')
    await seedKV('faction:order', 'Members: knight only.')
    const res = await callTool('get_faction_standing', { entity_key: 'character:outsider', faction_key: 'faction:order' })
    expect(res.result.standing.is_member).toBe(false)
  })

  it('returns error for missing faction', async () => {
    await seedKV('character:x', 'text')
    const res = await callTool('get_faction_standing', { entity_key: 'character:x', faction_key: 'faction:missing' })
    expect(res.error).toBeDefined()
  })
})

// ── get_entity_knowledge ──────────────────────────────────────────────────────

describe('get_entity_knowledge', () => {
  it('returns known=true and excerpts when topic appears in text', async () => {
    await seedKV('character:spy', '**Knows:** secret-vault, patrol-routes\nI discovered the secret-vault last week.')
    const res = await callTool('get_entity_knowledge', { entity_key: 'character:spy', topic: 'secret-vault' })
    expect(res.result.known).toBe(true)
    expect(res.result.known_via_field).toBe(true)
    expect(res.result.excerpts.length).toBeGreaterThan(0)
  })

  it('returns known=false when topic is absent', async () => {
    await seedKV('character:naive', 'No special knowledge here.')
    const res = await callTool('get_entity_knowledge', { entity_key: 'character:naive', topic: 'hidden-base' })
    expect(res.result.known).toBe(false)
    expect(res.result.excerpts).toHaveLength(0)
  })
})

// ── get_location_occupants ────────────────────────────────────────────────────

describe('get_location_occupants', () => {
  it('returns entities whose Location field matches', async () => {
    await seedKV('character:guard-1', '**Location:** location:barracks\n**Status:** Active')
    await seedKV('character:guard-2', '**Location:** location:barracks\n**Status:** Sleeping')
    await seedKV('character:merchant', '**Location:** location:market')
    const res = await callTool('get_location_occupants', { location_key: 'location:barracks' })
    expect(res.result.occupants).toHaveLength(2)
    const keys = res.result.occupants.map((o: { key: string }) => o.key)
    expect(keys).toContain('character:guard-1')
    expect(keys).toContain('character:guard-2')
  })

  it('returns empty array when no matches', async () => {
    const res = await callTool('get_location_occupants', { location_key: 'location:empty-room' })
    expect(res.result.occupants).toHaveLength(0)
    expect(res.result.content[0].text).toContain('No occupants')
  })

  it('finds entities with loose plain-colon Location field', async () => {
    // AI may write "Location: chamber-x" without **bold:** — loose pass should find them
    await seedKV('character:loose-loc-1', 'Location: location:loose-chamber\nStatus: Active')
    await seedKV('character:loose-loc-2', 'Location: location:loose-chamber\nStatus: Dormant')
    const res = await callTool('get_location_occupants', { location_key: 'location:loose-chamber' })
    expect(res.result.occupants).toHaveLength(2)
  })
})

// ── get_reachable_locations ───────────────────────────────────────────────────

describe('get_reachable_locations', () => {
  it('parses Exits field and checks each destination', async () => {
    await seedKV('location:hub', '**Exits:** location:north-road, location:cave')
    await seedKV('location:north-road', '**Danger-Level:** 0.2\n**Travel-Cost:** 30')
    const res = await callTool('get_reachable_locations', { origin_key: 'location:hub' })
    expect(res.result.locations).toHaveLength(2)
    const northRoad = res.result.locations.find((l: { key: string }) => l.key === 'location:north-road')
    expect(northRoad.exists).toBe(true)
    expect(northRoad.danger_level).toBe(0.2)
    expect(northRoad.travel_cost).toBe(30)
    const cave = res.result.locations.find((l: { key: string }) => l.key === 'location:cave')
    expect(cave.exists).toBe(false)
  })

  it('returns empty locations when no Exits field', async () => {
    await seedKV('location:dead-end', 'No way out.')
    const res = await callTool('get_reachable_locations', { origin_key: 'location:dead-end' })
    expect(res.result.locations).toHaveLength(0)
  })

  it('returns error for missing origin', async () => {
    const res = await callTool('get_reachable_locations', { origin_key: 'location:nonexistent' })
    expect(res.error).toBeDefined()
  })
})

// ── sense_environment ─────────────────────────────────────────────────────────

describe('sense_environment', () => {
  it('shows all details for high-perception entity', async () => {
    await seedKV('location:cave', 'Stalactites hang overhead.\nA shimmer in the dark [hidden] marks a gem deposit.\nA growl echoes [threat] from the east.')
    await seedKV('character:eagle-eye', '**Perception:** 0.9')
    const res = await callTool('sense_environment', { location_key: 'location:cave', entity_key: 'character:eagle-eye' })
    expect(res.result.perception_score).toBe(0.9)
    expect(res.result.hidden_count).toBe(0)
  })

  it('hides [hidden] lines for low-perception entity', async () => {
    await seedKV('location:cave', 'A shimmer in the dark [hidden] marks a gem deposit.\nStone walls surround you.')
    await seedKV('character:blind-fighter', '**Perception:** 0.3')
    const res = await callTool('sense_environment', { location_key: 'location:cave', entity_key: 'character:blind-fighter' })
    expect(res.result.hidden_count).toBeGreaterThan(0)
  })
})

// ── get_inventory ─────────────────────────────────────────────────────────────

describe('get_inventory', () => {
  it('parses Inventory field into structured items', async () => {
    await seedKV('character:merchant', '**Inventory:** sword×3, shield×1, potion×10')
    const res = await callTool('get_inventory', { entity_key: 'character:merchant' })
    expect(res.result.items).toHaveLength(3)
    const sword = res.result.items.find((i: { item: string }) => i.item === 'sword')
    expect(sword.quantity).toBe(3)
  })

  it('returns empty items when no Inventory field', async () => {
    await seedKV('character:empty-handed', 'No items here.')
    const res = await callTool('get_inventory', { entity_key: 'character:empty-handed' })
    expect(res.result.items).toHaveLength(0)
    expect(res.result.raw_inventory).toBeNull()
  })
})

// ── transfer_item ─────────────────────────────────────────────────────────────

describe('transfer_item', () => {
  it('moves item from source to target and updates both entries', async () => {
    await seedKV('character:seller', '**Inventory:** sword×2, shield×1')
    await seedKV('character:buyer', '**Inventory:** gold×50')
    const res = await callTool('transfer_item', { from_entity: 'character:seller', to_entity: 'character:buyer', item_key: 'sword', quantity: 1 })
    expect(res.result.transferred).toBe(true)
    expect(res.result.metadata.written).toBe(2)
    const seller = await callTool('get_inventory', { entity_key: 'character:seller' })
    const sellerSword = seller.result.items.find((i: { item: string }) => i.item === 'sword')
    expect(sellerSword.quantity).toBe(1)
    const buyer = await callTool('get_inventory', { entity_key: 'character:buyer' })
    const buyerSword = buyer.result.items.find((i: { item: string }) => i.item === 'sword')
    expect(buyerSword.quantity).toBe(1)
  })

  it('rejects when source does not have the item', async () => {
    await seedKV('character:empty', '**Inventory:** gold×5')
    await seedKV('character:target', '**Inventory:** gold×1')
    const res = await callTool('transfer_item', { from_entity: 'character:empty', to_entity: 'character:target', item_key: 'magic-sword', quantity: 1 })
    expect(res.result.transferred).toBe(false)
    expect(res.result.content[0].text).toContain('not found')
  })

  it('rejects when insufficient quantity', async () => {
    await seedKV('character:has-one', '**Inventory:** potion×1')
    await seedKV('character:wants-more', '**Inventory:** gold×5')
    const res = await callTool('transfer_item', { from_entity: 'character:has-one', to_entity: 'character:wants-more', item_key: 'potion', quantity: 5 })
    expect(res.result.transferred).toBe(false)
    expect(res.result.content[0].text).toContain('Insufficient')
  })
})

// ── activate_scene ────────────────────────────────────────────────────────────

describe('activate_scene', () => {
  it('activates scene and writes system:active-scene', async () => {
    await seedKV('scene:intro', '**Description:** A dark tavern.\n**Entities:** character:innkeeper\n**Location:** location:tavern\n**Choices:** greet,leave')
    await seedKV('character:innkeeper', 'The innkeeper polishes a glass.')
    await seedKV('location:tavern', 'A low-ceilinged room.')
    const res = await callTool('activate_scene', { scene_key: 'scene:intro' })
    expect(res.result.scene_key).toBe('scene:intro')
    expect(res.result.present_entities).toContain('character:innkeeper')
    expect(res.result.available_choices).toContain('greet')
    expect(res.result.entity_data['character:innkeeper']).toBeTruthy()
    expect(res.result.metadata.written).toBe(1)
  })

  it('returns error for missing scene', async () => {
    const res = await callTool('activate_scene', { scene_key: 'scene:no-such' })
    expect(res.error).toBeDefined()
  })
})

// ── present_choices ───────────────────────────────────────────────────────────

describe('present_choices', () => {
  it('returns valid choices that meet requirements', async () => {
    await seedKV('scene:dungeon', '**Description:** A door ahead.\n- enter: Walk through the door\n- lockpick: Pick the lock [requires: lockpick]\n- smash: Smash the door [min-weight: 0.8]')
    await seedKV('character:rogue', '**Inventory:** lockpick×1\n**Weight-1:** 0.5')
    const res = await callTool('present_choices', { scene_key: 'scene:dungeon', entity_key: 'character:rogue' })
    const validIds = res.result.valid_choices.map((c: { id: string }) => c.id)
    expect(validIds).toContain('enter')
    expect(validIds).toContain('lockpick')
    const blockedIds = res.result.blocked_choices.map((c: { id: string }) => c.id)
    expect(blockedIds).toContain('smash')
  })

  it('blocks choices requiring missing item', async () => {
    await seedKV('scene:chest', '- open: Open the chest [requires: key]')
    await seedKV('character:no-key', '**Inventory:** rope×1')
    const res = await callTool('present_choices', { scene_key: 'scene:chest', entity_key: 'character:no-key' })
    expect(res.result.valid_choices).toHaveLength(0)
    expect(res.result.blocked_choices[0].blocked_reason).toContain('key')
  })
})

// ── commit_choice ─────────────────────────────────────────────────────────────

describe('commit_choice', () => {
  it('applies state change and appends to Choice-History', async () => {
    await seedKV('choice:accept-quest', '**Outcome-Seed:** The hero begins the journey.\n**State-Change:** Questing\n**Next-Choices:** choice:find-clue, choice:rest')
    await seedKV('character:hero', '**Status:** Idle\n**Choice-History:**')
    const res = await callTool('commit_choice', { choice_id: 'choice:accept-quest', entity_key: 'character:hero' })
    expect(res.result.outcome_seed).toContain('journey')
    expect(res.result.state_change).toBe('Questing')
    expect(res.result.next_choices).toContain('choice:find-clue')
    const hero = await callTool('get_lore', { query: 'character:hero' })
    expect(hero.result.text).toContain('Questing')
    expect(hero.result.text).toContain('choice:accept-quest')
  })

  it('returns error for missing choice entry', async () => {
    await seedKV('character:player', 'A player.')
    const res = await callTool('commit_choice', { choice_id: 'choice:no-such', entity_key: 'character:player' })
    expect(res.error).toBeDefined()
  })
})

// ── get_choice_history ────────────────────────────────────────────────────────

describe('get_choice_history', () => {
  it('parses Choice-History into structured entries', async () => {
    await seedKV('character:veteran', '**Choice-History:** choice:join-guild@2024-01-01T00:00:00.000Z, choice:betray-ally@2024-06-01T00:00:00.000Z')
    const res = await callTool('get_choice_history', { entity_key: 'character:veteran' })
    expect(res.result.history).toHaveLength(2)
    expect(res.result.history[0].choice_id).toBe('choice:join-guild')
    expect(res.result.history[0].timestamp).toBeTruthy()
  })

  it('returns empty history for entity with no Choice-History field', async () => {
    await seedKV('character:fresh', 'No choices yet.')
    const res = await callTool('get_choice_history', { entity_key: 'character:fresh' })
    expect(res.result.history).toHaveLength(0)
    expect(res.result.raw_history).toBeNull()
  })
})

// ── advance_state_stage ───────────────────────────────────────────────────────

describe('advance_state_stage', () => {
  it('increments State-Stage and writes back', async () => {
    await seedKV('character:caterpillar', '**State-Stage:** 1\n**State-Total:** 4\n**Stage-Timer:** 3')
    const res = await callTool('advance_state_stage', { entity_key: 'character:caterpillar' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.old_stage).toBe(1)
    expect(res.result.new_stage).toBe(2)
    expect(res.result.is_terminal).toBe(false)
    const lore = await callTool('get_lore', { query: 'character:caterpillar' })
    expect(lore.result.text).toContain('**State-Stage:** 2')
    expect(lore.result.text).toContain('**Stage-Timer:** 2')
  })

  it('detects terminal stage', async () => {
    await seedKV('character:final', '**State-Stage:** 4\n**State-Total:** 4')
    const res = await callTool('advance_state_stage', { entity_key: 'character:final' })
    expect(res.result.advanced).toBe(false)
    expect(res.result.is_terminal).toBe(true)
  })

  it('returns not-advanced when no State-Stage field', async () => {
    await seedKV('character:no-stage', 'Just a character.')
    const res = await callTool('advance_state_stage', { entity_key: 'character:no-stage' })
    expect(res.result.advanced).toBe(false)
  })

  it('advances from loose plain-colon format (no bold markers)', async () => {
    // AI may write "State-Stage: 2" without **bold:** — loose pass should parse and write back
    await seedKV('character:loose-stage', 'State-Stage: 2\nState-Total: 4\nStage-Timer: 3')
    const res = await callTool('advance_state_stage', { entity_key: 'character:loose-stage' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.new_stage).toBe(3)
    const lore = await callTool('get_lore', { query: 'character:loose-stage' })
    expect(lore.result.text).toContain('3')
    expect(lore.result.text).toContain('Stage-Timer')
  })

  it('parses stage from embedded Stage-N-of-M narrative status and updates in-place', async () => {
    // "Status: Active, Stage-2-of-4" has no discrete State-Stage field — Pass 4 extracts it
    await seedKV('character:subject-alpha', 'Status: Active, Stage-2-of-4\nLocation: processing-chamber\nWeight-1: 0.30\nStage-Timer: 3')
    const res = await callTool('advance_state_stage', { entity_key: 'character:subject-alpha' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.old_stage).toBe(2)
    expect(res.result.new_stage).toBe(3)
    expect(res.result.total_stages).toBe(4)
    const lore = await callTool('get_lore', { query: 'character:subject-alpha' })
    // Stage number updated in-place within the status string
    expect(lore.result.text).toContain('Stage-3-of-4')
    expect(lore.result.text).not.toContain('Stage-2-of-4')
    // Stage-Timer decremented
    expect(lore.result.text).toContain('Stage-Timer: 2')
  })
})

// ── process_stage_batch ───────────────────────────────────────────────────────

describe('process_stage_batch', () => {
  it('advances all entities at the location with a State-Stage field', async () => {
    await seedKV('character:pupa-1', '**Location:** location:lab\n**State-Stage:** 1\n**State-Total:** 3')
    await seedKV('character:pupa-2', '**Location:** location:lab\n**State-Stage:** 2\n**State-Total:** 3')
    await seedKV('character:visitor', '**Location:** location:market\n**State-Stage:** 1')
    const res = await callTool('process_stage_batch', { location_key: 'location:lab' })
    expect(res.result.outcomes).toHaveLength(2)
    const pupa1 = res.result.outcomes.find((o: { key: string }) => o.key === 'character:pupa-1')
    expect(pupa1.new_stage).toBe(2)
  })

  it('skips entities without State-Stage', async () => {
    await seedKV('character:no-stage-loc', '**Location:** location:chamber')
    const res = await callTool('process_stage_batch', { location_key: 'location:chamber' })
    expect(res.result.outcomes).toHaveLength(0)
    expect(res.result.skipped).toHaveLength(1)
    expect(res.result.skipped[0].reason).toContain('State-Stage')
  })
})

// ── generate_entity ───────────────────────────────────────────────────────────

describe('generate_entity', () => {
  it('creates a new entity from an archetype', async () => {
    await seedKV('archetype:guard', '**Weight-1:** 0.7\n**Weight-2:** 0.4\n**Status:** Patrol')
    const res = await callTool('generate_entity', { archetype_key: 'archetype:guard' })
    expect(res.result.entity_key).toMatch(/^entity:guard-\d+$/)
    expect(res.result.entity_text).toContain('**Weight-1:** 0.7')
    expect(res.result.metadata.written).toBe(1)
    const lore = await callTool('get_lore', { query: res.result.entity_key })
    expect(lore.result).toBeDefined()
  })

  it('injects Location when location_key provided', async () => {
    await seedKV('archetype:wolf', '**Weight-1:** 0.6\n**Status:** Hunting')
    await seedKV('location:forest', '**Danger-Level:** 0.3')
    const res = await callTool('generate_entity', { archetype_key: 'archetype:wolf', location_key: 'location:forest' })
    expect(res.result.entity_text).toContain('location:forest')
  })

  it('returns error for missing archetype', async () => {
    const res = await callTool('generate_entity', { archetype_key: 'archetype:no-such' })
    expect(res.error).toBeDefined()
  })
})

// ── roll_encounter ────────────────────────────────────────────────────────────

describe('roll_encounter', () => {
  it('generates an entity from the encounter table', async () => {
    await seedKV('location:woods', '**Encounter-Table:** archetype:bandit:80, archetype:deer:20')
    await seedKV('archetype:bandit', '**Weight-1:** 0.8\n**Status:** Hostile')
    await seedKV('archetype:deer', '**Weight-1:** 0.1\n**Status:** Grazing')
    const res = await callTool('roll_encounter', { location_key: 'location:woods', threat_level: 5 })
    expect(res.result.rolled).toBe(true)
    expect(res.result.entity_key).toMatch(/^entity:/)
  })

  it('returns rolled=false when no Encounter-Table', async () => {
    await seedKV('location:empty-field', 'Grass and wind.')
    const res = await callTool('roll_encounter', { location_key: 'location:empty-field' })
    expect(res.result.rolled).toBe(false)
    expect(res.result.content[0].text).toContain('No Encounter-Table')
  })
})

// ── get_thread_comparison ─────────────────────────────────────────────────────

describe('get_thread_comparison', () => {
  it('compares entity counts and timeline offsets across two threads', async () => {
    await seedKV('character:alpha-1', '**Thread:** thread-a\n**Timeline-Value:** 10\n**Current-Date:** day-5')
    await seedKV('character:alpha-2', '**Thread:** thread-a\n**Timeline-Value:** 8\n**Current-Date:** day-5')
    await seedKV('character:beta-1', '**Thread:** thread-b\n**Timeline-Value:** 5\n**Current-Date:** day-5')
    const res = await callTool('get_thread_comparison', { thread_a: 'thread-a', thread_b: 'thread-b' })
    expect(res.result.thread_a.entity_count).toBe(2)
    expect(res.result.thread_b.entity_count).toBe(1)
    expect(res.result.timeline_offset).toBeCloseTo(4, 0)
    expect(res.result.shared_dates).toContain('day-5')
  })

  it('returns empty threads when no entities found', async () => {
    const res = await callTool('get_thread_comparison', { thread_a: 'no-thread-x', thread_b: 'no-thread-y' })
    expect(res.result.thread_a.entity_count).toBe(0)
    expect(res.result.thread_b.entity_count).toBe(0)
    expect(res.result.timeline_offset).toBeNull()
  })
})

// ── check_convergence ─────────────────────────────────────────────────────────

describe('check_convergence', () => {
  it('detects convergence via shared date', async () => {
    await seedKV('character:ga', '**Thread:** ta\n**Current-Date:** day-10')
    await seedKV('character:gb', '**Thread:** tb\n**Current-Date:** day-10')
    const res = await callTool('check_convergence', { thread_a: 'ta', thread_b: 'tb' })
    expect(res.result.can_converge).toBe(true)
    expect(res.result.shared_dates).toContain('day-10')
  })

  it('returns can_converge=false when no overlap', async () => {
    await seedKV('character:xa', '**Thread:** tx\n**Current-Date:** day-1')
    await seedKV('character:xb', '**Thread:** ty\n**Current-Date:** day-99')
    const res = await callTool('check_convergence', { thread_a: 'tx', thread_b: 'ty' })
    expect(res.result.can_converge).toBe(false)
    expect(res.result.shared_dates).toHaveLength(0)
    expect(res.result.shared_locations).toHaveLength(0)
  })
})

// ── get_sensory_profile ───────────────────────────────────────────────────────

describe('get_sensory_profile', () => {
  it('returns direct sensory fields from entity', async () => {
    await seedKV('character:creature', '**Temperature:** warm\n**Scent:** musky\n**Texture:** smooth\n**Sound-Signature:** low growl\n**Visual-Descriptors:** amber eyes')
    const res = await callTool('get_sensory_profile', { entity_key: 'character:creature' })
    expect(res.result.profile.temperature).toBe('warm')
    expect(res.result.profile.scent).toBe('musky')
    expect(res.result.profile.texture).toBe('smooth')
    expect(res.result.profile.sound_signature).toBe('low growl')
    expect(res.result.profile.visual_descriptors).toBe('amber eyes')
  })

  it('falls back to species lore for missing fields', async () => {
    await seedKV('character:hybrid', '**Species:** species:wolf-base\n**Texture:** scarred')
    await seedKV('species:wolf-base', '**Temperature:** cool\n**Scent:** earthy')
    const res = await callTool('get_sensory_profile', { entity_key: 'character:hybrid' })
    expect(res.result.profile.texture).toBe('scarred')
    expect(res.result.profile.temperature).toBe('cool')
    expect(res.result.profile.scent).toBe('earthy')
    expect(res.result.species).toBe('species:wolf-base')
  })

  it('returns no-profile message when entity has no sensory fields', async () => {
    await seedKV('character:blank', 'Just a blank character.')
    const res = await callTool('get_sensory_profile', { entity_key: 'character:blank' })
    expect(res.result.content[0].text).toContain('No sensory profile')
  })

  it('reads sensory fields from loose plain-colon format', async () => {
    // AI may omit **bold:** — loose pass should still find these fields
    await seedKV('character:loose-sensory', 'Sensory-Profile: warm-blooded, elevated cortisol\nTemperature: warm\nScent: cortisol-elevated')
    const res = await callTool('get_sensory_profile', { entity_key: 'character:loose-sensory' })
    expect(res.result.profile.temperature).toBe('warm')
    expect(res.result.profile.scent).toBe('cortisol-elevated')
  })

  it('decomposes Sensory-Profile composite string into individual profile fields', async () => {
    // Entity has only a composite Sensory-Profile — no discrete Temperature/Scent/etc. fields
    await seedKV('character:composite-sensory', '**Sensory-Profile:** warm-blooded, elevated cortisol, soft-tissue-density')
    const res = await callTool('get_sensory_profile', { entity_key: 'character:composite-sensory' })
    expect(res.result.sensory_profile_raw).toBe('warm-blooded, elevated cortisol, soft-tissue-density')
    expect(res.result.profile.temperature).toBe('warm-blooded')
    expect(res.result.profile.scent).toBe('elevated cortisol')
    expect(res.result.profile.texture).toBe('soft-tissue-density')
  })
})

// ── get_compatibility ─────────────────────────────────────────────────────────

describe('get_compatibility', () => {
  it('returns compatible=true for well-matched entities', async () => {
    await seedKV('character:predator-c', '**Weight-1:** 0.8\n**Size:** 3.0\n**Environment:** forest')
    await seedKV('character:prey-c', '**Weight-2:** 0.4\n**Size:** 1.0\n**Environment:** forest')
    const res = await callTool('get_compatibility', { entity_a: 'character:predator-c', entity_b: 'character:prey-c', interaction_type: 'hunt' })
    expect(res.result.compatible).toBe(true)
    expect(res.result.risk_level).toBe('low')
    expect(res.result.size_ratio).toBe(3)
  })

  it('flags incompatibility when Weight-1 is too low', async () => {
    await seedKV('character:weak-actor', '**Weight-1:** 0.1')
    await seedKV('character:target', '**Weight-2:** 0.5')
    const res = await callTool('get_compatibility', { entity_a: 'character:weak-actor', entity_b: 'character:target', interaction_type: 'consume' })
    expect(res.result.compatible).toBe(false)
    expect(res.result.constraints.some((c: string) => c.includes('Weight-1'))).toBe(true)
  })

  it('returns error for missing entity', async () => {
    await seedKV('character:exists-only', 'text')
    const res = await callTool('get_compatibility', { entity_a: 'character:exists-only', entity_b: 'character:ghost', interaction_type: 'test' })
    expect(res.error).toBeDefined()
  })
})

// ── Canonical IF state-engine test cases ──────────────────────────────────────
//
// These fixtures mirror the canonical entity formats used by the story AI:
// entity:/location:/scene:/faction: key prefixes, YAML-style nested field lists,
// integer-scale Weight-N fields (5–95), and embedded Stage-N-of-M status strings.
// Tests verify that tools parse these formats correctly.

describe('canonical fixture — entity:subject-alpha (active Stage-2-of-4)', () => {
  const ALPHA_LORE = [
    '# Entity: Subject Alpha',
    'Alias: Alpha',
    'Age: 24',
    'Gender: Female',
    'Status: Active, Stage-2-of-4',
    'Location: processing-chamber-primary',
    '',
    '## Weights',
    'Weight-1 (Drive): 30',
    'Weight-2 (Vulnerability): 55',
    '',
    '## Sensory Profile',
    'Temperature-Range: 36-38°C',
    'Scent-Profile: elevated-cortisol, salt, botanical-residue',
    'Texture-Profile: soft-tissue, minimal-callus, healed-scar-tissue-left-shoulder',
    'Sound-Signature: elevated-respiration, occasional-vocalization-distress',
    'Visual-Descriptors: lean-musculature, fair-integument, copper-cranial-filament',
    '',
    '## State Machine',
    'State-Machine: standard-multi-stage-processing',
    'Current-Stage: 2',
    'Total-Stages: 4',
    'Stage-Names: [preparation, engagement, processing, integration]',
    'Timeline-Value: 12',
    'Timeline-Unit: hours',
    'Thread: primary-processing-cycle',
    '',
    '## Inventory',
    'Inventory:',
    '- item: provision-pack-dried',
    '  quantity: 1',
    '  condition: partial',
    '- item: ornamental-blade',
    '  quantity: 1',
    '  condition: display-only',
    '- item: botanical-sachet',
    '  quantity: 2',
    '  condition: intact',
    '',
    '## Relationships',
    'Relationships:',
    '- target: entity:subject-beta',
    '  type: bonded-pair',
    '  affinity: 85',
    '  status: separated',
    '- target: faction:traveling-performers',
    '  type: member',
    '  rank: junior',
    '  standing: good',
    '',
    '## Skills',
    'Tracking: 0.2',
    'Negotiation: 0.4',
    'Physical-Resistance: 0.3',
    'Perception: 0.5',
  ].join('\n')

  beforeEach(() => seedKV('entity:subject-alpha', ALPHA_LORE))

  it('stores and retrieves full canonical lore verbatim', async () => {
    const res = await callTool('get_lore', { query: 'entity:subject-alpha' })
    expect(res.result.content[0].text).toBe(ALPHA_LORE)
  })

  it('advance_state_stage reads embedded Stage-2-of-4 in Status and advances to Stage-3-of-4', async () => {
    const res = await callTool('advance_state_stage', { entity_key: 'entity:subject-alpha' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.old_stage).toBe(2)
    expect(res.result.new_stage).toBe(3)
    expect(res.result.total_stages).toBe(4)
    expect(res.result.is_terminal).toBe(false)
    const lore = await callTool('get_lore', { query: 'entity:subject-alpha' })
    expect(lore.result.text).toContain('Stage-3-of-4')
    expect(lore.result.text).not.toContain('Stage-2-of-4')
  })

  it('resolve_interaction normalizes integer Weight-1:85/Weight-2:55 from ## Weights section', async () => {
    await seedKV('entity:actor-stub', [
      '## Weights',
      'Weight-1 (Drive): 85',
      'Weight-2 (Vulnerability): 10',
      'State-Level: 0',
    ].join('\n'))
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'entity:actor-stub',
      entity_b_id: 'entity:subject-alpha',
      action_type: 'process',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1_raw).toBe(85)
    expect(res.result.metadata.weight_2_raw).toBe(55)
    expect(res.result.metadata.weight_1).toBeCloseTo(0.85, 5)
    expect(res.result.metadata.weight_2).toBeCloseTo(0.55, 5)
    // P = 0.85 - 0.55*0.3 = 0.685
    expect(res.result.metadata.probability).toBeCloseTo(0.685, 3)
  })

  it('thread_tick finds entity:subject-alpha via Thread field in ## State Machine section', async () => {
    const res = await callTool('thread_tick', { thread_id: 'primary-processing-cycle' })
    expect(res.result.metadata.entities_ticked).toBe(1)
    const lore = await callTool('get_lore', { query: 'entity:subject-alpha' })
    expect(lore.result.text).toContain('Timeline-Value: 11')
  })

  it('get_sensory_profile reads Sound-Signature and Visual-Descriptors from canonical section', async () => {
    const res = await callTool('get_sensory_profile', { entity_key: 'entity:subject-alpha' })
    expect(res.error).toBeUndefined()
    expect(res.result.profile.sound_signature).toContain('elevated-respiration')
    expect(res.result.profile.visual_descriptors).toContain('lean-musculature')
  })

  it('search_lore finds entity:subject-alpha by stage string', async () => {
    const res = await callTool('search_lore', { query: 'Stage-2-of-4' })
    expect(res.result.metadata.match_count).toBeGreaterThan(0)
    const keys = res.result.results.map((r: { key: string }) => r.key)
    expect(keys).toContain('entity:subject-alpha')
  })
})

describe('canonical fixture — entity:actor-primary (predator/driver, Weight-1:85)', () => {
  const ACTOR_LORE = [
    '# Entity: Actor Primary',
    'Alias: The Director',
    'Age: Unknown',
    'Gender: Female',
    'Status: Active, Processing',
    'Location: processing-chamber-primary',
    '',
    '## Weights',
    'Weight-1 (Drive): 85',
    'Weight-2 (Vulnerability): 10',
    '',
    '## Sensory Profile',
    'Temperature-Range: 38-42°C',
    'Scent-Profile: metabolic-heat, copper, enzymatic-secretion',
    'Texture-Profile: dense-musculature, smooth-integument, thermal-radiance',
    'Sound-Signature: low-frequency-resonance, rhythmic-internal-movement',
    'Visual-Descriptors: significant-scale, bioluminescent-markings, predator-morphology',
    '',
    '## State Machine',
    'State-Machine: sustained-processing',
    'Current-Stage: 2',
    'Total-Stages: 3',
    'Stage-Names: [acquisition, processing, integration]',
    'Timeline-Value: 8',
    'Timeline-Unit: hours',
    'Thread: primary-processing-cycle',
    '',
    '## Faction',
    'Faction: processing-guild',
    'Rank: director',
    'Specialization: multi-stage-processing',
    '',
    '## Skills',
    'Processing-Efficiency: 0.9',
    'Sensory-Acuity: 0.85',
    'Output-Optimization: 0.8',
    'Patience: 0.3',
  ].join('\n')

  beforeEach(() => seedKV('entity:actor-primary', ACTOR_LORE))

  it('stores and retrieves full canonical lore verbatim', async () => {
    const res = await callTool('get_lore', { query: 'entity:actor-primary' })
    expect(res.result.content[0].text).toBe(ACTOR_LORE)
  })

  it('analyze_utility entity_role=actor uses Weight-1:85 (normalizes to 0.85)', async () => {
    const res = await callTool('analyze_utility', {
      entity_id: 'entity:actor-primary',
      utility_vector: 'GASTRIC',
      entity_role: 'actor',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.entity_role).toBe('actor')
    const w1Entry = res.result.breakdown.find((b: any) => /Weight-1/i.test(b.field))
    if (w1Entry) {
      expect(w1Entry.raw_value).toBe(85)
      expect(w1Entry.effective_value).toBeCloseTo(0.85, 2)
    }
  })

  it('thread_tick on primary-processing-cycle decrements actor Timeline-Value', async () => {
    const res = await callTool('thread_tick', { thread_id: 'primary-processing-cycle' })
    expect(res.result.metadata.entities_ticked).toBe(1)
    const lore = await callTool('get_lore', { query: 'entity:actor-primary' })
    expect(lore.result.text).toContain('Timeline-Value: 7')
  })

  it('thread_tick ticks both actor and subject when both share the same thread', async () => {
    await seedKV('entity:subject-alpha', [
      'Status: Active, Stage-2-of-4',
      'Thread: primary-processing-cycle',
      'Timeline-Value: 12',
    ].join('\n'))
    const res = await callTool('thread_tick', { thread_id: 'primary-processing-cycle' })
    expect(res.result.metadata.entities_ticked).toBe(2)
  })
})

describe('canonical fixture — entity:subject-beta (Stage-3-of-4, modified-consciousness)', () => {
  const BETA_LORE = [
    '# Entity: Subject Beta',
    'Alias: Beta',
    'Age: 26',
    'Gender: Female',
    'Status: Stage-3-of-4, Modified-Consciousness',
    'Location: processing-chamber-secondary',
    '',
    '## Weights',
    'Weight-1 (Drive): 10',
    'Weight-2 (Vulnerability): 75',
    '',
    '## State Machine',
    'State-Machine: standard-multi-stage-processing',
    'Current-Stage: 3',
    'Total-Stages: 4',
    'Stage-Names: [preparation, engagement, processing, integration]',
    'Timeline-Value: 48',
    'Timeline-Unit: hours',
    'Thread: secondary-processing-cycle',
    '',
    '## Relationships',
    'Relationships:',
    '- target: entity:subject-alpha',
    '  type: bonded-pair',
    '  affinity: 90',
    '  status: separated-unaware',
    '- target: entity:actor-primary',
    '  type: processor-subject',
    '  affinity: 70',
    '  status: bonded-processing',
  ].join('\n')

  beforeEach(() => seedKV('entity:subject-beta', BETA_LORE))

  it('stores and retrieves full canonical lore verbatim', async () => {
    const res = await callTool('get_lore', { query: 'entity:subject-beta' })
    expect(res.result.content[0].text).toBe(BETA_LORE)
  })

  it('advance_state_stage reads Stage-3-of-4 from Status and advances to Stage-4-of-4 (terminal)', async () => {
    const res = await callTool('advance_state_stage', { entity_key: 'entity:subject-beta' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.old_stage).toBe(3)
    expect(res.result.new_stage).toBe(4)
    expect(res.result.total_stages).toBe(4)
    expect(res.result.is_terminal).toBe(true)
    const lore = await callTool('get_lore', { query: 'entity:subject-beta' })
    expect(lore.result.text).toContain('Stage-4-of-4')
  })

  it('resolve_interaction: diminished Weight-1:10 yields very low probability (~0.04)', async () => {
    await seedKV('entity:passive-target', 'Weight-2: 20')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'entity:subject-beta',
      entity_b_id: 'entity:passive-target',
      action_type: 'resist',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1_raw).toBe(10)
    expect(res.result.metadata.weight_1).toBeCloseTo(0.10, 5)
    // P = 0.10 - 0.20*0.3 = 0.04
    expect(res.result.metadata.probability).toBeCloseTo(0.04, 3)
  })

  it('thread_tick on secondary-processing-cycle decrements subject-beta Timeline-Value', async () => {
    const res = await callTool('thread_tick', { thread_id: 'secondary-processing-cycle' })
    expect(res.result.metadata.entities_ticked).toBe(1)
    const lore = await callTool('get_lore', { query: 'entity:subject-beta' })
    expect(lore.result.text).toContain('Timeline-Value: 47')
  })
})

describe('canonical fixture — location:transit-hub-north (YAML exits + encounter table)', () => {
  const TRANSIT_HUB_LORE = [
    '# Location: Northern Transit Hub',
    'Type: threshold-zone',
    'Danger-Level: moderate',
    'Status: active',
    '',
    '## Exits',
    'Exits:',
    '- target: location:processing-chamber-primary',
    '  travel-cost: 2-hours',
    '  danger: high',
    '  requirement: tracking-skill-0.3',
    '- target: location:settlement-fringe',
    '  travel-cost: 30-minutes',
    '  danger: low',
    '  requirement: none',
    '- target: location:deep-forest',
    '  travel-cost: 4-hours',
    '  danger: very-high',
    '  requirement: tracking-skill-0.5',
    '',
    '## Environmental Properties',
    'Temperature: 22-28°C',
    'Humidity: high',
    'Light-Level: low',
    'Ambient-Scent: decay, damp-earth, fungal-spore',
    'Ambient-Sound: distant-movement, settling-earth, water-drip',
    '',
    '## Encounter Table',
    'Encounter-Table:',
    '- entity-type: scout-entity',
    '  weight: 40',
    '  threat-level: moderate',
    '  behavior: patrolling',
    '- entity-type: minor-entity',
    '  weight: 30',
    '  threat-level: low',
    '  behavior: fleeing',
    '- entity-type: rival-actor',
    '  weight: 20',
    '  threat-level: high',
    '  behavior: territorial',
    '- entity-type: neutral-traveler',
    '  weight: 10',
    '  threat-level: none',
    '  behavior: passing-through',
  ].join('\n')

  beforeEach(() => seedKV('location:transit-hub-north', TRANSIT_HUB_LORE))

  it('stores and retrieves full canonical lore verbatim', async () => {
    const res = await callTool('get_lore', { query: 'location:transit-hub-north' })
    expect(res.result.content[0].text).toBe(TRANSIT_HUB_LORE)
  })

  it('get_reachable_locations parses YAML-style Exits list and returns all three destinations', async () => {
    const res = await callTool('get_reachable_locations', { origin_key: 'location:transit-hub-north' })
    expect(res.error).toBeUndefined()
    expect(res.result.locations).toHaveLength(3)
    const keys = res.result.locations.map((l: { key: string }) => l.key)
    expect(keys).toContain('location:processing-chamber-primary')
    expect(keys).toContain('location:settlement-fringe')
    expect(keys).toContain('location:deep-forest')
  })

  it('search_lore finds location by encounter type keyword', async () => {
    const res = await callTool('search_lore', { query: 'scout-entity' })
    expect(res.result.metadata.match_count).toBeGreaterThan(0)
    const keys = res.result.results.map((r: { key: string }) => r.key)
    expect(keys).toContain('location:transit-hub-north')
  })
})

describe('canonical fixture — scene:threshold-discovery (YAML choice tree)', () => {
  const SCENE_LORE = [
    '# Scene: Threshold Discovery',
    'Thread: primary-processing-cycle',
    'Location: location:processing-chamber-primary',
    'Status: active',
    '',
    '## Scene State',
    'Active-Entity: entity:subject-alpha',
    'Environmental-Conditions: low-light, organic-decay-scent, distant-rhythmic-sound',
    'Time: night, approximately 11pm',
    '',
    '## Choices',
    'Choices:',
    '- id: investigate-sound',
    '  label: "Follow the rhythmic sound deeper into the chamber"',
    '  requirements: perception: 0.3',
    '',
    '- id: search-perimeter',
    '  label: "Search the chamber perimeter for tracks or traces"',
    '  requirements: tracking: 0.2',
    '',
    '- id: call-out',
    '  label: "Call out into the darkness"',
    '  requirements: none',
    '',
    '- id: retreat',
    '  label: "Withdraw and find another approach"',
    '  requirements: none',
    '',
    '## Scene Flags',
    'first-visit: true',
    'evidence-collected: false',
    'actor-alerted: false',
  ].join('\n')

  beforeEach(() => seedKV('scene:threshold-discovery', SCENE_LORE))

  it('stores and retrieves full canonical scene lore verbatim', async () => {
    const res = await callTool('get_lore', { query: 'scene:threshold-discovery' })
    expect(res.result.content[0].text).toBe(SCENE_LORE)
  })

  it('activate_scene loads scene and returns all four choice IDs', async () => {
    const res = await callTool('activate_scene', { scene_key: 'scene:threshold-discovery' })
    expect(res.error).toBeUndefined()
    expect(res.result.scene_key).toBe('scene:threshold-discovery')
    const choices = res.result.available_choices as string[]
    expect(choices).toContain('investigate-sound')
    expect(choices).toContain('search-perimeter')
    expect(choices).toContain('call-out')
    expect(choices).toContain('retreat')
  })
})

describe('canonical fixture — faction:processing-guild (hierarchy + standing system)', () => {
  const GUILD_LORE = [
    '# Faction: Processing Guild',
    'Type: operational-hierarchy',
    'Status: active',
    'Location: processing-chamber-primary',
    '',
    '## Hierarchy',
    'Ranks:',
    '- title: director',
    '  members: [entity:actor-primary]',
    '  authority: supreme',
    '- title: senior-operator',
    '  members: [entity:actor-secondary]',
    '  authority: high',
    '',
    '## Standing System',
    'Reputation-Tiers: [hostile, suspicious, neutral, accepted, favored, exalted]',
    'Default-Reputation: neutral',
    '',
    '## Member Records',
    'Member-Records:',
    '- entity: entity:actor-primary',
    '  rank: director',
    '  specialization: multi-stage-processing',
    '  yield-history: exemplary',
  ].join('\n')

  const ACTOR_STUB = [
    '# Entity: Actor Primary',
    'Faction: processing-guild',
    'Rank: director',
    'Weight-1 (Drive): 85',
  ].join('\n')

  beforeEach(async () => {
    await seedKV('faction:processing-guild', GUILD_LORE)
    await seedKV('entity:actor-primary', ACTOR_STUB)
  })

  it('stores and retrieves faction lore verbatim', async () => {
    const res = await callTool('get_lore', { query: 'faction:processing-guild' })
    expect(res.result.content[0].text).toBe(GUILD_LORE)
  })

  it('get_faction_standing detects actor-primary as member (slug appears in faction text)', async () => {
    const res = await callTool('get_faction_standing', {
      entity_key: 'entity:actor-primary',
      faction_key: 'faction:processing-guild',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.standing.is_member).toBe(true)
    expect(res.result.standing.rank).toBe('director')
  })

  it('get_faction_standing returns non-member for entity not in guild text', async () => {
    await seedKV('entity:outsider', 'Faction: rival-guild')
    const res = await callTool('get_faction_standing', {
      entity_key: 'entity:outsider',
      faction_key: 'faction:processing-guild',
    })
    expect(res.result.standing.is_member).toBe(false)
  })
})

describe('canonical fixture — thread comparison: primary vs secondary processing cycle', () => {
  beforeEach(async () => {
    await seedKV('entity:subject-alpha', [
      '# Entity: Subject Alpha',
      'Status: Active, Stage-2-of-4',
      'Thread: primary-processing-cycle',
      'Timeline-Value: 12',
      'Current-Date: cycle-day-1',
    ].join('\n'))
    await seedKV('entity:subject-beta', [
      '# Entity: Subject Beta',
      'Status: Stage-3-of-4, Modified-Consciousness',
      'Thread: secondary-processing-cycle',
      'Timeline-Value: 48',
      'Current-Date: cycle-day-3',
    ].join('\n'))
  })

  it('get_thread_comparison reports one entity per thread and correct timeline offset', async () => {
    const res = await callTool('get_thread_comparison', {
      thread_a: 'primary-processing-cycle',
      thread_b: 'secondary-processing-cycle',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.thread_a.entity_count).toBe(1)
    expect(res.result.thread_b.entity_count).toBe(1)
    // avg(12) vs avg(48) → offset = 36
    expect(res.result.timeline_offset).toBeCloseTo(36, 0)
  })

  it('check_convergence returns can_converge=false when threads share no Current-Date', async () => {
    const res = await callTool('check_convergence', {
      thread_a: 'primary-processing-cycle',
      thread_b: 'secondary-processing-cycle',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.can_converge).toBe(false)
    expect(res.result.shared_dates).toHaveLength(0)
  })

  it('check_convergence returns can_converge=true when threads share a Current-Date', async () => {
    await seedKV('entity:subject-alpha', [
      'Thread: primary-processing-cycle',
      'Timeline-Value: 12',
      'Current-Date: convergence-point',
    ].join('\n'))
    await seedKV('entity:subject-beta', [
      'Thread: secondary-processing-cycle',
      'Timeline-Value: 48',
      'Current-Date: convergence-point',
    ].join('\n'))
    const res = await callTool('check_convergence', {
      thread_a: 'primary-processing-cycle',
      thread_b: 'secondary-processing-cycle',
    })
    expect(res.result.can_converge).toBe(true)
    expect(res.result.shared_dates).toContain('convergence-point')
  })
})

describe('canonical fixture — template:standard-subject as generate_entity archetype', () => {
  const TEMPLATE_LORE = [
    '# Template: Standard Subject Entity',
    'Type: subject-archetype',
    'Category: baseline-humanoid',
    '',
    '## Default Weights',
    'Weight-1 (Drive): 30',
    'Weight-2 (Vulnerability): 55',
    '',
    '## Default Sensory',
    'Temperature-Range: 36-38°C',
    'Scent-Profile: baseline-mammalian, variable-cortisol',
    'Sound-Signature: standard-respiration',
    'Visual-Descriptors: bipedal-humanoid, variable-pigmentation',
    '',
    '## State Machine Assignment',
    'State-Machine: standard-multi-stage-processing',
    'Current-Stage: 1',
    'Total-Stages: 4',
  ].join('\n')

  beforeEach(() => seedKV('template:standard-subject', TEMPLATE_LORE))

  it('stores and retrieves template lore verbatim', async () => {
    const res = await callTool('get_lore', { query: 'template:standard-subject' })
    expect(res.result.content[0].text).toBe(TEMPLATE_LORE)
  })

  it('generate_entity creates a new entity from the template archetype', async () => {
    const res = await callTool('generate_entity', { archetype_key: 'template:standard-subject' })
    expect(res.error).toBeUndefined()
    expect(res.result.entity_key).toMatch(/^entity:standard-subject-\d+$/)
    expect(res.result.entity_text).toContain('Weight-1')
    expect(res.result.metadata.written).toBe(1)
  })

  it('generated entity is retrievable and inherits integer weight values', async () => {
    const gen = await callTool('generate_entity', { archetype_key: 'template:standard-subject' })
    const lore = await callTool('get_lore', { query: gen.result.entity_key })
    expect(lore.error).toBeUndefined()
    expect(lore.result.text).toContain('30')
    expect(lore.result.text).toContain('55')
  })
})

describe('canonical fixture — sensory profile with Temperature-Range and Scent-Profile field names', () => {
  it('get_sensory_profile reads Sound-Signature and Visual-Descriptors from canonical ## Sensory Profile section', async () => {
    await seedKV('entity:sensory-canonical', [
      '## Sensory Profile',
      'Temperature-Range: 36-38°C',
      'Scent-Profile: elevated-cortisol, salt',
      'Texture-Profile: soft-tissue, minimal-callus',
      'Sound-Signature: elevated-respiration, occasional-vocalization',
      'Visual-Descriptors: lean-musculature, fair-integument',
    ].join('\n'))
    const res = await callTool('get_sensory_profile', { entity_key: 'entity:sensory-canonical' })
    expect(res.error).toBeUndefined()
    expect(res.result.profile.sound_signature).toContain('elevated-respiration')
    expect(res.result.profile.visual_descriptors).toContain('lean-musculature')
  })

  it('get_sensory_profile maps Temperature-Range field to temperature profile slot', async () => {
    await seedKV('entity:temp-range-entity', [
      'Temperature-Range: 38-42°C',
      'Sound-Signature: low-frequency-resonance',
    ].join('\n'))
    const res = await callTool('get_sensory_profile', { entity_key: 'entity:temp-range-entity' })
    expect(res.error).toBeUndefined()
    const temp = res.result.profile.temperature
    expect(temp).toBeTruthy()
    expect(temp).toContain('38')
  })

  it('get_sensory_profile maps Scent-Profile field to scent profile slot', async () => {
    await seedKV('entity:scent-profile-entity', [
      'Scent-Profile: metabolic-heat, copper, enzymatic-secretion',
      'Sound-Signature: low-resonance',
    ].join('\n'))
    const res = await callTool('get_sensory_profile', { entity_key: 'entity:scent-profile-entity' })
    expect(res.error).toBeUndefined()
    const scent = res.result.profile.scent
    expect(scent).toBeTruthy()
    expect(scent).toContain('metabolic-heat')
  })
})

describe('canonical fixture — get_location_occupants with entity: prefix keys', () => {
  it('finds entity:subject-alpha and entity:actor-primary at processing-chamber-primary', async () => {
    await seedKV('entity:subject-alpha', [
      'Status: Active, Stage-2-of-4',
      'Location: processing-chamber-primary',
      'Weight-1 (Drive): 30',
    ].join('\n'))
    await seedKV('entity:actor-primary', [
      'Status: Active, Processing',
      'Location: processing-chamber-primary',
      'Weight-1 (Drive): 85',
    ].join('\n'))
    await seedKV('entity:subject-beta', [
      'Status: Stage-3-of-4',
      'Location: processing-chamber-secondary',
    ].join('\n'))
    const res = await callTool('get_location_occupants', { location_key: 'processing-chamber-primary' })
    expect(res.error).toBeUndefined()
    const keys = res.result.occupants.map((o: { key: string }) => o.key)
    expect(keys).toContain('entity:subject-alpha')
    expect(keys).toContain('entity:actor-primary')
    expect(keys).not.toContain('entity:subject-beta')
  })
})

describe('canonical fixture — integer weight boundary values (5 min, 95 max)', () => {
  it('Weight-1:5 (minimum drive) normalizes to 0.05', async () => {
    await seedKV('entity:min-drive', 'Weight-1 (Drive): 5\nState-Level: 0')
    await seedKV('entity:passive', 'Weight-2: 0')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'entity:min-drive',
      entity_b_id: 'entity:passive',
      action_type: 'test',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1_raw).toBe(5)
    expect(res.result.metadata.weight_1).toBeCloseTo(0.05, 5)
  })

  it('Weight-1:95 (maximum drive) normalizes to 0.95', async () => {
    await seedKV('entity:max-drive', 'Weight-1 (Drive): 95\nState-Level: 0')
    await seedKV('entity:strong-resist', 'Weight-2 (Vulnerability): 95')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'entity:max-drive',
      entity_b_id: 'entity:strong-resist',
      action_type: 'test',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1_raw).toBe(95)
    expect(res.result.metadata.weight_1).toBeCloseTo(0.95, 5)
    expect(res.result.metadata.weight_2_raw).toBe(95)
    expect(res.result.metadata.weight_2).toBeCloseTo(0.95, 5)
    // P = 0.95 - 0.95*0.3 = 0.665
    expect(res.result.metadata.probability).toBeCloseTo(0.665, 3)
  })

  it('skill values (0.0–1.0 range) in Skills section are not further normalized', async () => {
    await seedKV('entity:skill-range-a', 'Weight-1: 0.5\nState-Level: 0')
    await seedKV('entity:skill-range-b', 'Weight-2: 0.3')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'entity:skill-range-a',
      entity_b_id: 'entity:skill-range-b',
      action_type: 'test',
    })
    expect(res.error).toBeUndefined()
    // 0.5 is already in [0,1] — no normalization
    expect(res.result.metadata.weight_1).toBe(0.5)
    expect(res.result.metadata.weight_2).toBe(0.3)
  })
})

// ── append_event ──────────────────────────────────────────────────────────────

describe('append_event', () => {
  it('appends an event to an entity chronicle', async () => {
    const res = await callTool('append_event', { entity_key: 'character:zira', verb: 'sedated', object: 'character:predator', thread: 'thread-alpha' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.entity_key).toBe('character:zira')
    expect(res.result.metadata.event_count).toBe(1)
    expect(res.result.metadata.duplicate).toBe(false)
  })

  it('is idempotent within 1s for identical verb+object', async () => {
    const at = new Date().toISOString()
    await callTool('append_event', { entity_key: 'character:zira', verb: 'moved', at })
    const res = await callTool('append_event', { entity_key: 'character:zira', verb: 'moved', at })
    expect(res.result.metadata.event_count).toBe(1)
    expect(res.result.metadata.duplicate).toBe(true)
  })

  it('different verbs are not deduplicated', async () => {
    const at = new Date().toISOString()
    await callTool('append_event', { entity_key: 'character:zira', verb: 'arrived', at })
    const res = await callTool('append_event', { entity_key: 'character:zira', verb: 'departed', at })
    expect(res.result.metadata.event_count).toBe(2)
    expect(res.result.metadata.duplicate).toBe(false)
  })

  it('rejects missing verb', async () => {
    const res = await callTool('append_event', { entity_key: 'character:zira' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

// ── get_event_log ─────────────────────────────────────────────────────────────

describe('get_event_log', () => {
  it('returns events for an entity', async () => {
    await callTool('append_event', { entity_key: 'character:bob', verb: 'arrived', location: 'location:market' })
    await callTool('append_event', { entity_key: 'character:bob', verb: 'traded' })
    const res = await callTool('get_event_log', { entity_key: 'character:bob' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.returned).toBe(2)
  })

  it('filters by verb', async () => {
    await callTool('append_event', { entity_key: 'character:alice', verb: 'moved' })
    await callTool('append_event', { entity_key: 'character:alice', verb: 'rested' })
    const res = await callTool('get_event_log', { entity_key: 'character:alice', verbs: ['moved'] })
    expect(res.result.metadata.returned).toBe(1)
    expect(res.result.events[0].verb).toBe('moved')
  })

  it('accepts array of entity keys', async () => {
    await callTool('append_event', { entity_key: 'character:aa', verb: 'walked' })
    await callTool('append_event', { entity_key: 'character:bb', verb: 'ran' })
    const res = await callTool('get_event_log', { entity_key: ['character:aa', 'character:bb'] })
    expect(res.result.metadata.returned).toBe(2)
  })

  it('returns empty when no events exist', async () => {
    const res = await callTool('get_event_log', { entity_key: 'character:nobody-9999' })
    expect(res.result.metadata.returned).toBe(0)
    expect(res.result.content[0].text).toBe('No events found.')
  })

  it('rejects missing entity_key', async () => {
    const res = await callTool('get_event_log', {})
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

// ── recent_changes ────────────────────────────────────────────────────────────

describe('recent_changes', () => {
  it('returns recent write operations', async () => {
    await callTool('set_lore', { key: 'character:testperson', text: 'Test' })
    const res = await callTool('recent_changes', { limit: 10 })
    expect(res.error).toBeUndefined()
    const changes = res.result.changes as Array<{ key: string }>
    expect(changes.some(c => c.key === 'character:testperson')).toBe(true)
  })

  it('filters by key_prefix', async () => {
    await callTool('set_lore', { key: 'character:hero', text: 'Hero text' })
    await callTool('set_lore', { key: 'location:forest', text: 'Forest text' })
    const res = await callTool('recent_changes', { key_prefix: 'character:', limit: 50 })
    const changes = res.result.changes as Array<{ key: string }>
    expect(changes.every(c => c.key.startsWith('character:'))).toBe(true)
  })

  it('returns empty when no changes exist', async () => {
    const res = await callTool('recent_changes')
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.count).toBe(0)
  })
})

// ── tag_topic ─────────────────────────────────────────────────────────────────

describe('tag_topic', () => {
  it('adds tags to a topic and updates reverse index', async () => {
    await seedKV('scene:betrayal', 'A betrayal scene')
    const res = await callTool('tag_topic', { key: 'scene:betrayal', add: ['theme:betrayal', 'tone:dread'] })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.tags).toContain('theme:betrayal')
    expect(res.result.metadata.tags).toContain('tone:dread')
    const lore = await callTool('get_lore', { query: 'scene:betrayal' })
    expect(lore.result.text).toContain('theme:betrayal')
  })

  it('removes tags from a topic', async () => {
    await seedKV('scene:reunion', 'A reunion scene')
    await callTool('tag_topic', { key: 'scene:reunion', add: ['theme:hope', 'tone:warm'] })
    const res = await callTool('tag_topic', { key: 'scene:reunion', remove: ['tone:warm'] })
    expect(res.result.metadata.tags).toContain('theme:hope')
    expect(res.result.metadata.tags).not.toContain('tone:warm')
  })

  it('returns error for missing topic', async () => {
    const res = await callTool('tag_topic', { key: 'scene:nonexistent-9999', add: ['theme:test'] })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('no-ops gracefully when add and remove both empty', async () => {
    await seedKV('scene:empty-tag', 'Scene text')
    const res = await callTool('tag_topic', { key: 'scene:empty-tag' })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toContain('No add or remove tags specified.')
  })
})

// ── find_by_tag ───────────────────────────────────────────────────────────────

describe('find_by_tag', () => {
  it('finds topics with any matching tag', async () => {
    await seedKV('scene:s1', 'Scene 1')
    await seedKV('scene:s2', 'Scene 2')
    await callTool('tag_topic', { key: 'scene:s1', add: ['theme:betrayal'] })
    await callTool('tag_topic', { key: 'scene:s2', add: ['theme:betrayal'] })
    const res = await callTool('find_by_tag', { tags: ['theme:betrayal'] })
    expect(res.error).toBeUndefined()
    expect(res.result.results.length).toBe(2)
  })

  it('returns empty when no topics match', async () => {
    const res = await callTool('find_by_tag', { tags: ['theme:nonexistent-xyz-123'] })
    expect(res.result.results.length).toBe(0)
  })

  it('mode=all returns intersection only', async () => {
    await seedKV('scene:dual', 'Dual tag scene')
    await seedKV('scene:single', 'Single tag scene')
    await callTool('tag_topic', { key: 'scene:dual', add: ['a:1', 'b:2'] })
    await callTool('tag_topic', { key: 'scene:single', add: ['a:1'] })
    const res = await callTool('find_by_tag', { tags: ['a:1', 'b:2'], mode: 'all' })
    const keys = (res.result.results as Array<{ key: string }>).map(r => r.key)
    expect(keys).toContain('scene:dual')
    expect(keys).not.toContain('scene:single')
  })

  it('rejects empty tags array', async () => {
    const res = await callTool('find_by_tag', { tags: [] })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

// ── bookmark_state ────────────────────────────────────────────────────────────

describe('bookmark_state', () => {
  it('creates a snapshot with correct key count', async () => {
    await seedKV('character:snap1', 'Snap 1')
    await seedKV('character:snap2', 'Snap 2')
    const res = await callTool('bookmark_state', { name: 'test-snapshot', note: 'Before battle' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.name).toBe('test-snapshot')
    expect(res.result.metadata.key_count).toBeGreaterThanOrEqual(2)
  })

  it('scopes to key_prefix', async () => {
    await seedKV('character:c1', 'C1')
    await seedKV('location:l1', 'L1')
    const res = await callTool('bookmark_state', { name: 'char-only', key_prefix: 'character:' })
    expect(res.result.metadata.key_count).toBe(1)
  })

  it('rejects missing name', async () => {
    const res = await callTool('bookmark_state', {})
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

// ── world_diff ────────────────────────────────────────────────────────────────

describe('world_diff', () => {
  it('shows added keys since snapshot', async () => {
    await seedKV('character:existing', 'Existed before')
    await callTool('bookmark_state', { name: 'before-diff' })
    await callTool('set_lore', { key: 'character:new-arrival', text: 'Just added' })
    const res = await callTool('world_diff', { from: 'before-diff' })
    expect(res.error).toBeUndefined()
    expect(res.result.added).toContain('character:new-arrival')
  })

  it('shows changed keys after an update', async () => {
    await callTool('set_lore', { key: 'character:mutable', text: 'Version 1' })
    await callTool('bookmark_state', { name: 'before-update' })
    await callTool('set_lore', { key: 'character:mutable', text: 'Version 2' })
    const res = await callTool('world_diff', { from: 'before-update' })
    expect(res.result.changed.some((c: any) => c.key === 'character:mutable')).toBe(true)
  })

  it('returns zero-diff when nothing changed', async () => {
    await seedKV('character:stable', 'Stable')
    await callTool('bookmark_state', { name: 'stable-snap' })
    const res = await callTool('world_diff', { from: 'stable-snap' })
    expect(res.result.added.length).toBe(0)
    expect(res.result.removed.length).toBe(0)
    expect(res.result.changed.length).toBe(0)
  })

  it('treats unknown snapshot as empty from-manifest (all current keys are added)', async () => {
    await seedKV('character:exists', 'Exists')
    const res = await callTool('world_diff', { from: 'nonexistent-snapshot-xyz' })
    expect(res.error).toBeUndefined()
    expect(res.result.added.length).toBeGreaterThanOrEqual(1)
  })
})

// ── plant_setup ───────────────────────────────────────────────────────────────

describe('plant_setup', () => {
  it('creates a setup entry with tension', async () => {
    const res = await callTool('plant_setup', { id: 'locked-door', description: 'The cellar door is locked', tension: 4 })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.key).toBe('setup:locked-door')
    expect(res.result.metadata.tension).toBe(4)
  })

  it('created setup appears in list_unpaid_setups', async () => {
    await callTool('plant_setup', { id: 'test-setup-1', description: 'Test setup', tension: 3 })
    const res = await callTool('list_unpaid_setups')
    const setups = res.result.setups as Array<{ id: string }>
    expect(setups.some(s => s.id === 'test-setup-1')).toBe(true)
  })

  it('defaults tension to 3 when omitted', async () => {
    const res = await callTool('plant_setup', { id: 'default-tension', description: 'No tension given' })
    expect(res.result.metadata.tension).toBe(3)
  })

  it('rejects missing description', async () => {
    const res = await callTool('plant_setup', { id: 'bad-setup' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

// ── pay_off_setup ─────────────────────────────────────────────────────────────

describe('pay_off_setup', () => {
  it('marks a setup as paid', async () => {
    await callTool('plant_setup', { id: 'gun-on-wall', description: 'The gun on the wall', tension: 5 })
    const res = await callTool('pay_off_setup', { id: 'gun-on-wall', resolution: 'Fired in chapter 3', paid_in: 'scene:climax' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.status).toBe('paid')
  })

  it('paid setup no longer appears in list_unpaid_setups', async () => {
    await callTool('plant_setup', { id: 'will-be-paid', description: 'Will be paid', tension: 2 })
    await callTool('pay_off_setup', { id: 'will-be-paid', resolution: 'Resolved' })
    const res = await callTool('list_unpaid_setups')
    const setups = res.result.setups as Array<{ id: string }>
    expect(setups.some(s => s.id === 'will-be-paid')).toBe(false)
  })

  it('supports abandoned and deferred statuses', async () => {
    await callTool('plant_setup', { id: 'dropped', description: 'Will be dropped', tension: 1 })
    const res = await callTool('pay_off_setup', { id: 'dropped', resolution: 'Cut from story', status: 'abandoned' })
    expect(res.result.metadata.status).toBe('abandoned')
  })

  it('returns error for nonexistent setup', async () => {
    const res = await callTool('pay_off_setup', { id: 'nonexistent-9999', resolution: 'Resolved' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

// ── list_unpaid_setups ────────────────────────────────────────────────────────

describe('list_unpaid_setups', () => {
  it('returns open setups sorted by tension descending', async () => {
    await callTool('plant_setup', { id: 'low-tension', description: 'Low tension', tension: 1 })
    await callTool('plant_setup', { id: 'high-tension', description: 'High tension', tension: 5 })
    const res = await callTool('list_unpaid_setups')
    expect(res.error).toBeUndefined()
    const setups = res.result.setups as Array<{ id: string; tension: number }>
    expect(setups[0].tension).toBeGreaterThanOrEqual(setups[setups.length - 1].tension)
  })

  it('filters by min_tension', async () => {
    await callTool('plant_setup', { id: 'min-t2', description: 'Low', tension: 2 })
    await callTool('plant_setup', { id: 'min-t4', description: 'High', tension: 4 })
    const res = await callTool('list_unpaid_setups', { min_tension: 3 })
    const setups = res.result.setups as Array<{ tension: number }>
    expect(setups.every(s => s.tension >= 3)).toBe(true)
    expect(setups.some(s => s.tension < 3)).toBe(false)
  })

  it('returns empty when no open setups exist', async () => {
    // Seed a non-setup KV entry so kvList uses KV instead of falling back to
    // the module-level loreDB (which accumulates setup entries across tests).
    await seedKV('placeholder:empty-setups', 'placeholder')
    const res = await callTool('list_unpaid_setups')
    expect(res.result.metadata.count).toBe(0)
    expect(res.result.content[0].text).toBe('No open setups found.')
  })
})

// ── set_goal ──────────────────────────────────────────────────────────────────

describe('set_goal', () => {
  it('adds a Goal:<id> field to an entity', async () => {
    await seedKV('character:hero', 'Hero is brave.\n**Status:** Active')
    const res = await callTool('set_goal', { entity_key: 'character:hero', goal_id: 'find-artifact', description: 'Find the ancient artifact', status: 'active' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.goal_id).toBe('find-artifact')
    expect(res.result.metadata.status).toBe('active')
    const lore = await callTool('get_lore', { query: 'character:hero' })
    expect(lore.result.text).toContain('Goal:find-artifact')
    expect(lore.result.text).toContain('active')
  })

  it('updates an existing goal in place', async () => {
    await seedKV('character:warrior', '**Status:** Active\n**Goal:main-quest:** active | Defeat the dragon')
    await callTool('set_goal', { entity_key: 'character:warrior', goal_id: 'main-quest', description: 'Defeat the dragon', status: 'blocked', obstacle: 'No sword' })
    const lore = await callTool('get_lore', { query: 'character:warrior' })
    expect(lore.result.text).toContain('blocked')
    expect(lore.result.text).toContain('No sword')
  })

  it('stores parent goal reference when provided', async () => {
    await seedKV('character:explorer', '**Status:** Active')
    await callTool('set_goal', { entity_key: 'character:explorer', goal_id: 'find-exit', description: 'Find exit', parent: 'escape' })
    const lore = await callTool('get_lore', { query: 'character:explorer' })
    expect(lore.result.text).toContain('parent: escape')
  })

  it('returns error for nonexistent entity', async () => {
    const res = await callTool('set_goal', { entity_key: 'character:ghost-9999', goal_id: 'find-peace', description: 'Find peace' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

// ── check_continuity ──────────────────────────────────────────────────────────

describe('check_continuity', () => {
  it('finds dangling character references', async () => {
    await seedKV('character:wanderer', '**Status:** Active\nShe knows character:nonexistent-person-xyz.')
    const res = await callTool('check_continuity', { checks: ['dangling'] })
    expect(res.error).toBeUndefined()
    const findings = res.result.findings as Array<{ check: string; key: string }>
    expect(findings.some(f => f.check === 'dangling' && f.key === 'character:wanderer')).toBe(true)
  })

  it('returns clean when no dangling refs', async () => {
    await seedKV('character:clean-one', '**Status:** Active\nNo problematic references here.')
    const res = await callTool('check_continuity', { scope: 'character:clean-one', checks: ['dangling'] })
    expect(res.result.content[0].text).toContain('No continuity issues found.')
  })

  it('severity_floor=error filters out warn-level findings', async () => {
    await seedKV('character:sev-test', 'Mentions character:nonexistent-sev-xyz')
    const res = await callTool('check_continuity', { checks: ['dangling'], severity_floor: 'error' })
    // dangling refs are warn severity — should be filtered out when floor is error
    const findings = res.result.findings as Array<{ severity: string }>
    expect(findings.filter(f => f.severity === 'warn')).toHaveLength(0)
  })

  it('detects missing location on character', async () => {
    await seedKV('character:lost-soul', '**Status:** Active\n**Location:** location:ghost-town-xyz-9999')
    const res = await callTool('check_continuity', { checks: ['occupancy'] })
    const findings = res.result.findings as Array<{ check: string }>
    expect(findings.some(f => f.check === 'occupancy')).toBe(true)
  })
})

// ── scene_brief ───────────────────────────────────────────────────────────────

describe('scene_brief', () => {
  it('returns location text and present entities', async () => {
    await seedKV('location:market', 'A busy marketplace')
    await seedKV('character:vendor', '**Status:** Active\n**Location:** location:market')
    const res = await callTool('scene_brief', { location_key: 'location:market' })
    expect(res.error).toBeUndefined()
    expect(res.result.location.key).toBe('location:market')
    expect(res.result.entities.length).toBe(1)
    expect(res.result.entities[0].key).toBe('character:vendor')
  })

  it('includes open setups for present actors', async () => {
    await seedKV('location:hall', 'The great hall')
    await seedKV('character:noble', '**Status:** Active\n**Location:** location:hall')
    await callTool('plant_setup', { id: 'noble-secret', description: 'Noble hides a secret', tension: 4, actors: ['character:noble'] })
    const res = await callTool('scene_brief', { location_key: 'location:hall' })
    const setupIds = (res.result.open_setups as Array<{ id: string }>).map(s => s.id)
    expect(setupIds).toContain('noble-secret')
  })

  it('includes entity goal when set', async () => {
    await seedKV('location:den', 'A den')
    await seedKV('character:schemer', '**Status:** Active\n**Location:** location:den\n**Goal:main:** active | Take over the guild')
    const res = await callTool('scene_brief', { location_key: 'location:den' })
    expect(res.result.entities[0].top_goal).toContain('main:')
  })

  it('returns error when no location or scene key provided', async () => {
    const res = await callTool('scene_brief', {})
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('returns error for nonexistent location', async () => {
    const res = await callTool('scene_brief', { location_key: 'location:nonexistent-9999' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

// ── render_pov ────────────────────────────────────────────────────────────────

describe('render_pov', () => {
  it('filters [hidden] lines for low-perception POV', async () => {
    await seedKV('location:foggy-alley', 'Dark alley.\n[hidden] An assassin lurks in the shadows.')
    await seedKV('character:naive-pov', '**Status:** Scared\n**Perception:** 0.2\n**Location:** location:foggy-alley')
    const res = await callTool('render_pov', { pov_entity_key: 'character:naive-pov', location_key: 'location:foggy-alley' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.pov).toBe('character:naive-pov')
    expect(res.result.location.filtered_text).not.toContain('assassin')
  })

  it('keeps [hidden] lines for high-perception POV', async () => {
    await seedKV('location:shadows', 'The room.\n[hidden] A safe is behind the painting.')
    await seedKV('character:sharp-eyes', '**Perception:** 0.9\n**Location:** location:shadows')
    const res = await callTool('render_pov', { pov_entity_key: 'character:sharp-eyes', location_key: 'location:shadows' })
    expect(res.result.location.filtered_text).toContain('safe')
  })

  it('includes voice hints when requested', async () => {
    await seedKV('location:tavern', 'The tavern is warm.')
    await seedKV('character:bard', '**Status:** Active\n**Location:** location:tavern\n**Diction:** archaic and flowery\n**Perception:** 0.8')
    const res = await callTool('render_pov', { pov_entity_key: 'character:bard', location_key: 'location:tavern', include_voice_hints: true })
    expect(res.result.voice_hints).toBeDefined()
    expect(res.result.voice_hints.diction).toBe('archaic and flowery')
  })

  it('uses entity Location field when no location_key provided', async () => {
    await seedKV('location:cabin', 'A small cabin.')
    await seedKV('character:recluse', '**Perception:** 0.5\n**Location:** location:cabin')
    const res = await callTool('render_pov', { pov_entity_key: 'character:recluse' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.location).toBe('location:cabin')
  })

  it('returns error for nonexistent POV entity', async () => {
    const res = await callTool('render_pov', { pov_entity_key: 'character:ghost-9999', location_key: 'location:market' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

// ── get_lore_section ──────────────────────────────────────────────────────────

describe('get_lore_section', () => {
  it('exact match returns section content', async () => {
    await seedKV('section:basic', '## Personality\nCurious and kind.\n## Goals\nFind the truth.')
    const res = await callTool('get_lore_section', { key: 'section:basic', sections: ['Personality'] })
    expect(res.error).toBeUndefined()
    expect(res.result.sections['Personality']).toBe('Curious and kind.')
    expect(res.result.not_found).toEqual([])
  })

  it('case-insensitive match in loose mode', async () => {
    await seedKV('section:case', '## PERSONALITY\nCurious and kind.')
    const res = await callTool('get_lore_section', { key: 'section:case', sections: ['personality'] })
    expect(res.result.sections['personality']).toBe('Curious and kind.')
  })

  it('trailing colon stripped in loose mode', async () => {
    await seedKV('section:colon', '## Personality:\nCurious.')
    const res = await callTool('get_lore_section', { key: 'section:colon', sections: ['Personality'] })
    expect(res.result.sections['Personality']).toBe('Curious.')
  })

  it('whitespace collapsed in loose mode', async () => {
    await seedKV('section:spaces', '##   Physical   Profile  \nBroad-shouldered.')
    const res = await callTool('get_lore_section', { key: 'section:spaces', sections: ['Physical Profile'] })
    expect(res.result.sections['Physical Profile']).toBe('Broad-shouldered.')
  })

  it('not_found lists missing sections', async () => {
    await seedKV('section:missing', '## Personality\nCurious.')
    const res = await callTool('get_lore_section', { key: 'section:missing', sections: ['Inventory'] })
    expect(res.result.sections).toEqual({})
    expect(res.result.not_found).toEqual(['Inventory'])
  })

  it('empty section returns empty string and empty_section warning', async () => {
    await seedKV('section:empty', '## Personality\n\n## Goals\nBecome stronger.')
    const res = await callTool('get_lore_section', { key: 'section:empty', sections: ['Personality'] })
    expect(res.result.sections['Personality']).toBe('')
    expect(res.result.warnings.some((w: string) => w.includes('empty_section'))).toBe(true)
  })

  it('no ## headings: returns not_found and no_sections_found warning', async () => {
    await seedKV('section:flat', 'This is just a paragraph of text with no structure.')
    const res = await callTool('get_lore_section', { key: 'section:flat', sections: ['Personality'] })
    expect(res.result.sections).toEqual({})
    expect(res.result.warnings).toContain('no_sections_found')
    expect(res.result.not_found).toContain('Personality')
  })

  it('fallback to # headings when no ## headings exist', async () => {
    await seedKV('section:single-hash', '# Title\nSome preamble.\n# Another\nMore text.')
    const res = await callTool('get_lore_section', { key: 'section:single-hash', sections: ['Title'] })
    expect(res.result.sections['Title']).toBe('Some preamble.')
  })

  it('### subheadings are content, not section boundaries', async () => {
    await seedKV('section:sub', '## Personality\n### Strengths\nBrave.\n### Weaknesses\nImpulsive.\n## Goals\nGo home.')
    const res = await callTool('get_lore_section', { key: 'section:sub', sections: ['Personality'] })
    const content = res.result.sections['Personality'] as string
    expect(content).toContain('### Strengths')
    expect(content).toContain('Impulsive.')
    expect(content).not.toContain('Go home.')
  })

  it('special characters in section name match exactly', async () => {
    await seedKV('section:special', '## Weight-1 (Predator Drive):\n0.85')
    const res = await callTool('get_lore_section', { key: 'section:special', sections: ['Weight-1 (Predator Drive)'] })
    expect(res.result.sections['Weight-1 (Predator Drive)']).toContain('0.85')
  })

  it('substring does not cause false match (Goals vs Goals (Completed))', async () => {
    await seedKV('section:substring', '## Goals\nShort term.\n## Goals (Completed)\nDone.')
    const res = await callTool('get_lore_section', { key: 'section:substring', sections: ['Goals'] })
    expect(res.result.sections['Goals']).toBe('Short term.')
    expect(res.result.sections['Goals (Completed)']).toBeUndefined()
  })

  it('last section runs to EOF correctly', async () => {
    await seedKV('section:last', '## Section A\nContent A\n## Section B\nContent B')
    const res = await callTool('get_lore_section', { key: 'section:last', sections: ['Section B'] })
    expect(res.result.sections['Section B']).toBe('Content B')
  })

  it('duplicate section: first non-empty wins, duplicate_section warning added', async () => {
    await seedKV('section:dup', '## Notes\nFirst note.\n## Personality\nKind.\n## Notes\nSecond note.')
    const res = await callTool('get_lore_section', { key: 'section:dup', sections: ['Notes'] })
    expect(res.result.sections['Notes']).toBe('First note.')
    expect(res.result.warnings.some((w: string) => w.includes('duplicate_section'))).toBe(true)
  })

  it('duplicate section: skips empty first occurrence, returns first non-empty, no empty_section warning', async () => {
    await seedKV('section:dup-empty-first', '## Notes\n## Personality\nKind.\n## Notes\nSecond note.')
    const res = await callTool('get_lore_section', { key: 'section:dup-empty-first', sections: ['Notes'] })
    expect(res.result.sections['Notes']).toBe('Second note.')
    expect(res.result.warnings.some((w: string) => w.includes('duplicate_section'))).toBe(true)
    expect(res.result.warnings.some((w: string) => w.includes('empty_section'))).toBe(false)
  })

  it('duplicate section: all empty → returns "", warns both duplicate_section and empty_section', async () => {
    await seedKV('section:dup-all-empty', '## Notes\n## Notes\n## Personality\nKind.')
    const res = await callTool('get_lore_section', { key: 'section:dup-all-empty', sections: ['Notes'] })
    expect(res.result.sections['Notes']).toBe('')
    expect(res.result.warnings.some((w: string) => w.includes('duplicate_section'))).toBe(true)
    expect(res.result.warnings.some((w: string) => w.includes('empty_section'))).toBe(true)
  })

  it('zero sections requested: sections={}, not_found=[], no_sections_requested warning', async () => {
    await seedKV('section:zero', '## Personality\nCurious.')
    const res = await callTool('get_lore_section', { key: 'section:zero', sections: [] })
    expect(res.result.sections).toEqual({})
    expect(res.result.not_found).toEqual([])
    expect(res.result.warnings).toContain('no_sections_requested')
  })

  it('unicode and emoji in section name', async () => {
    await seedKV('section:unicode', "## État d'Esprit 😤\nFrustrated and hopeful.")
    const res = await callTool('get_lore_section', { key: 'section:unicode', sections: ["État d'Esprit 😤"] })
    expect(res.result.sections["État d'Esprit 😤"]).toContain('Frustrated and hopeful')
  })

  it('non-existent key returns key_not_found error in result', async () => {
    const res = await callTool('get_lore_section', { key: 'character:does-not-exist-99999', sections: ['Personality'] })
    expect(res.error).toBeUndefined()
    expect(res.result.error).toBe('key_not_found')
    expect(res.result.key).toBe('character:does-not-exist-99999')
  })

  it('consecutive empty sections both get empty_section warnings', async () => {
    await seedKV('section:consecutive', '## Section A\n## Section B\n## Section C\nReal content at last.')
    const res = await callTool('get_lore_section', { key: 'section:consecutive', sections: ['Section A', 'Section B', 'Section C'] })
    expect(res.result.sections['Section A']).toBe('')
    expect(res.result.sections['Section B']).toBe('')
    expect(res.result.sections['Section C']).toBe('Real content at last.')
    const emptyWarnings = (res.result.warnings as string[]).filter(w => w.includes('empty_section'))
    expect(emptyWarnings).toHaveLength(2)
  })

  it('mixed request: found sections returned, missing in not_found', async () => {
    await seedKV('section:mixed', '## Personality\nCurious.\n## Goals\nFind truth.')
    const res = await callTool('get_lore_section', { key: 'section:mixed', sections: ['Personality', 'Inventory', 'Goals'] })
    expect(res.result.sections['Personality']).toBe('Curious.')
    expect(res.result.sections['Goals']).toBe('Find truth.')
    expect(res.result.not_found).toEqual(['Inventory'])
  })

  it('very long section returns full content without truncation', async () => {
    const longContent = 'Very long content. '.repeat(5000)
    await seedKV('section:long', `## Notes\n${longContent}\n## End\nDone.`)
    const res = await callTool('get_lore_section', { key: 'section:long', sections: ['Notes'] })
    expect((res.result.sections['Notes'] as string).length).toBeGreaterThan(50000)
    expect(res.result.sections['Notes']).not.toContain('Done.')
  })

  it('mixed # and ## headings: # is not a boundary, ## is', async () => {
    await seedKV('section:mixed-hash', '# Title Block\nSome preamble text.\n\n## Section A\nContent.')
    const res = await callTool('get_lore_section', { key: 'section:mixed-hash', sections: ['Section A'] })
    expect(res.result.sections['Section A']).toBe('Content.')
    expect(res.result.not_found).not.toContain('Section A')
  })

  it('strict mode does not strip trailing colon', async () => {
    await seedKV('section:strict', '## Personality:\nCurious.')
    const res = await callTool('get_lore_section', { key: 'section:strict', sections: ['Personality'], mode: 'strict' })
    // In strict mode, "Personality" does NOT match "Personality:" — colon is not stripped
    expect(res.result.not_found).toContain('Personality')
  })

  it('strict mode matches when heading and request are identical (case-insensitive)', async () => {
    await seedKV('section:strict-match', '## Personality\nCurious.')
    const res = await callTool('get_lore_section', { key: 'section:strict-match', sections: ['PERSONALITY'], mode: 'strict' })
    expect(res.result.sections['PERSONALITY']).toBe('Curious.')
  })

  it('result includes version from lore metadata', async () => {
    await seedKV('section:version', '## Notes\nSome notes.')
    const res = await callTool('get_lore_section', { key: 'section:version', sections: ['Notes'] })
    expect(res.result.version).toBe(1)
  })

  it('result includes key', async () => {
    await seedKV('section:key-check', '## Notes\nSome notes.')
    const res = await callTool('get_lore_section', { key: 'section:key-check', sections: ['Notes'] })
    expect(res.result.key).toBe('section:key-check')
  })
})

// ── append_to_section ─────────────────────────────────────────────────────────

describe('append_to_section', () => {
  it('appends to end of populated section (default position)', async () => {
    await seedKV('ats:populated', '## Personality\nCurious and kind.\n## Goals\nFind truth.')
    const res = await callTool('append_to_section', { key: 'ats:populated', section: 'Personality', text: 'Loyal to companions.' })
    expect(res.result.action).toBe('appended')
    expect(res.result.position).toBe('end')
    const get = await callTool('get_lore', { query: 'ats:populated' })
    expect(get.result.text).toContain('Curious and kind. Loyal to companions.')
    expect(get.result.text).toContain('## Goals\nFind truth.')
  })

  it('prepends to start of section', async () => {
    await seedKV('ats:prepend', '## Personality\nCurious and kind.\n## Goals\nFind truth.')
    const res = await callTool('append_to_section', { key: 'ats:prepend', section: 'Personality', text: 'A former novice. ', position: 'start' })
    expect(res.result.action).toBe('prepended')
    const get = await callTool('get_lore', { query: 'ats:prepend' })
    expect(get.result.text).toContain('A former novice. Curious and kind.')
  })

  it('replaced_empty action when section has no content', async () => {
    await seedKV('ats:empty-sec', '## Notes\n\n## Goals\nFind truth.')
    const res = await callTool('append_to_section', { key: 'ats:empty-sec', section: 'Notes', text: 'First observation.' })
    expect(res.result.action).toBe('replaced_empty')
    const get = await callTool('get_lore', { query: 'ats:empty-sec' })
    expect(get.result.text).toContain('## Notes\nFirst observation.')
  })

  it('creates section when not found and auto_create is true (default)', async () => {
    await seedKV('ats:create', '## Personality\nCurious.\n## Goals\nFind truth.')
    const res = await callTool('append_to_section', { key: 'ats:create', section: 'Inventory', text: 'rations×3' })
    expect(res.result.action).toBe('created')
    expect(res.result.warnings).toContain('section_created')
    const get = await callTool('get_lore', { query: 'ats:create' })
    expect(get.result.text).toContain('## Inventory\nrations×3')
  })

  it('returns section_not_found when auto_create is false and section missing', async () => {
    await seedKV('ats:no-create', '## Personality\nCurious.')
    const res = await callTool('append_to_section', { key: 'ats:no-create', section: 'Inventory', text: 'rations', auto_create: false })
    expect(res.result.error).toBe('section_not_found')
    expect(res.result.hint).toBeDefined()
  })

  it('targets first occurrence for duplicate section, adds duplicate_section warning', async () => {
    await seedKV('ats:dup', '## Notes\nFirst note.\n## Personality\nKind.\n## Notes\nSecond note.')
    const res = await callTool('append_to_section', { key: 'ats:dup', section: 'Notes', text: 'Additional.' })
    expect(res.result.warnings).toContain('duplicate_section')
    const text = (await callTool('get_lore', { query: 'ats:dup' })).result.text as string
    expect(text).toContain('First note.')
    expect(text).toContain('Additional.')
    // Second Notes section untouched
    const secondIdx = text.indexOf('## Notes', text.indexOf('## Notes') + 1)
    expect(text.slice(secondIdx)).toContain('Second note.')
    expect(text.slice(secondIdx)).not.toContain('Additional.')
  })

  it('handles last section running to EOF without trailing heading', async () => {
    await seedKV('ats:eof', '## Section A\nContent A\n## Section B\nContent B')
    const res = await callTool('append_to_section', { key: 'ats:eof', section: 'Section B', text: 'More B.' })
    expect(res.result.action).toBe('appended')
    const text = (await callTool('get_lore', { query: 'ats:eof' })).result.text as string
    expect(text).toContain('Content B')
    expect(text).toContain('More B.')
    expect(text).toContain('## Section A\nContent A')
  })

  it('text starting with newline inserts as new paragraph', async () => {
    await seedKV('ats:newpara', '## Notes\nLine one.\nLine two.')
    await callTool('append_to_section', { key: 'ats:newpara', section: 'Notes', text: '\n\nLine three.' })
    const text = (await callTool('get_lore', { query: 'ats:newpara' })).result.text as string
    expect(text).toContain('Line two.\n\nLine three.')
  })

  it('appending a single word adds a space between existing text and new text', async () => {
    await seedKV('ats:word', '## Personality\nBrave.')
    await callTool('append_to_section', { key: 'ats:word', section: 'Personality', text: 'Loyal.' })
    const text = (await callTool('get_lore', { query: 'ats:word' })).result.text as string
    expect(text).toContain('Brave. Loyal.')
  })

  it('empty text returns empty_text error without mutating entry', async () => {
    await seedKV('ats:empty-text', '## Personality\nCurious.')
    const res = await callTool('append_to_section', { key: 'ats:empty-text', section: 'Personality', text: '' })
    expect(res.result.error).toBe('empty_text')
    expect((await callTool('get_lore', { query: 'ats:empty-text' })).result.text).toBe('## Personality\nCurious.')
  })

  it('whitespace-only text returns empty_text error', async () => {
    await seedKV('ats:ws-text', '## Personality\nCurious.')
    const res = await callTool('append_to_section', { key: 'ats:ws-text', section: 'Personality', text: '   ' })
    expect(res.result.error).toBe('empty_text')
  })

  it('very long append succeeds without truncation', async () => {
    const longText = 'word '.repeat(2000).trim()
    await seedKV('ats:long', '## Notes\nFirst.')
    const res = await callTool('append_to_section', { key: 'ats:long', section: 'Notes', text: '\n' + longText })
    expect(res.result.action).toBe('appended')
    const text = (await callTool('get_lore', { query: 'ats:long' })).result.text as string
    expect(text.length).toBeGreaterThan(longText.length)
    expect(text).toContain('word word word')
  })

  it('section name with special characters (parens, hyphens) matches correctly', async () => {
    await seedKV('ats:special', '## Weight-1 (Predator Drive):\n0.85')
    const res = await callTool('append_to_section', { key: 'ats:special', section: 'Weight-1 (Predator Drive)', text: ' Updated: 0.90' })
    expect(res.result.action).toBe('appended')
    const text = (await callTool('get_lore', { query: 'ats:special' })).result.text as string
    expect(text).toContain('0.85 Updated: 0.90')
  })

  it('substring section name does not false-match longer name', async () => {
    await seedKV('ats:substr', '## Goals\nShort term.\n## Goals (Completed)\nDone.')
    await callTool('append_to_section', { key: 'ats:substr', section: 'Goals', text: ' New goal.' })
    const text = (await callTool('get_lore', { query: 'ats:substr' })).result.text as string
    expect(text).toContain('Short term. New goal.')
    expect(text).toContain('## Goals (Completed)\nDone.')
  })

  it('trailing colon on heading is stripped for matching', async () => {
    await seedKV('ats:colon', '## Personality:\nCurious.')
    const res = await callTool('append_to_section', { key: 'ats:colon', section: 'Personality', text: ' Loyal.' })
    expect(res.result.action).toBe('appended')
    expect((await callTool('get_lore', { query: 'ats:colon' })).result.text).toContain('Curious. Loyal.')
  })

  it('no ## headings + auto_create true creates section at end', async () => {
    await seedKV('ats:no-headings', 'Just a flat paragraph with no structure.')
    const res = await callTool('append_to_section', { key: 'ats:no-headings', section: 'Personality', text: 'Curious.', auto_create: true })
    expect(res.result.action).toBe('created')
    expect((await callTool('get_lore', { query: 'ats:no-headings' })).result.text).toContain('## Personality\nCurious.')
  })

  it('no ## headings + auto_create false returns section_not_found', async () => {
    await seedKV('ats:no-headings-nc', 'Just flat text.')
    const res = await callTool('append_to_section', { key: 'ats:no-headings-nc', section: 'Personality', text: 'Curious.', auto_create: false })
    expect(res.result.error).toBe('section_not_found')
  })

  it('unicode and emoji in section name match correctly', async () => {
    await seedKV('ats:unicode', "## État d'Esprit 😤\nFrustrated.")
    const res = await callTool('append_to_section', { key: 'ats:unicode', section: "État d'Esprit 😤", text: ' And hopeful.' })
    expect(res.result.action).toBe('appended')
    expect((await callTool('get_lore', { query: 'ats:unicode' })).result.text).toContain('Frustrated. And hopeful.')
  })

  it('text containing ## strings is stored as literal content, not parsed as section boundaries', async () => {
    await seedKV('ats:hash-in-text', '## Notes\nFirst note.')
    await callTool('append_to_section', { key: 'ats:hash-in-text', section: 'Notes', text: '\n## This is NOT a heading\nJust content.' })
    const text = (await callTool('get_lore', { query: 'ats:hash-in-text' })).result.text as string
    expect(text).toContain('## This is NOT a heading')
    expect(text).toContain('Just content.')
    expect(text.startsWith('## Notes\n')).toBe(true)
  })

  it('non-existent key returns key_not_found error', async () => {
    const res = await callTool('append_to_section', { key: 'character:does-not-exist-ats-99999', section: 'Personality', text: 'Text.' })
    expect(res.result.error).toBe('key_not_found')
  })

  it('consecutive appends accumulate correctly (no stale-cache issue)', async () => {
    await seedKV('ats:consec', '## Notes\nFirst.')
    await callTool('append_to_section', { key: 'ats:consec', section: 'Notes', text: ' Second.' })
    await callTool('append_to_section', { key: 'ats:consec', section: 'Notes', text: ' Third.' })
    expect((await callTool('get_lore', { query: 'ats:consec' })).result.text).toContain('First. Second. Third.')
  })

  it('auto-created section is placed after all existing content including trailing loose text', async () => {
    await seedKV('ats:trailing', '## Section A\nContent.\n\nTrailing loose text without a heading.')
    const res = await callTool('append_to_section', { key: 'ats:trailing', section: 'NewSection', text: 'New content.' })
    expect(res.result.action).toBe('created')
    const text = (await callTool('get_lore', { query: 'ats:trailing' })).result.text as string
    expect(text).toContain('Trailing loose text without a heading.')
    expect(text).toContain('## NewSection\nNew content.')
    expect(text.indexOf('## NewSection')).toBeGreaterThan(text.indexOf('Trailing loose text'))
  })

  it('response shape has key, section, action, position, new_version, bytes_added, warnings', async () => {
    await seedKV('ats:shape', '## Notes\nExisting.')
    const res = await callTool('append_to_section', { key: 'ats:shape', section: 'Notes', text: ' More.' })
    expect(res.result.key).toBe('ats:shape')
    expect(res.result.section).toBe('Notes')
    expect(res.result.action).toBe('appended')
    expect(res.result.position).toBe('end')
    expect(res.result.new_version).toBe(2)
    expect(typeof res.result.bytes_added).toBe('number')
    expect(res.result.bytes_added).toBeGreaterThan(0)
    expect(Array.isArray(res.result.warnings)).toBe(true)
  })

  it('mutation is reversible via restore_lore', async () => {
    await seedKV('ats:restore', '## Notes\nOriginal content.')
    await callTool('append_to_section', { key: 'ats:restore', section: 'Notes', text: ' Appended.' })
    await callTool('restore_lore', { key: 'ats:restore' })
    expect((await callTool('get_lore', { query: 'ats:restore' })).result.text).toBe('## Notes\nOriginal content.')
  })
})
