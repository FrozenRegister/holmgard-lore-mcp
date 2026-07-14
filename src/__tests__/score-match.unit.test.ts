// Fast unit tier (vitest.unit.config.ts) — no miniflare boot. See
// docs/testing-and-linting-guide.md for how this relates to the integration
// suite in src/__tests__/*.test.ts.
import { describe, expect, it } from 'vitest'
import { scoreMatch } from '../tools/system'

describe('scoreMatch', () => {
  it('scores an exact match as 1.0', () => {
    expect(scoreMatch('character:zira', 'character:zira')).toBe(1.0)
  })

  it('scores a prefix match as 0.9', () => {
    expect(scoreMatch('character', 'character:zira')).toBe(0.9)
  })

  it('scores a contiguous substring match between 0.5 and 0.85, scaled by length ratio', () => {
    const score = scoreMatch('zira', 'character:zira')
    expect(score).toBeCloseTo(4 / 14 + 0.5, 10)
    expect(score).toBeLessThanOrEqual(0.85)
  })

  it('caps the substring score at 0.85 for a long match relative to a short candidate', () => {
    expect(scoreMatch('abcdefghij', 'xabcdefghij')).toBe(0.85)
  })

  it('scores an initials/acronym match as 0.7', () => {
    expect(scoreMatch('zk', 'character:zira-khal')).toBe(0.7)
  })

  it('scores no match as 0', () => {
    expect(scoreMatch('xyz', 'character:zira')).toBe(0)
  })
})
