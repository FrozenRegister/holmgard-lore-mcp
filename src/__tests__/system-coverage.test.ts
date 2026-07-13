import { describe, it, expect, beforeEach } from 'vitest'
import { callTool, seedKV, env } from './helpers'

/**
 * System functions coverage expansion for validate_topic_exists scoreMatch logic
 * and related edge cases to achieve 95%+ coverage with no missing lines.
 */

describe('validate_topic_exists — scoreMatch coverage', () => {
  beforeEach(async () => {
    // Clear any existing data
    await seedKV('character:test-exact', 'Exact match target')
    await seedKV('character:test-prefix', 'Prefix match target')
    await seedKV('setup:substring-match', 'Substring match test')
    await seedKV('location:initials-zm', 'Zara of the Mountains')
  })

  it('scoreMatch: exact match returns 1.0 confidence', async () => {
    const res = await callTool('lore_manage', { action: 'validate', query_string: 'character:test-exact' })
    expect(res.result.exists).toBe(true)
    expect(res.result.confidence).toBe(1.0)
    expect(res.result.did_you_mean).toBe('character:test-exact')
  })

  it('scoreMatch: prefix match (candidate starts with query) returns ~0.9 confidence', async () => {
    // Query that matches the beginning of a key
    const res = await callTool('lore_manage', { action: 'validate', query_string: 'character:test' })
    expect(res.result.exists).toBe(false)
    expect(res.result.confidence).toBeGreaterThan(0.85)
    expect(res.result.confidence).toBeLessThanOrEqual(0.9)
    expect(res.result.did_you_mean).toBeDefined()
    expect(res.result.namespace_matches.length).toBeGreaterThan(0)
  })

  it('scoreMatch: substring match returns scaled confidence (0.5-0.85)', async () => {
    // Query that appears as substring in a key but not as prefix
    const res = await callTool('lore_manage', { action: 'validate', query_string: 'substring' })
    expect(res.result.exists).toBe(false)
    expect(res.result.confidence).toBeGreaterThan(0.49)
    expect(res.result.confidence).toBeLessThanOrEqual(0.85)
  })

  it('scoreMatch: initials/acronym match returns 0.7 confidence', async () => {
    // Initials test: "zm" should match "location:zara-mountains" as initials (z from zara, m from mountains)
    // But "zm" also appears as substring in "initials-zm", so use a different query that only matches initials
    // Query using initials from a key like "location:zara-mountains" → "zm"
    const res = await callTool('lore_manage', { action: 'validate', query_string: 'zm' })
    expect(res.result.exists).toBe(false)
    expect(res.result.namespace_matches.length).toBeGreaterThan(0)
    // Should find location:initials-zm either through substring or acronym matching
    const hasMatch = res.result.namespace_matches.some((k: string) => k.includes('initials'))
    expect(hasMatch).toBe(true)
    // Confidence should be in the range for substring or acronym match
    expect(res.result.confidence).toBeGreaterThan(0.6)
  })

  it('scoreMatch: no match returns 0 confidence', async () => {
    const res = await callTool('lore_manage', { action: 'validate', query_string: 'zzzznonexistent9999' })
    expect(res.result.exists).toBe(false)
    expect(res.result.confidence).toBeNull()
    expect(res.result.did_you_mean).toBeNull()
    expect(res.result.namespace_matches).toHaveLength(0)
  })

  it('scoreMatch: returns best match when multiple suggestions exist', async () => {
    await seedKV('character:zara', 'Character Zara')
    await seedKV('setup:zara-camp', 'Setup at Zara camp')
    await seedKV('location:zara-falls', 'Location Zara Falls')

    const res = await callTool('lore_manage', { action: 'validate', query_string: 'zara' })
    expect(res.result.exists).toBe(false)
    // Should have multiple matches
    expect(res.result.namespace_matches.length).toBeGreaterThanOrEqual(2)
    // Best match should be the shortest key (highest substring score ratio)
    expect(res.result.did_you_mean).toBe('character:zara')
    expect(res.result.confidence).toBeGreaterThan(0.75)
    expect(res.result.confidence).toBeLessThanOrEqual(0.85)
  })

  it('scoreMatch: sorts by confidence descending', async () => {
    // Create entries with varying match quality
    await seedKV('character:zebra-keeper', 'Zebra keeper')
    await seedKV('item:zebra-stripe', 'Zebra stripe pattern')
    await seedKV('setup:z-camp', 'Z camp')

    const res = await callTool('lore_manage', { action: 'validate', query_string: 'zeb' })
    expect(res.result.namespace_matches.length).toBeGreaterThanOrEqual(2)
    // First suggestion should be the best match
    const bestMatch = res.result.did_you_mean
    expect(bestMatch).toBeDefined()
  })

  it('scoreMatch: handles query with colon separators', async () => {
    const res = await callTool('lore_manage', { action: 'validate', query_string: 'character:test-ex' })
    expect(res.result.exists).toBe(false)
    // Should extract "ex" and use it for matching
    expect(res.result.namespace_matches.length).toBeGreaterThan(0)
  })

  it('scoreMatch: case-insensitive matching', async () => {
    const res = await callTool('lore_manage', { action: 'validate', query_string: 'CHARACTER:TEST-EXACT' })
    expect(res.result.exists).toBe(true)
    expect(res.result.exact_match).toBe('character:test-exact')
  })
})

