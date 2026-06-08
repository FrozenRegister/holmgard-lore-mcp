import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

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

