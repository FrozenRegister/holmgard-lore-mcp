import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('JSON-RPC protocol', () => {
  it('initialize returns server info and capabilities', async () => {
    const res = await rpc('initialize')
    expect(res.jsonrpc).toBe('2.0')
    expect(res.result.protocolVersion).toBe('2024-11-05')
    expect(res.result.serverInfo.name).toBe('holmgard-lore-mcp')
    expect(res.result.capabilities.tools.list).toBe(true)
    expect(res.result.capabilities.tools.call).toBe(true)
  })

  it('ping returns empty result', async () => {
    const res = await rpc('ping')
    expect(res.result).toEqual({})
  })

  it('tools/list returns exactly 9 tools', async () => {
    const res = await rpc('tools/list')
    const tools = res.result.tools as Array<{ name: string }>
    expect(tools).toHaveLength(9)
    const names = tools.map((t) => t.name)
    // Core lore-layer tools (consolidated from 59)
    expect(names).toContain('lore_manage')
    expect(names).toContain('entity_manage')
    expect(names).toContain('world_manage')
    expect(names).toContain('scene_manage')
    expect(names).toContain('continuity_manage')
    // RPG engine (collapsed from 27 + agent_manage)
    expect(names).toContain('rpg')
    expect(names).toContain('agent_manage')
    // Meta-tools
    expect(names).toContain('search_tools')
    expect(names).toContain('load_tool_schema')
  })

  it('every tool inputSchema declares type: object at the root (MCP spec compliance)', async () => {
    const res = await rpc('tools/list')
    const tools = res.result.tools as Array<{ name: string; inputSchema: { type?: string } }>
    for (const tool of tools) {
      expect(tool.inputSchema.type, `${tool.name} inputSchema.type`).toBe('object')
    }
  })

  it('rejects requests with wrong jsonrpc version', async () => {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'ping' }),
    }).then((r) => r.json() as Promise<Record<string, any>>)
    expect(res.error.code).toBe(-32600)
  })

  it('rejects batch requests', async () => {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }]),
    }).then((r) => r.json() as Promise<Record<string, any>>)
    expect(res.error.code).toBe(-32600)
    expect(res.error.message).toContain('Batch requests are not supported')
  })

  it('returns parse error on invalid JSON', async () => {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json {{',
    }).then((r) => r.json() as Promise<Record<string, any>>)
    expect(res.error.code).toBe(-32700)
  })

  it('returns method-not-found for unknown method', async () => {
    const res = await rpc('unknown_method_xyz')
    expect(res.error.code).toBe(-32601)
  })

  it('GET /mcp returns error directing caller to POST', async () => {
    const res = await SELF.fetch('http://example.com/mcp', { method: 'GET' })
    const body = await res.json() as Record<string, any>
    expect(body.error).toBeDefined()
  })
})

describe('ping_tool (via lore_manage action=ping)', () => {
  it('returns pong', async () => {
    const res = await callTool('lore_manage', { action: 'ping' })
    expect(res.result.content[0].text).toBe('pong')
    expect(res.result.metadata.source).toBe('internal')
  })
})

describe('check_authentication (via lore_manage action=auth_check)', () => {
  it('returns authenticated when correct X-Api-Key header is sent', async () => {
    const res = await callToolWithApiKey('lore_manage', 'test-api-key-xyz', { action: 'auth_check' })
    expect(res.result.content[0].text).toBe('Authenticated.')
    expect(res.result.metadata.authenticated).toBe(true)
  })

  it('returns not authenticated when no X-Api-Key header is sent', async () => {
    const res = await rpc('tools/call', { name: 'lore_manage', arguments: { action: 'auth_check' } })
    expect(res.result.content[0].text).toBe('Not authenticated — request was made without a valid API key.')
    expect(res.result.metadata.authenticated).toBe(false)
  })

  it('returns not authenticated when wrong X-Api-Key header is sent', async () => {
    const res = await callToolWithApiKey('lore_manage', 'wrong-key', { action: 'auth_check' })
    expect(res.result.content[0].text).toBe('Not authenticated — request was made without a valid API key.')
    expect(res.result.metadata.authenticated).toBe(false)
  })
})

