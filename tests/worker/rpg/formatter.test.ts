import { describe, expect, it } from 'vitest'
import { RichFormatter } from '@/rpg/utils/formatter'

describe('RichFormatter', () => {
  describe('header', () => {
    it('generates header with default icon', () => {
      const result = RichFormatter.header('Test')
      expect(result).toContain('TEST')
      expect(result).toContain('🔧')
      expect(result).toContain('━'.repeat(40))
    })

    it('generates header with custom icon', () => {
      const result = RichFormatter.header('Test', '⭐')
      expect(result).toContain('⭐')
      expect(result).toContain('TEST')
    })
  })

  describe('section', () => {
    it('formats a section title', () => {
      expect(RichFormatter.section('My Section')).toBe('\n### My Section\n')
    })
  })

  describe('keyValue', () => {
    it('formats key-value pairs', () => {
      const result = RichFormatter.keyValue({ name: 'Alice', age: 30 })
      expect(result).toContain('- **name:** Alice')
      expect(result).toContain('- **age:** 30')
    })

    it('skips undefined values', () => {
      const result = RichFormatter.keyValue({ a: 'x', b: undefined, c: 1 })
      expect(result).toContain('**a:**')
      expect(result).not.toContain('**b:**')
      expect(result).toContain('**c:**')
    })

    it('skips null values', () => {
      const result = RichFormatter.keyValue({ a: null, b: 'x' })
      expect(result).not.toContain('**a:**')
      expect(result).toContain('**b:**')
    })

    it('stringifies objects', () => {
      const result = RichFormatter.keyValue({ meta: { version: 1 } })
      expect(result).toContain('{"version":1}')
    })
  })

  describe('table', () => {
    it('returns no data message for empty rows', () => {
      expect(RichFormatter.table(['a', 'b'], [])).toBe('\n*No data*\n')
    })

    it('formats table with headers and rows', () => {
      const result = RichFormatter.table(['Name', 'Score'], [['Alice', 10], ['Bob', 20]])
      const lines = result.trim().split('\n')
      expect(lines[0]).toBe('| Name | Score |')
      expect(lines[1]).toBe('| --- | --- |')
      expect(lines[2]).toBe('| Alice | 10 |')
      expect(lines[3]).toBe('| Bob | 20 |')
    })
  })

  describe('list', () => {
    it('formats unordered list', () => {
      const result = RichFormatter.list(['a', 'b'])
      expect(result).toContain('- a')
      expect(result).toContain('- b')
    })

    it('formats ordered list', () => {
      const result = RichFormatter.list(['a', 'b'], true)
      expect(result).toContain('1. a')
      expect(result).toContain('2. b')
    })

    it('returns None for empty list', () => {
      expect(RichFormatter.list([])).toBe('\n*None*\n')
    })
  })

  describe('alert', () => {
    it('formats info alert by default', () => {
      const result = RichFormatter.alert('hello')
      expect(result).toContain('ℹ️')
      expect(result).toContain('INFO')
      expect(result).toContain('hello')
    })

    it('formats success alert', () => {
      const result = RichFormatter.alert('done', 'success')
      expect(result).toContain('✅')
      expect(result).toContain('SUCCESS')
    })

    it('formats error alert', () => {
      const result = RichFormatter.alert('oops', 'error')
      expect(result).toContain('❌')
      expect(result).toContain('ERROR')
    })

    it('formats warning alert', () => {
      const result = RichFormatter.alert('careful', 'warning')
      expect(result).toContain('⚠️')
      expect(result).toContain('WARNING')
    })
  })

  describe('success / error', () => {
    it('success delegates to alert', () => {
      expect(RichFormatter.success('ok')).toBe(RichFormatter.alert('ok', 'success'))
    })

    it('error delegates to alert', () => {
      expect(RichFormatter.error('bad')).toBe(RichFormatter.alert('bad', 'error'))
    })
  })

  describe('embedJson', () => {
    it('wraps JSON in comment tags', () => {
      const result = RichFormatter.embedJson({ a: 1 }, 'DATA')
      expect(result).toContain('<!-- DATA_JSON')
      expect(result).toContain('{"a":1}')
      expect(result).toContain('DATA_JSON -->')
    })

    it('uses default tag', () => {
      const result = RichFormatter.embedJson([1, 2])
      expect(result).toContain('<!-- DATA_JSON')
      expect(result).toContain('[1,2]')
    })
  })

  describe('code', () => {
    it('formats code block with empty language', () => {
      const result = RichFormatter.code('const x = 1')
      expect(result).toBe('\n```\nconst x = 1\n```\n')
    })

    it('formats code block with language', () => {
      const result = RichFormatter.code('const x = 1', 'typescript')
      expect(result).toBe('\n```typescript\nconst x = 1\n```\n')
    })
  })
})