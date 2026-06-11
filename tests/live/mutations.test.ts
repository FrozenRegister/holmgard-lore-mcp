import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MCP_API_KEY, tool, uid, setLore, deleteLore } from './helpers'

describe.skipIf(!MCP_API_KEY)('Field Increment', () => {
  let key: string

  beforeEach(async () => {
    key = `test:increment-${uid()}`
    await setLore(key, '**Status:** Test\n**days_remaining:** 10\n**character:** test-subject')
  })

  afterEach(async () => { await deleteLore(key) })

  it('increment_topic_field decrements numeric fields', async () => {
    const res = await tool('lore_manage', {
      action: 'increment', key, field_path: 'days_remaining', increment: -1, reason: 'daily-decrement',
    })
    expect(res.error).toBeUndefined()
  })

  it('increment_topic_field handles negative increments', async () => {
    const res = await tool('lore_manage', {
      action: 'increment', key, field_path: 'days_remaining', increment: -2, reason: 'accelerated-decay',
    })
    expect(res.error).toBeUndefined()
  })
})

describe.skipIf(!MCP_API_KEY)('Patch Operations', () => {
  let key: string

  beforeEach(async () => {
    key = `test:patch-${uid()}`
    await setLore(key, 'Status: Alive\nDays: 14')
  })

  afterEach(async () => { await deleteLore(key) })

  it('patch_lore replace operation', async () => {
    const res = await tool('lore_manage', {
      action: 'patch', key, operation: 'replace', target: 'Status: Alive', value: 'Status: Sedated',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/Replaced 1 occurrence/)
  })

  it('patch_lore replace detects missing target', async () => {
    const res = await tool('lore_manage', {
      action: 'patch', key, operation: 'replace', target: 'Nonexistent', value: 'X',
    })
    expect(res.result.content[0].text).toMatch(/not found/)
  })

  it('patch_lore append operation', async () => {
    const res = await tool('lore_manage', {
      action: 'patch', key, operation: 'append', value: '\nAppended line',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/Appended to end/)
  })

  it('patch_lore detects ambiguous targets', async () => {
    const ambig = `test:patch-ambig-${uid()}`
    await setLore(ambig, 'the cat chased the cat')
    try {
      const res = await tool('lore_manage', {
        action: 'patch', key: ambig, operation: 'replace', target: 'the cat', value: 'a dog',
      })
      expect(res.result.content[0].text).toMatch(/Ambiguous/)
    } finally {
      await deleteLore(ambig)
    }
  })

  it('patch_lore returns error for missing key', async () => {
    const res = await tool('lore_manage', {
      action: 'patch', key: 'nonexistent:key-99999', operation: 'replace', target: 'X', value: 'Y',
    })
    expect(res.result.content[0].text).toMatch(/not found/)
  })
})

describe.skipIf(!MCP_API_KEY)('Batch Operations', () => {
  let alpha: string
  let beta: string

  beforeEach(() => {
    alpha = `test:batch-alpha-${uid()}`
    beta = `test:batch-beta-${uid()}`
  })

  afterEach(async () => { await deleteLore(alpha, beta) })

  it('batch_set_lore writes multiple entries', async () => {
    const res = await tool('lore_manage', {
      action: 'batch_set',
      entries: [
        { key: alpha, text: 'Alpha batch content.' },
        { key: beta, text: 'Beta batch content.' },
      ],
    })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/Saved 2/)
  })

  it('batch_set_lore written entries are retrievable', async () => {
    await tool('lore_manage', {
      action: 'batch_set',
      entries: [
        { key: alpha, text: 'Alpha batch content.' },
        { key: beta, text: 'Beta batch content.' },
      ],
    })
    const res = await tool('lore_manage', { action: 'get', query: alpha })
    expect(res.result.content[0].text).toMatch(/Alpha batch content/)
  })

  it('batch_mutate applies mutations sequentially', async () => {
    await tool('lore_manage', {
      action: 'batch_set',
      entries: [
        { key: alpha, text: 'Alpha batch content.' },
        { key: beta, text: 'Beta batch content.' },
      ],
    })
    const res = await tool('lore_manage', {
      action: 'batch_mutate',
      mutations: [
        { key: alpha, action: 'patch', operation: 'replace', target: 'Alpha batch content.', value: 'Alpha mutated.' },
        { key: beta, action: 'patch', operation: 'append', value: '\nAppended line.' },
      ],
    })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/Applied 2/)
  })

  it('batch_mutate mutations persist', async () => {
    await tool('lore_manage', {
      action: 'batch_set',
      entries: [
        { key: alpha, text: 'Alpha batch content.' },
        { key: beta, text: 'Beta batch content.' },
      ],
    })
    await tool('lore_manage', {
      action: 'batch_mutate',
      mutations: [
        { key: alpha, action: 'patch', operation: 'replace', target: 'Alpha batch content.', value: 'Alpha mutated.' },
        { key: beta, action: 'patch', operation: 'append', value: '\nAppended line.' },
      ],
    })
    const res = await tool('lore_manage', { action: 'get', query: alpha })
    expect(res.result.content[0].text).toMatch(/Alpha mutated/)
  })
})
