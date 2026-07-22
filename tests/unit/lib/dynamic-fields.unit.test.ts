import { describe, it, expect } from 'vitest'
import { applyDynamicFields } from '@/rpg/utils/dynamic-fields'

describe('applyDynamicFields (#425)', () => {
  it('appends accepted fields to sets/vals and reports them applied', () => {
    const sets: string[] = ['updated_at = ?']
    const vals: unknown[] = ['2026-01-01']
    const { applied, rejected } = applyDynamicFields({ alias: 'Ghost', age: 30 }, ['id', 'created_at', 'updated_at'], sets, vals)
    expect(rejected).toEqual([])
    expect(applied).toEqual(['alias', 'age'])
    expect(sets).toEqual(['updated_at = ?', 'alias = ?', 'age = ?'])
    expect(vals).toEqual(['2026-01-01', 'Ghost', 30])
  })

  it('returns empty applied/rejected and mutates nothing when fields is undefined', () => {
    const sets: string[] = ['updated_at = ?']
    const vals: unknown[] = ['now']
    const { applied, rejected } = applyDynamicFields(undefined, ['id'], sets, vals)
    expect(applied).toEqual([])
    expect(rejected).toEqual([])
    expect(sets).toEqual(['updated_at = ?'])
    expect(vals).toEqual(['now'])
  })

  it('rejects blacklisted columns without applying them', () => {
    const sets: string[] = []
    const vals: unknown[] = []
    const { applied, rejected } = applyDynamicFields({ id: 'sneaky', created_at: 'sneaky', alias: 'ok' }, ['id', 'created_at', 'updated_at'], sets, vals)
    expect(rejected).toEqual([
      { field: 'id', reason: 'blacklisted' },
      { field: 'created_at', reason: 'blacklisted' },
    ])
    expect(applied).toEqual(['alias'])
    expect(sets).toEqual(['alias = ?'])
    expect(vals).toEqual(['ok'])
  })

  it('rejects column names that fail the safe-identifier shape (SQL injection boundary)', () => {
    const sets: string[] = []
    const vals: unknown[] = []
    const { applied, rejected } = applyDynamicFields(
      { 'name; DROP TABLE characters;--': 'x', '1leading_digit': 'x', 'Has-Dash': 'x', UPPERCASE: 'x', '': 'x' },
      [],
      sets,
      vals,
    )
    expect(applied).toEqual([])
    expect(rejected).toHaveLength(5)
    expect(rejected.every(r => r.reason === 'invalid column name')).toBe(true)
    expect(sets).toEqual([])
    expect(vals).toEqual([])
  })

  it('lets an already-claimed explicit param silently win over the same key in fields', () => {
    const sets: string[] = ['name = ?']
    const vals: unknown[] = ['Explicit Name']
    const { applied, rejected } = applyDynamicFields({ name: 'Passthrough Name', alias: 'Ghost' }, ['id'], sets, vals)
    expect(rejected).toEqual([])
    expect(applied).toEqual(['alias']) // 'name' silently skipped — already claimed
    expect(sets).toEqual(['name = ?', 'alias = ?'])
    expect(vals).toEqual(['Explicit Name', 'Ghost'])
  })

  it('accepts single-character and underscore-heavy column names', () => {
    const sets: string[] = []
    const vals: unknown[] = []
    const { applied, rejected } = applyDynamicFields({ q: 1, state_stage_timer: 5, _leading_underscore: 'x' }, [], sets, vals)
    expect(rejected).toEqual([{ field: '_leading_underscore', reason: 'invalid column name' }])
    expect(applied).toEqual(['q', 'state_stage_timer'])
    expect(sets).toEqual(['q = ?', 'state_stage_timer = ?'])
  })

  it('handles an empty blacklist', () => {
    const sets: string[] = []
    const vals: unknown[] = []
    const { applied, rejected } = applyDynamicFields({ anything: 'goes' }, [], sets, vals)
    expect(rejected).toEqual([])
    expect(applied).toEqual(['anything'])
    expect(sets).toEqual(['anything = ?'])
  })
})
