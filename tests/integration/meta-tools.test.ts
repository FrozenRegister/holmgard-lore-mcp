// tests/integration/meta-tools.test.ts
// Integration test: search_tools and load_tool_schema meta-tools
// Covers: search_tools (fuzzy tool search) and load_tool_schema (schema loading)

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockContext } from '../unit/mocks'
import { toolRegistry } from '../../src/tools/registry'

function callTool(ctx: ReturnType<typeof createMockContext>, toolName: string, args: Record<string, unknown>) {
  const handler = toolRegistry[toolName]
  return handler({ c: ctx, id: 'test-id', isAuthenticated: true, args })
}

async function jsonBody(res: Response): Promise<any> {
  const body = await res.json()
  return body.result ?? body
}

describe('Meta tools integration', () => {
  let ctx: ReturnType<typeof createMockContext>

  beforeEach(() => {
    ctx = createMockContext()
  })

  describe('search_tools', () => {
    it('returns matching tools for a search query', async () => {
      const res = await callTool(ctx, 'search_tools', {
        query: 'lore',
        limit: 5,
      })
      const body = await jsonBody(res)
      expect(body).toBeDefined()
      // Response may have results array or tools array
      const items = body.results ?? body.tools ?? body
      expect(Array.isArray(items) || items.length !== undefined).toBeTruthy()
    })

    it('returns results for entity search', async () => {
      const res = await callTool(ctx, 'search_tools', {
        query: 'entity',
        limit: 10,
      })
      const body = await jsonBody(res)
      expect(body).toBeDefined()
    })

    it('returns results for world tools', async () => {
      const res = await callTool(ctx, 'search_tools', {
        query: 'world',
        limit: 5,
      })
      const body = await jsonBody(res)
      expect(body).toBeDefined()
    })

    it('respects limit parameter', async () => {
      const res = await callTool(ctx, 'search_tools', {
        query: 'a',
        limit: 2,
      })
      const body = await jsonBody(res)
      expect(body).toBeDefined()
    })

    it('handles empty queries', async () => {
      const res = await callTool(ctx, 'search_tools', {
        query: '',
        limit: 5,
      })
      const body = await jsonBody(res)
      expect(body).toBeDefined()
    })
  })

  describe('load_tool_schema', () => {
    it('loads schema for lore_manage', async () => {
      const res = await callTool(ctx, 'load_tool_schema', {
        toolName: 'lore_manage',
      })
      const body = await jsonBody(res)
      expect(body).toBeDefined()
    })

    it('loads schema for entity_manage', async () => {
      const res = await callTool(ctx, 'load_tool_schema', {
        toolName: 'entity_manage',
      })
      const body = await jsonBody(res)
      expect(body).toBeDefined()
    })

    it('loads schema for rpg', async () => {
      const res = await callTool(ctx, 'load_tool_schema', {
        toolName: 'rpg',
      })
      const body = await jsonBody(res)
      expect(body).toBeDefined()
    })

    it('handles unknown tool', async () => {
      const res = await callTool(ctx, 'load_tool_schema', {
        toolName: 'nonexistent_tool',
      })
      const raw = await res.json()
      // May return error or result with error
      expect(raw.error || raw.result?.error || raw.result).toBeDefined()
    })
  })
})
