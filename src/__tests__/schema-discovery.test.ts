import { describe, it, expect, beforeEach } from 'vitest'
import { handleLoadToolSchema, setSchemaIndex } from '../rpg/handlers/load-tool-schema'
import type { AppBindings } from '../types'

describe('schema discovery', () => {
  beforeEach(() => {
    setSchemaIndex([
      {
        name: 'list_topics',
        description: 'List all lore topics with optional filtering',
        inputSchema: {
          type: 'object',
          properties: {
            prefix: { type: 'string' },
          },
        },
      },
      {
        name: 'get_lore',
        description: 'Retrieve a single lore entry by key',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string' },
          },
          required: ['key'],
        },
      },
      {
        name: 'set_lore',
        description: 'Create or update a lore entry',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            text: { type: 'string' },
          },
          required: ['key', 'text'],
        },
      },
      {
        name: 'delete_lore',
        description: 'Delete a lore entry',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string' },
          },
          required: ['key'],
        },
      },
      {
        name: 'patch_lore',
        description: 'Apply targeted text patch to a lore entry',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            find: { type: 'string' },
            replace: { type: 'string' },
          },
          required: ['key', 'find', 'replace'],
        },
      },
    ])
  })

  describe('handleLoadToolSchema', () => {
    it('returns schema for exact tool name', async () => {
      const result = await handleLoadToolSchema({} as AppBindings, { toolName: 'list_topics' })

      expect(result.content[0].type).toBe('text')
      const data = JSON.parse(result.content[0].text)
      expect(data.success).toBe(true)
      expect(data.toolName).toBe('list_topics')
      expect(data.schema.name).toBe('list_topics')
      expect(data.schema.description).toContain('List all lore topics')
      expect(data.schema.inputSchema).toBeDefined()
    })

    it('includes inputSchema in response', async () => {
      const result = await handleLoadToolSchema({} as AppBindings, { toolName: 'set_lore' })

      const data = JSON.parse(result.content[0].text)
      expect(data.schema.inputSchema.type).toBe('object')
      expect(data.schema.inputSchema.properties).toBeDefined()
      expect(data.schema.inputSchema.required).toContain('key')
    })

    it('returns error for unknown tool name', async () => {
      const result = await handleLoadToolSchema({} as AppBindings, { toolName: 'nonexistent' })

      const data = JSON.parse(result.content[0].text)
      expect(data.error).toBe(true)
      expect(data.message).toContain('not found')
    })

    it('suggests did_you_mean for typos', async () => {
      const result = await handleLoadToolSchema({} as AppBindings, { toolName: 'list_topicss' }) // extra 's'

      const data = JSON.parse(result.content[0].text)
      expect(data.error).toBe(true)
      expect(data.message).toContain('Did you mean')
      expect(data.didYouMean).toBeDefined()
      expect(data.didYouMean.length).toBeGreaterThan(0)
      expect(data.didYouMean[0].name).toBe('list_topics')
      expect(data.didYouMean[0].confidence).toBeGreaterThan(0.7)
    })

    it('suggests multiple close matches', async () => {
      const result = await handleLoadToolSchema({} as AppBindings, { toolName: '_lore' })

      const data = JSON.parse(result.content[0].text)
      expect(data.error).toBe(true)
      // Should suggest get_lore, set_lore, delete_lore, patch_lore (all contain "_lore")
      expect(data.didYouMean.length).toBeGreaterThan(1)
    })

    it('handles case-insensitive matching', async () => {
      // Exact match even with different case
      const result = await handleLoadToolSchema({} as AppBindings, { toolName: 'LIST_TOPICS' })

      const data = JSON.parse(result.content[0].text)
      // Should find it via fuzzy matching and return schema
      if (data.success) {
        expect(data.schema.name).toBe('list_topics')
      } else {
        // If not exact match, should at least suggest it
        expect(data.didYouMean).toBeDefined()
        expect(data.didYouMean.some((m: any) => m.name === 'list_topics')).toBe(true)
      }
    })

    it('handles hyphens like underscores', async () => {
      // Hyphen should be treated like underscore in fuzzy match
      const result = await handleLoadToolSchema({} as AppBindings, { toolName: 'list-topics' })

      const data = JSON.parse(result.content[0].text)
      if (data.success) {
        expect(data.schema.name).toBe('list_topics')
      } else {
        // If not exact, should suggest the underscore version
        expect(data.didYouMean).toBeDefined()
        expect(data.didYouMean.some((m: any) => m.name === 'list_topics')).toBe(true)
      }
    })

    it('validates required toolName parameter', async () => {
      const result = await handleLoadToolSchema({} as AppBindings, { toolName: '' })

      const data = JSON.parse(result.content[0].text)
      expect(data.error).toBe(true)
    })

    it('rejects invalid input', async () => {
      const result = await handleLoadToolSchema({} as AppBindings, { somethingElse: 'value' })

      const data = JSON.parse(result.content[0].text)
      expect(data.error).toBe(true)
    })

    it('provides error message when no close matches found', async () => {
      const result = await handleLoadToolSchema({} as AppBindings, { toolName: 'xyzabc' })

      const data = JSON.parse(result.content[0].text)
      expect(data.error).toBe(true)
      expect(data.message).toContain('search_tools')
      expect(data.availableToolCount).toBe(5)
    })
  })
})