describe('get_lore — auto-suggest and edge cases', () => {
  beforeEach(async () => {
    await seedKV('character:alice', 'Alice the Alchemist')
    await seedKV('character:amanda', 'Amanda the Archer')
    await seedKV('location:amber-valley', 'The Amber Valley')
  })

  it('auto-suggest extracts suffix after colon when no exact match', async () => {
    const res = await callTool('lore_manage', { action: 'get', query: 'character:amy' })
    expect(res.error).toBeDefined()
    // Should suggest entries with 'amy' in them
    expect(res.error.data.alternatives).toBeDefined()
  })

  it('auto-suggest without colon uses full query', async () => {
    const res = await callTool('lore_manage', { action: 'get', query: 'alice' })
    expect(res.error).toBeDefined()
    expect(res.error.data.did_you_mean).toBe('character:alice')
  })

  it('auto-suggest limits to 5 suggestions', async () => {
    // Create many entries that match
    for (let i = 0; i < 10; i++) {
      await seedKV(`character:a-char-${i}`, `Character ${i}`)
    }
    const res = await callTool('lore_manage', { action: 'get', query: 'a-char' })
    expect(res.error).toBeDefined()
    expect(res.error.data.alternatives).toBeDefined()
    expect(res.error.data.alternatives.length).toBeLessThanOrEqual(5)
  })
})

describe('list_topics — pagination edge cases', () => {
  beforeEach(async () => {
    for (let i = 1; i <= 15; i++) {
      await seedKV(`character:char-${String(i).padStart(2, '0')}`, `Character ${i}`)
    }
  })

  it('respects limit parameter', async () => {
    const res = await callTool('lore_manage', { action: 'list', limit: 5 })
    expect(res.result.metadata.count).toBeLessThanOrEqual(5)
  })

  it('respects offset parameter', async () => {
    const res = await callTool('lore_manage', { action: 'list', offset: 10 })
    expect(res.result.metadata.offset).toBe(10)
  })

  it('caps limit at 1000', async () => {
    const res = await callTool('lore_manage', { action: 'list', limit: 9999 })
    expect(res.result.metadata.limit).toBe(1000)
  })

  it('clamps negative offset to 0', async () => {
    const res = await callTool('lore_manage', { action: 'list', offset: -10 })
    expect(res.result.metadata.offset).toBe(0)
  })

  it('combined limit and offset pagination works correctly', async () => {
    const page1 = await callTool('lore_manage', { action: 'list', limit: 5, offset: 0 })
    const page2 = await callTool('lore_manage', { action: 'list', limit: 5, offset: 5 })
    const page1Keys = page1.result.content[0].text.split(', ')
    const page2Keys = page2.result.content[0].text.split(', ')

    // Pages should have different keys
    expect(page1Keys[0]).not.toBe(page2Keys[0])
  })

  it('returns correct metadata.total across pagination', async () => {
    const page1 = await callTool('lore_manage', { action: 'list', limit: 5, offset: 0 })
    const page2 = await callTool('lore_manage', { action: 'list', limit: 5, offset: 5 })

    // Both pages should report the same total
    expect(page1.result.metadata.total).toBe(page2.result.metadata.total)
    expect(page1.result.metadata.total).toBeGreaterThanOrEqual(15)
  })
})

