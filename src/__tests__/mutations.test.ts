import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

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

