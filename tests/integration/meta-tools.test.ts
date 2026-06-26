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
  return res.json()
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
      expect(body.result).toBeDefined()
    })

    it('returns results for entity-related search', async () => {
      const res = await callTool(ctx, 'search_tools', {
        query: 'entity',
        limit: 10,
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })

    it('handles empty queries', async () => {
      const res = await callTool(ctx, 'search_tools', {
        query: '',
        limit: 5,
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('load_tool_schema', () => {
    it('loads schema for lore_manage', async () => {
      const res = await callTool(ctx, 'load_tool_schema', {
        toolName: 'lore_manage',
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })

    it('loads schema for entity_manage', async () => {
      const res = await callTool(ctx, 'load_tool_schema', {
        toolName: 'entity_manage',
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })

    it('errors on unknown tool', async () => {
      const res = await callTool(ctx, 'load_tool_schema', {
        toolName: 'nonexistent_tool',
      })
      const body = await jsonBody(res)
      expect(body.error || body.result?.error).toBeDefined()
    })
  })
})
