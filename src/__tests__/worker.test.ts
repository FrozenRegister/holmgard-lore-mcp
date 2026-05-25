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

  it('tools/list returns exactly 19 tools', async () => {
    const res = await rpc('tools/list')
    const tools = res.result.tools as Array<{ name: string }>
    expect(tools).toHaveLength(19)
    const names = tools.map((t) => t.name)
    expect(names).toContain('ping_tool')
    expect(names).toContain('list_topics')
    expect(names).toContain('get_lore')
    expect(names).toContain('set_lore')
    expect(names).toContain('delete_lore')
    expect(names).toContain('get_lore_batch')
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

  it('caps history at 5 — oldest entry is dropped on the 6th write', async () => {
    await seedKV('restore:cap', 'v0')
    for (let i = 1; i <= 6; i++) {
      await callTool('set_lore', { key: 'restore:cap', text: `v${i}` })
    }
    // Restore 5 times — should reach v2 (v1 was evicted)
    for (let i = 0; i < 5; i++) {
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

  it('always succeeds when P=1 (high W1, zero W2)', async () => {
    // P = (10 * 0.7) - (0 * 0.3) = 7.0, clamped to 1.0 → roll always < 1
    await seedKV('character:strong', '**Weight-1:** 10\n**State-Level:** 0')
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

  it('always fails when P=0 (zero W1, high W2)', async () => {
    // P = (0 * 0.7) - (10 * 0.3) = -3.0, clamped to 0 → roll always >= 0
    await seedKV('character:zero-attacker', '**Weight-1:** 0')
    await seedKV('character:strong-defender', '**Weight-2:** 10')
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
    await seedKV('character:winner', '**Weight-1:** 10\n**State-Level:** 5')
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
    await seedKV('character:guaranteed-fail', '**Weight-1:** 0\n**State-Level:** 3')
    await seedKV('character:guaranteed-win', '**Weight-2:** 10')
    await callTool('resolve_interaction', {
      entity_a_id: 'character:guaranteed-fail',
      entity_b_id: 'character:guaranteed-win',
      action_type: 'consume',
    })
    const get = await callTool('get_lore', { query: 'character:guaranteed-fail' })
    expect(get.result.text).toContain('**State-Level:** 3')
  })

  it('returns metadata with weight_1, weight_2, probability, and roll', async () => {
    await seedKV('character:meta-a', '**Weight-1:** 6')
    await seedKV('character:meta-b', '**Weight-2:** 2')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'character:meta-a',
      entity_b_id: 'character:meta-b',
      action_type: 'test-action',
    })
    expect(res.result.metadata.weight_1).toBe(6)
    expect(res.result.metadata.weight_2).toBe(2)
    expect(typeof res.result.metadata.probability).toBe('number')
    expect(typeof res.result.metadata.roll).toBe('number')
    expect(res.result.metadata.action_type).toBe('test-action')
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
    // P = (0.9 * 0.7) - (0.1 * 0.3) = 0.63 - 0.03 = 0.60 — should not error
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
})

// ── analyze_utility ───────────────────────────────────────────────────────────

describe('analyze_utility', () => {
  it('returns error when entity not found', async () => {
    const res = await callTool('analyze_utility', { entity_id: 'nonexistent:entity', utility_vector: 'VECTOR_A' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('returns Grade D when entity has no numeric fields', async () => {
    await seedKV('character:blank', 'No numeric fields here.')
    const res = await callTool('analyze_utility', { entity_id: 'character:blank', utility_vector: 'VECTOR_E' })
    expect(res.result.grade).toBe('Grade D')
    expect(res.result.compatibility_score).toBe('0%')
  })

  it('returns Grade S when all four fields are equal and high (VECTOR_E)', async () => {
    // VECTOR_E is balanced [0.25, 0.25, 0.25, 0.25]; with all 4 fields equal, score = 100
    await seedKV('character:perfect', '**Field-1:** 100\n**Field-2:** 100\n**Field-3:** 100\n**Field-4:** 100')
    const res = await callTool('analyze_utility', { entity_id: 'character:perfect', utility_vector: 'VECTOR_E' })
    expect(res.result.grade).toBe('Grade S')
    expect(res.result.compatibility_score).toBe('100%')
  })

  it('VECTOR_A heavily weights the first field', async () => {
    // First field dominates (w=0.5); second field is minimal (w=0.3); third/fourth nearly 0
    await seedKV('character:vector-a-test', '**Power:** 100\n**Support:** 10\n**Stealth:** 5\n**Endurance:** 5')
    const res = await callTool('analyze_utility', { entity_id: 'character:vector-a-test', utility_vector: 'VECTOR_A' })
    expect(res.result.grade).not.toBe('Grade D')
    expect(res.result.metadata.fields_analyzed).toContain('Power')
  })

  it('grade is one of the five valid strings', async () => {
    await seedKV('character:grade-check', '**X:** 50\n**Y:** 25')
    const res = await callTool('analyze_utility', { entity_id: 'character:grade-check', utility_vector: 'VECTOR_B' })
    expect(['Grade S', 'Grade A', 'Grade B', 'Grade C', 'Grade D']).toContain(res.result.grade)
  })

  it('compatibility_score is a percentage string', async () => {
    await seedKV('character:pct-check', '**A:** 40\n**B:** 60')
    const res = await callTool('analyze_utility', { entity_id: 'character:pct-check', utility_vector: 'VECTOR_C' })
    expect(res.result.compatibility_score).toMatch(/^\d+%$/)
  })

  it('projected_yield differs across vectors', async () => {
    await seedKV('character:vector-compare', '**F1:** 50\n**F2:** 50\n**F3:** 50\n**F4:** 50')
    const [rA, rD] = await Promise.all([
      callTool('analyze_utility', { entity_id: 'character:vector-compare', utility_vector: 'VECTOR_A' }),
      callTool('analyze_utility', { entity_id: 'character:vector-compare', utility_vector: 'VECTOR_D' }),
    ])
    expect(rA.result.projected_yield).not.toBe(rD.result.projected_yield)
  })

  it('fields_analyzed metadata lists found field names', async () => {
    await seedKV('character:fields-meta', '**Strength:** 80\n**Speed:** 60\n**Status:** active')
    const res = await callTool('analyze_utility', { entity_id: 'character:fields-meta', utility_vector: 'VECTOR_A' })
    expect(res.result.metadata.fields_analyzed).toContain('Strength')
    expect(res.result.metadata.fields_analyzed).toContain('Speed')
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
