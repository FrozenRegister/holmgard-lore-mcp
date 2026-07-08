import { describe, it, expect } from 'vitest'
import { scoreMatch, findCloseMatches } from './fuzzy-match'

describe('fuzzy-match', () => {
  describe('scoreMatch', () => {
    it('exact match scores 1.0', () => {
      expect(scoreMatch('list_topics', 'list_topics')).toBe(1.0)
      expect(scoreMatch('test', 'test')).toBe(1.0)
    })

    it('prefix match scores 0.95', () => {
      expect(scoreMatch('list', 'list_topics')).toBe(0.95)
      expect(scoreMatch('get', 'get_lore_batch')).toBe(0.95)
    })

    it('suffix match scores 0.9', () => {
      expect(scoreMatch('topics', 'list_topics')).toBe(0.9)
      expect(scoreMatch('batch', 'get_lore_batch')).toBe(0.9)
    })

    it('normalized match (underscores stripped) scores 0.9', () => {
      expect(scoreMatch('listtopics', 'list_topics')).toBeGreaterThanOrEqual(0.85)
      expect(scoreMatch('list-topics', 'list_topics')).toBeGreaterThanOrEqual(0.85)
    })

    it('normalized prefix match scores 0.85', () => {
      // Query "list_top" normalized is "listtop", candidate "list-topics" normalized is "listtopics"
      // Non-normalized: "list_top" doesn't start with "list-topics"
      // Normalized: "listtop" DOES start with "listtopics" prefix
      expect(scoreMatch('list_top', 'list-topics')).toBe(0.85)
      expect(scoreMatch('get_lo', 'get-lore')).toBe(0.85)
    })

    it('substring match scores lower', () => {
      const score = scoreMatch('topic', 'list_topics')
      expect(score).toBeGreaterThan(0.5)
      expect(score).toBeLessThan(0.85)
    })

    it('typos are scored by levenshtein distance', () => {
      // One character difference
      const oneChar = scoreMatch('list_topix', 'list_topics')
      expect(oneChar).toBeGreaterThan(0.7)

      // Two character differences
      const twoChar = scoreMatch('list_toppics', 'list_topics')
      expect(twoChar).toBeGreaterThan(0.6)

      // Many differences
      const many = scoreMatch('xyz', 'list_topics')
      expect(many).toBeLessThan(0.5)
    })

    it('case-insensitive', () => {
      expect(scoreMatch('LIST_TOPICS', 'list_topics')).toBe(1.0)
      expect(scoreMatch('LiSt', 'list_topics')).toBe(0.95)
    })

    it('short queries are more lenient', () => {
      // "st" is short (2 chars), so even loose matches score OK (but still weighted down)
      const shortMatch = scoreMatch('st', 'list_topics')
      expect(shortMatch).toBeGreaterThan(0.5)
      expect(shortMatch).toBeLessThan(0.8)

      // "search" is longer, so more strict
      const longMatch = scoreMatch('search', 'list_topics')
      expect(longMatch).toBeLessThan(0.5)
    })
  })

  describe('findCloseMatches', () => {
    const candidates = ['list_topics', 'get_lore', 'set_lore', 'delete_lore', 'patch_lore', 'search_lore']

    it('finds exact match first', () => {
      const results = findCloseMatches('list_topics', candidates)
      expect(results[0].name).toBe('list_topics')
      expect(results[0].score).toBe(1.0)
    })

    it('finds prefix match high in results', () => {
      const results = findCloseMatches('list', candidates)
      expect(results[0].name).toBe('list_topics')
      expect(results[0].score).toBe(0.95)
    })

    it('finds close typos', () => {
      const results = findCloseMatches('list_topix', candidates)
      expect(results[0].name).toBe('list_topics')
      expect(results[0].score).toBeGreaterThan(0.7)
    })

    it('filters by minScore threshold', () => {
      const results = findCloseMatches('xyz', candidates, 0.7)
      expect(results.length).toBe(0)
    })

    it('respects limit parameter', () => {
      const results = findCloseMatches('_lore', candidates, 0.4, 2)
      expect(results.length).toBeLessThanOrEqual(2)
    })

    it('sorts by score descending', () => {
      const results = findCloseMatches('lore', candidates)
      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score)
      }
    })

    it('handles hyphens like underscores', () => {
      const results = findCloseMatches('get-lore', candidates)
      expect(results[0].name).toBe('get_lore')
    })

    it('returns empty list for very dissimilar queries', () => {
      const results = findCloseMatches('zzzzz', candidates, 0.5)
      expect(results.length).toBe(0)
    })
  })
})
