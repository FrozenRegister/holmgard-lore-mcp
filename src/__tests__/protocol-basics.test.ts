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

  it('tools/list returns exactly 35 tools', async () => {
    const res = await rpc('tools/list')
    const tools = res.result.tools as Array<{ name: string }>
    expect(tools).toHaveLength(35)
    const names = tools.map((t) => t.name)
    // Consolidated tools (replaced 59 individual tools)
    expect(names).toContain('lore_manage')
    expect(names).toContain('entity_manage')
    expect(names).toContain('world_manage')
    expect(names).toContain('scene_manage')
    expect(names).toContain('continuity_manage')
    // RPG engine tools (Phase 3)
    expect(names).toContain('math_manage')
    expect(names).toContain('world_map')
    expect(names).toContain('character_manage')
    expect(names).toContain('party_manage')
    expect(names).toContain('quest_manage')
    expect(names).toContain('item_manage')
    expect(names).toContain('inventory_manage')
    expect(names).toContain('corpse_manage')
    expect(names).toContain('narrative_manage')
    expect(names).toContain('secret_manage')
    expect(names).toContain('theft_manage')
    expect(names).toContain('aura_manage')
    expect(names).toContain('improvisation_manage')
    expect(names).toContain('npc_manage')
    expect(names).toContain('session_manage')
    expect(names).toContain('combat_manage')
    expect(names).toContain('combat_action')
    expect(names).toContain('combat_map')
    expect(names).toContain('spawn_manage')
    expect(names).toContain('strategy_manage')
    expect(names).toContain('turn_manage')
    expect(names).toContain('spatial_manage')
    expect(names).toContain('batch_manage')
    expect(names).toContain('travel_manage')
    expect(names).toContain('perception_manage')
    expect(names).toContain('scene_manage')
    // Meta-tools
    expect(names).toContain('search_tools')
    expect(names).toContain('load_tool_schema')
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

describe('ping_tool', () => {
  it('returns pong', async () => {
    const res = await callTool('ping_tool')
    expect(res.result.content[0].text).toBe('pong')
    expect(res.result.metadata.source).toBe('internal')
  })
})

describe('check_authentication', () => {
  it('returns authenticated when correct X-Api-Key header is sent', async () => {
    const res = await callToolWithApiKey('check_authentication', 'test-api-key-xyz')
    expect(res.result.content[0].text).toBe('Authenticated.')
    expect(res.result.metadata.authenticated).toBe(true)
  })

  it('returns not authenticated when no X-Api-Key header is sent', async () => {
    const res = await rpc('tools/call', { name: 'check_authentication', arguments: {} })
    expect(res.result.content[0].text).toBe('Not authenticated — request was made without a valid API key.')
    expect(res.result.metadata.authenticated).toBe(false)
  })

  it('returns not authenticated when wrong X-Api-Key header is sent', async () => {
    const res = await callToolWithApiKey('check_authentication', 'wrong-key')
    expect(res.result.content[0].text).toBe('Not authenticated — request was made without a valid API key.')
    expect(res.result.metadata.authenticated).toBe(false)
  })
})

