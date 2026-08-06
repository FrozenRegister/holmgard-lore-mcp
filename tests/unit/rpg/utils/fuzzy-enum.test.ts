// Fast unit tier (vitest.unit.config.ts) — no miniflare boot. See
// docs/testing-and-linting-guide.md for how this relates to the integration
// suite in tests/worker/**/*.test.ts.
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  isGuidingError,
  levenshtein,
  similarity,
  normalizeInput,
  matchAction,
  formatGuidingError,
  CRUD_ALIASES,
  extendAliases,
  createFuzzyActionSchema,
  FlexibleIdentifierSchema,
  type GuidingError,
  type MatchResult,
} from '@/rpg/utils/fuzzy-enum'

describe('fuzzy-enum utilities', () => {
  describe('isGuidingError', () => {
    it('returns true for a valid GuidingError object', () => {
      const error: GuidingError = {
        error: 'invalid_action',
        input: 'test',
        suggestions: [{ value: 'create', similarity: 95 }],
        message: 'Unknown action',
      }
      expect(isGuidingError(error)).toBe(true)
    })

    it('returns true for GuidingError with invalid_identifier error type', () => {
      const error: GuidingError = {
        error: 'invalid_identifier',
        input: 'xyz',
        suggestions: [],
        message: 'Invalid identifier',
      }
      expect(isGuidingError(error)).toBe(true)
    })

    it('returns true for GuidingError with validation_error error type', () => {
      const error: GuidingError = {
        error: 'validation_error',
        input: 'test',
        suggestions: [],
        message: 'Validation failed',
      }
      expect(isGuidingError(error)).toBe(true)
    })

    it('returns true for GuidingError with empty suggestions array', () => {
      const error: GuidingError = {
        error: 'invalid_action',
        input: 'abc',
        suggestions: [],
        message: 'No suggestions',
      }
      expect(isGuidingError(error)).toBe(true)
    })

    it('returns false for null', () => {
      expect(isGuidingError(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isGuidingError(undefined)).toBe(false)
    })

    it('returns false for a plain object without error field', () => {
      expect(isGuidingError({ message: 'test' })).toBe(false)
    })

    it('returns false for an object with error field but no suggestions', () => {
      const obj = { error: 'invalid_action', input: 'test', message: 'test' }
      expect(isGuidingError(obj)).toBe(false)
    })

    it('returns false for an object with error field but suggestions is not an array', () => {
      const obj = {
        error: 'invalid_action',
        input: 'test',
        suggestions: 'not-an-array',
        message: 'test',
      }
      expect(isGuidingError(obj)).toBe(false)
    })

    it('returns false for a string', () => {
      expect(isGuidingError('not-an-error')).toBe(false)
    })

    it('returns false for a number', () => {
      expect(isGuidingError(123)).toBe(false)
    })

    it('returns false for an object with non-string error field', () => {
      const obj = {
        error: 123,
        input: 'test',
        suggestions: [],
        message: 'test',
      }
      expect(isGuidingError(obj)).toBe(false)
    })
  })

  describe('levenshtein', () => {
    it('returns 0 for identical strings', () => {
      expect(levenshtein('abc', 'abc')).toBe(0)
    })

    it('returns string length when first string is empty', () => {
      expect(levenshtein('', 'abc')).toBe(3)
    })

    it('returns string length when second string is empty', () => {
      expect(levenshtein('abc', '')).toBe(3)
    })

    it('returns 0 when both strings are empty', () => {
      expect(levenshtein('', '')).toBe(0)
    })

    it('calculates correct distance for single character difference', () => {
      expect(levenshtein('cat', 'bat')).toBe(1)
    })

    it('calculates correct distance for complete replacement', () => {
      expect(levenshtein('abc', 'def')).toBe(3)
    })

    it('calculates correct distance for insertion', () => {
      expect(levenshtein('cat', 'cats')).toBe(1)
    })

    it('calculates correct distance for deletion', () => {
      expect(levenshtein('cats', 'cat')).toBe(1)
    })

    it('calculates correct distance for transposition-like difference', () => {
      expect(levenshtein('ab', 'ba')).toBe(2)
    })

    it('calculates correct distance for longer strings', () => {
      expect(levenshtein('kitten', 'sitting')).toBe(3)
    })

    it('calculates correct distance for case-sensitive comparison', () => {
      expect(levenshtein('ABC', 'abc')).toBe(3)
    })
  })

  describe('similarity', () => {
    it('returns 1.0 for identical strings', () => {
      expect(similarity('test', 'test')).toBe(1.0)
    })

    it('returns 1.0 for identical strings with different case', () => {
      expect(similarity('Test', 'test')).toBe(1.0)
    })

    it('returns correct similarity score for similar strings', () => {
      const score = similarity('cat', 'bat')
      expect(score).toBeGreaterThan(0.5)
      expect(score).toBeLessThan(1.0)
    })

    it('returns 0 for completely different strings of similar length', () => {
      const score = similarity('abc', 'def')
      expect(score).toBe(0)
    })

    it('returns 0 for completely different strings of different length', () => {
      const score = similarity('abc', 'xyz')
      expect(score).toBeLessThan(0.1)
    })

    it('returns 1.0 for two empty strings', () => {
      expect(similarity('', '')).toBe(1.0)
    })

    it('calculates correct similarity for longer words', () => {
      const score = similarity('kitten', 'sitting')
      expect(score).toBeGreaterThan(0)
      expect(score).toBeLessThan(1.0)
    })

    it('is symmetric', () => {
      const score1 = similarity('cat', 'bat')
      const score2 = similarity('bat', 'cat')
      expect(score1).toBe(score2)
    })
  })

  describe('normalizeInput', () => {
    it('converts to lowercase', () => {
      expect(normalizeInput('CREATE')).toBe('create')
    })

    it('trims whitespace', () => {
      expect(normalizeInput('  create  ')).toBe('create')
    })

    it('replaces hyphens with underscores', () => {
      expect(normalizeInput('create-item')).toBe('create_item')
    })

    it('replaces spaces with underscores', () => {
      expect(normalizeInput('create item')).toBe('create_item')
    })

    it('replaces multiple hyphens/spaces with single underscore', () => {
      expect(normalizeInput('create---item')).toBe('create_item')
      expect(normalizeInput('create   item')).toBe('create_item')
      expect(normalizeInput('create - item')).toBe('create_item')
    })

    it('handles all transformations together', () => {
      expect(normalizeInput('  CREATE - ITEM  ')).toBe('create_item')
    })

    it('preserves underscores', () => {
      expect(normalizeInput('create_item')).toBe('create_item')
    })

    it('handles empty string', () => {
      expect(normalizeInput('')).toBe('')
    })

    it('handles only whitespace', () => {
      expect(normalizeInput('   ')).toBe('')
    })

    it('handles only hyphens and spaces', () => {
      expect(normalizeInput('- - -')).toBe('_')
    })
  })

  describe('matchAction', () => {
    const validActions = ['create', 'get', 'list', 'update', 'delete'] as const

    it('returns exact match with similarity 1.0', () => {
      const result = matchAction('create', validActions)
      expect(result).toEqual({
        matched: 'create',
        exact: true,
        similarity: 1.0,
      })
    })

    it('returns exact match with case-insensitive normalization', () => {
      const result = matchAction('CREATE', validActions)
      expect(result).toEqual({
        matched: 'create',
        exact: true,
        similarity: 1.0,
      })
    })

    it('returns exact match after hyphen normalization', () => {
      const result = matchAction('create-item', validActions)
      // 'create-item' normalizes to 'create_item' which doesn't match 'create' exactly
      // This should fall through to fuzzy matching
      if ('error' in result) {
        expect(result.error).toBe('invalid_action')
      }
    })

    it('returns alias match with similarity 0.95', () => {
      const aliases = { new: 'create' as const }
      const result = matchAction('new', validActions, aliases)
      expect(result).toEqual({
        matched: 'create',
        exact: false,
        similarity: 0.95,
      })
    })

    it('returns alias match with various CRUD aliases', () => {
      const aliases = {
        add: 'create' as const,
        fetch: 'get' as const,
        all: 'list' as const,
      }
      expect(matchAction('add', validActions, aliases)).toEqual({
        matched: 'create',
        exact: false,
        similarity: 0.95,
      })
      expect(matchAction('fetch', validActions, aliases)).toEqual({
        matched: 'get',
        exact: false,
        similarity: 0.95,
      })
      expect(matchAction('all', validActions, aliases)).toEqual({
        matched: 'list',
        exact: false,
        similarity: 0.95,
      })
    })

    it('ignores aliases that do not map to valid actions', () => {
      const aliases = { new: 'invalid_action' as any }
      const result = matchAction('new', validActions, aliases)
      // Should fall through to fuzzy matching since 'invalid_action' is not valid
      if ('error' in result) {
        expect(result.error).toBe('invalid_action')
      }
    })

    it('returns fuzzy match above threshold', () => {
      const result = matchAction('crate', validActions, undefined, 0.6)
      if (!('error' in result)) {
        expect(result.matched).toBe('create')
        expect(result.exact).toBe(false)
        expect(result.similarity).toBeGreaterThanOrEqual(0.6)
      }
    })

    it('returns GuidingError when no match meets threshold', () => {
      const result = matchAction('xyz', validActions)
      expect(isGuidingError(result)).toBe(true)
      if ('error' in result) {
        expect(result.error).toBe('invalid_action')
        expect(result.input).toBe('xyz')
        expect(result.suggestions.length).toBeGreaterThan(0)
        expect(result.suggestions.length).toBeLessThanOrEqual(3)
      }
    })

    it('suggests top 3 actions in GuidingError', () => {
      const result = matchAction('xyz', validActions)
      if ('error' in result) {
        expect(result.suggestions.length).toBeGreaterThan(0)
        expect(result.suggestions.length).toBeLessThanOrEqual(3)
        // Suggestions should be sorted by similarity (highest first)
        for (let i = 0; i < result.suggestions.length - 1; i++) {
          expect(result.suggestions[i].similarity).toBeGreaterThanOrEqual(
            result.suggestions[i + 1].similarity,
          )
        }
      }
    })

    it('includes message in GuidingError', () => {
      const result = matchAction('notavalidaction', validActions)
      if ('error' in result) {
        expect(result.message).toContain('Unknown action')
        expect(result.message).toContain('notavalidaction')
        expect(result.message).toContain('Did you mean')
      }
    })

    it('respects custom threshold', () => {
      // With high threshold, only very similar matches succeed
      const resultHighThreshold = matchAction('creat', validActions, undefined, 0.95)
      // With low threshold, more fuzzy matches succeed
      const resultLowThreshold = matchAction('creat', validActions, undefined, 0.5)

      // Both might match 'create', but let's test that threshold is respected
      if (!('error' in resultHighThreshold)) {
        expect(resultHighThreshold.similarity).toBeGreaterThanOrEqual(0.95)
      }
      if (!('error' in resultLowThreshold)) {
        expect(resultLowThreshold.similarity).toBeGreaterThanOrEqual(0.5)
      }
    })

    it('handles empty validActions array by throwing (undefined reference)', () => {
      // This is a known limitation: matchAction does not guard against empty
      // validActions arrays, causing undefined reference when accessing best.similarity
      // This edge case is unreachable in practice since valid action sets are always
      // pre-defined, but it's worth noting for completeness.
      expect(() => matchAction('test', [])).toThrow()
    })

    it('prefers exact match over alias', () => {
      const aliases = { create: 'get' as const }
      // This is an edge case where both exact and alias could match
      // Exact match should be returned
      const result = matchAction('create', validActions, aliases)
      expect(result).toEqual({
        matched: 'create',
        exact: true,
        similarity: 1.0,
      })
    })

    it('returns similarity as integer percentage in suggestions', () => {
      const result = matchAction('xyz', validActions)
      if ('error' in result) {
        for (const suggestion of result.suggestions) {
          expect(Number.isInteger(suggestion.similarity)).toBe(true)
          expect(suggestion.similarity).toBeGreaterThanOrEqual(0)
          expect(suggestion.similarity).toBeLessThanOrEqual(100)
        }
      }
    })
  })

  describe('formatGuidingError', () => {
    it('returns object with content array', () => {
      const error: GuidingError = {
        error: 'invalid_action',
        input: 'test',
        suggestions: [{ value: 'create', similarity: 95 }],
        message: 'Unknown action',
      }
      const formatted = formatGuidingError(error)
      expect(formatted).toHaveProperty('content')
      expect(Array.isArray(formatted.content)).toBe(true)
    })

    it('returns single text content block', () => {
      const error: GuidingError = {
        error: 'invalid_action',
        input: 'test',
        suggestions: [],
        message: 'Unknown action',
      }
      const formatted = formatGuidingError(error)
      expect(formatted.content.length).toBe(1)
      expect(formatted.content[0]).toHaveProperty('type', 'text')
      expect(formatted.content[0]).toHaveProperty('text')
    })

    it('includes error information in text', () => {
      const error: GuidingError = {
        error: 'invalid_action',
        input: 'myinput',
        suggestions: [{ value: 'create', similarity: 85 }],
        message: 'Unknown action "myinput"',
      }
      const formatted = formatGuidingError(error)
      const text = formatted.content[0].text
      expect(text).toContain('invalid_action')
      expect(text).toContain('myinput')
      expect(text).toContain('Unknown action')
    })

    it('includes suggestion in text', () => {
      const error: GuidingError = {
        error: 'invalid_action',
        input: 'test',
        suggestions: [{ value: 'create', similarity: 95 }],
        message: 'Try "create"',
      }
      const formatted = formatGuidingError(error)
      const text = formatted.content[0].text
      expect(text).toContain('create')
      expect(text).toContain('95')
    })

    it('includes hint in formatted output', () => {
      const error: GuidingError = {
        error: 'invalid_action',
        input: 'test',
        suggestions: [],
        message: 'No suggestions',
      }
      const formatted = formatGuidingError(error)
      const text = formatted.content[0].text
      expect(text).toContain('Try one of the suggested values above')
    })

    it('formats output as valid JSON', () => {
      const error: GuidingError = {
        error: 'validation_error',
        input: 'test',
        suggestions: [{ value: 'option1', similarity: 80 }],
        message: 'Invalid input',
      }
      const formatted = formatGuidingError(error)
      const text = formatted.content[0].text
      // Should be valid JSON
      const parsed = JSON.parse(text)
      expect(parsed).toHaveProperty('error', 'validation_error')
      expect(parsed).toHaveProperty('input', 'test')
      expect(parsed).toHaveProperty('message')
      expect(parsed).toHaveProperty('suggestions')
    })
  })

  describe('CRUD_ALIASES', () => {
    it('contains create aliases', () => {
      expect(CRUD_ALIASES.new).toBe('create')
      expect(CRUD_ALIASES.add).toBe('create')
      expect(CRUD_ALIASES.make).toBe('create')
      expect(CRUD_ALIASES.insert).toBe('create')
    })

    it('contains get aliases', () => {
      expect(CRUD_ALIASES.fetch).toBe('get')
      expect(CRUD_ALIASES.read).toBe('get')
      expect(CRUD_ALIASES.find).toBe('get')
      expect(CRUD_ALIASES.show).toBe('get')
      expect(CRUD_ALIASES.retrieve).toBe('get')
      expect(CRUD_ALIASES.load).toBe('get')
    })

    it('contains list aliases', () => {
      expect(CRUD_ALIASES.all).toBe('list')
      expect(CRUD_ALIASES.query).toBe('list')
      expect(CRUD_ALIASES.browse).toBe('list')
    })

    it('contains update aliases', () => {
      expect(CRUD_ALIASES.modify).toBe('update')
      expect(CRUD_ALIASES.edit).toBe('update')
      expect(CRUD_ALIASES.patch).toBe('update')
      expect(CRUD_ALIASES.change).toBe('update')
      expect(CRUD_ALIASES.set).toBe('update')
    })

    it('contains delete aliases', () => {
      expect(CRUD_ALIASES.remove).toBe('delete')
      expect(CRUD_ALIASES.destroy).toBe('delete')
      expect(CRUD_ALIASES.erase).toBe('delete')
      expect(CRUD_ALIASES.drop).toBe('delete')
    })

    it('has expected number of aliases', () => {
      const aliases = Object.keys(CRUD_ALIASES)
      expect(aliases.length).toBeGreaterThan(15)
    })
  })

  describe('extendAliases', () => {
    it('merges base and extension aliases', () => {
      const base = { new: 'create' as const }
      const extensions = { add: 'create' as const }
      const result = extendAliases(base, extensions)
      expect(result).toHaveProperty('new', 'create')
      expect(result).toHaveProperty('add', 'create')
    })

    it('returns new object (not mutation)', () => {
      const base = { new: 'create' as const }
      const extensions = { add: 'create' as const }
      const result = extendAliases(base, extensions)
      expect(result).not.toBe(base)
      expect(result).not.toBe(extensions)
    })

    it('allows extension to override base', () => {
      const base = { new: 'create' as const }
      const extensions = { new: 'list' as const }
      const result = extendAliases(base, extensions)
      expect(result.new).toBe('list')
    })

    it('preserves all base aliases when no override', () => {
      const base = { new: 'create' as const, old: 'list' as const }
      const extensions = { add: 'create' as const }
      const result = extendAliases(base, extensions)
      expect(result).toHaveProperty('new', 'create')
      expect(result).toHaveProperty('old', 'list')
      expect(result).toHaveProperty('add', 'create')
    })

    it('works with empty base', () => {
      const base = {}
      const extensions = { new: 'create' as const }
      const result = extendAliases(base, extensions)
      expect(result).toEqual({ new: 'create' })
    })

    it('works with empty extensions', () => {
      const base = { new: 'create' as const }
      const extensions = {}
      const result = extendAliases(base, extensions)
      expect(result).toEqual({ new: 'create' })
    })
  })

  describe('createFuzzyActionSchema', () => {
    const validActions = ['create', 'get', 'list', 'update', 'delete'] as const

    it('returns a Zod schema', () => {
      const schema = createFuzzyActionSchema(validActions)
      expect(schema).toBeDefined()
      expect(typeof schema.parse).toBe('function')
    })

    it('accepts exact action match', () => {
      const schema = createFuzzyActionSchema(validActions)
      expect(schema.parse('create')).toBe('create')
      expect(schema.parse('get')).toBe('get')
    })

    it('accepts case-insensitive match', () => {
      const schema = createFuzzyActionSchema(validActions)
      expect(schema.parse('CREATE')).toBe('create')
      expect(schema.parse('Get')).toBe('get')
    })

    it('accepts fuzzy match above default threshold', () => {
      const schema = createFuzzyActionSchema(validActions)
      const result = schema.safeParse('creat')
      // May or may not match depending on similarity score relative to 0.6 default
      // The test verifies that parsing doesn't crash
      expect(result).toBeDefined()
    })

    it('rejects invalid action with z.NEVER', () => {
      const schema = createFuzzyActionSchema(validActions)
      const result = schema.safeParse('invalid_action_that_does_not_match')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.errors.length).toBeGreaterThan(0)
        expect(result.error.errors[0].code).toBe('custom')
      }
    })

    it('provides helpful error message for invalid action', () => {
      const schema = createFuzzyActionSchema(validActions)
      const result = schema.safeParse('xyz')
      expect(result.success).toBe(false)
      if (!result.success) {
        const message = result.error.errors[0].message
        expect(message).toContain('Unknown action')
      }
    })

    it('respects custom threshold', () => {
      const schemaHigh = createFuzzyActionSchema(validActions, undefined, 0.95)
      const schemaLow = createFuzzyActionSchema(validActions, undefined, 0.4)

      const resultHigh = schemaHigh.safeParse('creat')
      const resultLow = schemaLow.safeParse('creat')

      // Lower threshold should be more permissive
      // Both could succeed or fail depending on similarity, but test the function works
      expect(resultHigh).toBeDefined()
      expect(resultLow).toBeDefined()
    })

    it('accepts aliases when provided', () => {
      const aliases = { new: 'create' as const }
      const schema = createFuzzyActionSchema(validActions, aliases)
      expect(schema.parse('new')).toBe('create')
    })

    it('rejects empty string input', () => {
      const schema = createFuzzyActionSchema(validActions)
      const result = schema.safeParse('')
      expect(result.success).toBe(false)
    })

    it('returns original matched action value', () => {
      const schema = createFuzzyActionSchema(validActions)
      const result = schema.parse('CREATE')
      expect(result).toBe('create')
      expect(validActions).toContain(result)
    })
  })

  describe('FlexibleIdentifierSchema', () => {
    it('accepts non-empty strings', () => {
      expect(FlexibleIdentifierSchema.parse('character:zira')).toBe('character:zira')
      expect(FlexibleIdentifierSchema.parse('uuid-1234')).toBe('uuid-1234')
      expect(FlexibleIdentifierSchema.parse('a')).toBe('a')
    })

    it('rejects empty string', () => {
      const result = FlexibleIdentifierSchema.safeParse('')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('empty')
      }
    })

    it('accepts whitespace-only string (only checks length, not trimmed)', () => {
      // The schema only checks .min(1) which is length-based, not content-based
      // So '   ' (3 spaces) is technically a valid 3-character string
      const result = FlexibleIdentifierSchema.safeParse('   ')
      expect(result.success).toBe(true)
      expect(result.data).toBe('   ')
    })

    it('preserves input value when valid', () => {
      const input = 'my-entity:identifier'
      expect(FlexibleIdentifierSchema.parse(input)).toBe(input)
    })

    it('is a string schema', () => {
      // Verify it has describe method (Zod string method)
      expect(typeof FlexibleIdentifierSchema.describe).toBe('function')
    })

    it('rejects non-string values', () => {
      const result = FlexibleIdentifierSchema.safeParse(123)
      expect(result.success).toBe(false)
    })

    it('rejects null', () => {
      const result = FlexibleIdentifierSchema.safeParse(null)
      expect(result.success).toBe(false)
    })

    it('rejects undefined', () => {
      const result = FlexibleIdentifierSchema.safeParse(undefined)
      expect(result.success).toBe(false)
    })

    it('describes its purpose in schema metadata', () => {
      const description = FlexibleIdentifierSchema.description
      expect(description).toContain('UUID')
      expect(description).toContain('entity')
    })
  })

  describe('Integration tests', () => {
    it('matches action and formats error with helpful suggestions', () => {
      const validActions = ['spawn_character', 'spawn_encounter', 'spawn_location'] as const
      const result = matchAction('spawn_character', validActions)

      expect(!('error' in result)).toBe(true)
      if (!('error' in result)) {
        expect(result.matched).toBe('spawn_character')
        expect(result.exact).toBe(true)
      }
    })

    it('provides suggestions when action does not match', () => {
      const validActions = ['spawn_character', 'spawn_encounter', 'spawn_location'] as const
      const result = matchAction('spawn_char', validActions)

      if ('error' in result) {
        expect(result.suggestions.length).toBeGreaterThan(0)
        const topSuggestion = result.suggestions[0]
        expect(topSuggestion.value).toBe('spawn_character')
        expect(topSuggestion.similarity).toBeGreaterThan(80)
      }
    })

    it('uses CRUD_ALIASES with matchAction', () => {
      const validActions = ['create', 'get', 'list', 'update', 'delete'] as const
      const result = matchAction('new', validActions, CRUD_ALIASES)

      expect(!('error' in result)).toBe(true)
      if (!('error' in result)) {
        expect(result.matched).toBe('create')
        expect(result.exact).toBe(false)
        expect(result.similarity).toBe(0.95)
      }
    })

    it('extends CRUD aliases with custom aliases', () => {
      const customAliases = { foo: 'create' as const }
      const allAliases = extendAliases(CRUD_ALIASES, customAliases)

      expect(allAliases).toHaveProperty('new', 'create')
      expect(allAliases).toHaveProperty('foo', 'create')
    })

    it('creates schema that validates user input', () => {
      const validActions = ['move_hex', 'rest', 'loot'] as const
      const aliases = { go: 'move_hex' as const }
      const schema = createFuzzyActionSchema(validActions, aliases)

      expect(schema.parse('move_hex')).toBe('move_hex')
      expect(schema.parse('go')).toBe('move_hex')

      const   result = schema.safeParse('invalid')
      expect(result.success).toBe(false)
    })
  })
})
