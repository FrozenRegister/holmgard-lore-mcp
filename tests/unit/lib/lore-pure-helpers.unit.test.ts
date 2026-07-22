// Fast unit tier (vitest.unit.config.ts) — no miniflare boot. See
// docs/testing-and-linting-guide.md for how this relates to the integration
// suite in tests/worker/**/*.test.ts.
import { describe, expect, it } from 'vitest'
import { countOccurrences, normalizeLocationKey, parseKvEntry } from '@/lib/lore'

describe('countOccurrences', () => {
  it('returns 0 for no occurrences', () => {
    expect(countOccurrences('hello world', 'xyz')).toBe(0)
  })

  it('counts non-overlapping occurrences', () => {
    expect(countOccurrences('ababab', 'ab')).toBe(3)
  })

  it('counts a single occurrence', () => {
    expect(countOccurrences('the quick brown fox', 'quick')).toBe(1)
  })

  it('does not count overlapping matches twice', () => {
    // 'aaaa' contains 'aa' at index 0 and 2 non-overlapping (indexOf advances past each match)
    expect(countOccurrences('aaaa', 'aa')).toBe(2)
  })
})

describe('parseKvEntry', () => {
  it('parses the current { text, meta } JSON format', () => {
    const raw = JSON.stringify({ text: 'hello', meta: { version: 2 } })
    expect(parseKvEntry(raw)).toEqual({ text: 'hello', meta: { version: 2 } })
  })

  it('defaults meta to {} when absent from valid JSON', () => {
    const raw = JSON.stringify({ text: 'hello' })
    expect(parseKvEntry(raw)).toEqual({ text: 'hello', meta: {} })
  })

  it('falls back to treating invalid JSON as plain legacy text', () => {
    expect(parseKvEntry('not json at all')).toEqual({ text: 'not json at all', meta: {} })
  })

  it('falls back to plain text when JSON is valid but has no text field', () => {
    const raw = JSON.stringify({ foo: 'bar' })
    expect(parseKvEntry(raw)).toEqual({ text: raw, meta: {} })
  })
})

describe('normalizeLocationKey', () => {
  it('lowercases and hyphenates a free-text location', () => {
    expect(normalizeLocationKey('Cave, North Ridge')).toBe('cave-north-ridge')
  })

  it('collapses repeated separators into a single hyphen', () => {
    expect(normalizeLocationKey('cave   --  north')).toBe('cave-north')
  })

  it('strips leading and trailing hyphens', () => {
    expect(normalizeLocationKey('  -Cave-  ')).toBe('cave')
  })

  it('preserves an already-canonical key', () => {
    expect(normalizeLocationKey('cave-north-ridge')).toBe('cave-north-ridge')
  })
})
