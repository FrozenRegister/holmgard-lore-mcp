import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { getToolHandler, getToolDefinition, getTools } from '../../src/tools/register'
import { registerSearchToolsTool } from '../../src/rpg/register-search-tools'
import { setToolIndex } from '../../src/rpg/handlers/search-tools'
import { handleSearchTools } from '../../src/rpg/handlers/search-tools'

describe('search_tools registration (Phase 3 #544)', () => {
  beforeAll(() => {
    try {
      registerSearchToolsTool()
    } catch (e: any) {
      if (!e.message?.includes('already registered')) {
        throw e
      }
    }
  })

  describe('getToolHandler', () => {
    it('resolves search_tools to a ToolHandler function', () => {
      const handler = getToolHandler('search_tools')
      expect(handler).toBeDefined()
      expect(typeof handler).toBe('function')
    })

    it('returns undefined for unknown tools', () => {
      expect(getToolHandler('nonexistent_tool_xyz')).toBeUndefined()
    })
  })

  describe('getToolDefinition', () => {
    it('serializes search_tools to a valid tool definition', () => {
      const def = getToolDefinition('search_tools')
      expect(def).toBeDefined()
      expect(def!.name).toBe('search_tools')
      expect(def!.title).toBe('Search Tools')
      expect(def!.version).toBe('1.0.0')
      expect(def!.description).toContain('fuzzy-search')
      expect(def!.inputSchema).toHaveProperty('type', 'object')
      expect(def!.inputSchema).toHaveProperty('properties')
    })

    it('includes query and limit fields in the schema', () => {
      const def = getToolDefinition('search_tools')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('query')
      expect(props).toHaveProperty('limit')
    })

    it('returns undefined for unknown tool', () => {
      expect(getToolDefinition('nonexistent_xyz')).toBeUndefined()
    })
  })

  describe('schema serialization', () => {
    it('produces a valid JSON Schema from InputSchema', () => {
      const def = getToolDefinition('search_tools')
      expect(def).toBeDefined()
      expect(def!.inputSchema).toHaveProperty('type', 'object')
      expect(def!.inputSchema).toHaveProperty('properties')
    })

    it('marks query as required', () => {
      const def = getToolDefinition('search_tools')
      const required = (def!.inputSchema.required as string[]) || []
      expect(required).toContain('query')
    })

    it('treats limit as optional', () => {
      const def = getToolDefinition('search_tools')
      const required = (def!.inputSchema.required as string[]) || []
      expect(required.includes('limit')).toBe(false)
    })
  })

  describe('getTools', () => {
    it('includes search_tools in the registered tools list', () => {
      const tools = getTools()
      const names = tools.map((t) => t.name)
      expect(names).toContain('search_tools')
    })
  })

  describe('invoke handler (no D1 — in-memory index)', () => {
    beforeEach(() => {
      setToolIndex([
        { name: 'character_manage', description: 'Character CRUD and management' },
        { name: 'agent_manage', description: 'NPC AI agent management' },
        { name: 'search_tools', description: 'Fuzzy tool discovery' },
        { name: 'load_tool_schema', description: 'JSON schema lookup' },
        { name: 'lore_manage', description: 'Lore KV store management' },
      ])
    })

    it('returns matches for a query that matches a tool name', async () => {
      const result = await handleSearchTools({} as any, { query: 'character' })
      expect(result.content).toBeDefined()
      const body = JSON.parse(result.content[0].text)
      expect(body.success).toBe(true)
      expect(body.matches.length).toBeGreaterThanOrEqual(1)
      expect(body.matches[0].name).toBe('character_manage')
    })

    it('returns matches for a query that matches a description', async () => {
      const result = await handleSearchTools({} as any, { query: 'fuzzy' })
      const body = JSON.parse(result.content[0].text)
      expect(body.success).toBe(true)
      expect(body.matches.length).toBeGreaterThanOrEqual(1)
      expect(body.matches[0].name).toBe('search_tools')
    })

    it('respects the limit parameter', async () => {
      const result = await handleSearchTools({} as any, { query: '', limit: 2 })
      const body = JSON.parse(result.content[0].text)
      expect(body.success).toBe(true)
      expect(body.matches.length).toBeLessThanOrEqual(2)
    })

    it('returns an error when tool index is not initialized', async () => {
      setToolIndex(null as any)
      const result = await handleSearchTools({} as any, { query: 'test' })
      const body = JSON.parse(result.content[0].text)
      expect(body.error).toBeDefined()
    })
  })
})