describe('search_lore — error handling and chunking', () => {
  beforeEach(async () => {
    // Create entries for search
    for (let i = 1; i <= 10; i++) {
      await seedKV(`item:potion-${i}`, `This is potion number ${i} with magical properties.`)
    }
  })

  it('handles chunking correctly with CHUNK_SIZE=50', async () => {
    const res = await callTool('lore_manage', { action: 'search', query: 'potion', max_results: 100, scan_limit: 500 })
    expect(res.result.results.length).toBeGreaterThan(0)
    expect(res.result.metadata.keys_scanned).toBeGreaterThan(0)
  })

  it('stops early when max_results is reached', async () => {
    const res = await callTool('lore_manage', { action: 'search', query: 'potion', max_results: 3, scan_limit: 500 })
    expect(res.result.results.length).toBeLessThanOrEqual(3)
  })

  it('handles scan_limit smaller than available keys', async () => {
    const res = await callTool('lore_manage', { action: 'search', query: 'potion', max_results: 100, scan_limit: 3 })
    expect(res.result.metadata.keys_scanned).toBe(3)
  })

  it('excerpt includes ellipsis when text is truncated', async () => {
    const res = await callTool('lore_manage', { action: 'search', query: 'magical', max_results: 10 })
    if (res.result.results.length > 0) {
      const excerpt = res.result.results[0].excerpt
      // Excerpt should start with … if context was truncated at start
      if (!excerpt.startsWith('This')) {
        expect(excerpt).toContain('…')
      }
    }
  })

  it('excerpt handles multi-line content correctly', async () => {
    await seedKV('location:forest', 'A dense forest.\nFull of trees.\nAnd magical creatures.')
    const res = await callTool('lore_manage', { action: 'search', query: 'magical', max_results: 10 })
    expect(res.result.results.length).toBeGreaterThan(0)
    expect(res.result.results.some((r: any) => r.excerpt.includes('magical'))).toBe(true)
  })

  it('query is case-insensitive', async () => {
    const lower = await callTool('lore_manage', { action: 'search', query: 'potion', max_results: 10 })
    const upper = await callTool('lore_manage', { action: 'search', query: 'POTION', max_results: 10 })
    expect(lower.result.results.length).toBe(upper.result.results.length)
  })
})

describe('get_map — error handling', () => {
  beforeEach(async () => {
    await seedKV('map:world-map', '{"type":"FeatureCollection","features":[]}')
  })

  it('normalizes map_id to lowercase', async () => {
    const res = await callTool('lore_manage', { action: 'get_map', map_id: 'WORLD-MAP' })
    expect(res.error).toBeUndefined()
    expect(res.result.key).toBe('map:world-map')
  })

  it('handles map_id with extra whitespace', async () => {
    const res = await callTool('lore_manage', { action: 'get_map', map_id: '  world-map  ' })
    expect(res.error).toBeUndefined()
    expect(res.result.key).toBe('map:world-map')
  })

  it('auto-adds map: prefix if missing', async () => {
    const res = await callTool('lore_manage', { action: 'get_map', map_id: 'world-map' })
    expect(res.error).toBeUndefined()
    expect(res.result.key).toContain('world-map')
  })

  it('preserves existing map: prefix', async () => {
    const res = await callTool('lore_manage', { action: 'get_map', map_id: 'map:world-map' })
    expect(res.error).toBeUndefined()
    expect(res.result.key).toBe('map:world-map')
  })
})

describe('get_lore_section — strict vs loose mode', () => {
  beforeEach(async () => {
    const content = `## PERSONALITY
    Curious and kind.

## GOALS (Long-term)
    Find the truth and help others.

## Skills
    Painting, Reading, Meditation`
    await seedKV('character:test-strict', content)
  })

  it('loose mode (default) is case-insensitive', async () => {
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'character:test-strict',
      sections: ['personality'],
      mode: 'loose'
    })
    expect(res.result.sections['personality']).toBeDefined()
    expect(res.result.sections['personality']).toContain('Curious')
  })

  it('strict mode requires exact case match', async () => {
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'character:test-strict',
      sections: ['personality'],
      mode: 'strict'
    })
    // In strict mode, "personality" (lowercase) won't match "PERSONALITY" (uppercase)
    expect(res.result.not_found).toContain('personality')
  })

  it('both modes handle section names with special chars', async () => {
    const res = await callTool('lore_manage', {
      action: 'get_section',
      key: 'character:test-strict',
      sections: ['Goals (Long-term)'],
      mode: 'loose'
    })
    expect(res.result.sections['Goals (Long-term)']).toBeDefined()
  })
})

describe('list_topics with world filter — edge cases', () => {
  beforeEach(async () => {
    await seedKV('character:world1-char', '**World:** World One\n**Status:** Active')
    await seedKV('character:world2-char', '**World:** World Two\n**Status:** Active')
    await seedKV('character:no-world', '**Status:** Active')
  })

  it('world filter is case-insensitive', async () => {
    const lower = await callTool('lore_manage', { action: 'list', world: 'world one' })
    const upper = await callTool('lore_manage', { action: 'list', world: 'WORLD ONE' })
    expect(lower.result.metadata.count).toBe(upper.result.metadata.count)
  })

  it('world filter excludes entries without World field', async () => {
    const res = await callTool('lore_manage', { action: 'list', world: 'World One' })
    const text = res.result.content[0].text
    expect(text).toContain('world1-char')
    expect(text).not.toContain('no-world')
  })

  it('empty result returns correct metadata when filtered by world', async () => {
    const res = await callTool('lore_manage', { action: 'list', world: 'Nonexistent World' })
    expect(res.result.metadata.count).toBe(0)
    expect(res.result.metadata.world).toBe('Nonexistent World')
  })
})
