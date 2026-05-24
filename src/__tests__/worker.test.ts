import { env, SELF, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Clean all KV storage after every test to prevent state leakage.
afterEach(() => reset())

// ── Helpers ───────────────────────────────────────────────────────────────────

async function rpc(method: string, params?: unknown) {
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

  it('tools/list returns exactly 13 tools', async () => {
    const res = await rpc('tools/list')
    const tools = res.result.tools as Array<{ name: string }>
    expect(tools).toHaveLength(13)
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
