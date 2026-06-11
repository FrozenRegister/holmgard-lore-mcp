// src/__tests__/do-transport.test.ts
// Tests for the HolmgardMCP Durable Object path (Streamable HTTP transport).
// These tests send requests with the Streamable HTTP transport markers so the
// Worker routes them to the DO instead of the legacy JSON-RPC handler.
import { describe, SELF } from './helpers'
import { expect, it } from 'vitest'

// ── Helpers ───────────────────────────────────────────────────────────────────

const STREAMABLE_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
  'X-Api-Key': 'test-api-key-xyz',
}

async function mcpPost(body: unknown, extra: Record<string, string> = {}): Promise<{
  status: number
  headers: Headers
  data: any
}> {
  const res = await SELF.fetch('http://example.com/mcp', {
    method: 'POST',
    headers: { ...STREAMABLE_HEADERS, ...extra },
    body: JSON.stringify(body),
  })
  const data = await extractJsonRpc(res.clone())
  return { status: res.status, headers: res.headers, data }
}

// Parses both application/json and text/event-stream responses.
// Returns the first JSON-RPC message found.
async function extractJsonRpc(res: Response): Promise<any> {
  const ct = res.headers.get('Content-Type') ?? ''
  const text = await res.text()
  if (ct.includes('text/event-stream')) {
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        return JSON.parse(line.slice(6))
      }
    }
    throw new Error(`No SSE data line in response body: ${text.slice(0, 200)}`)
  }
  return JSON.parse(text)
}

async function initialize(): Promise<{ sessionId: string; result: any }> {
  const res = await SELF.fetch('http://example.com/mcp', {
    method: 'POST',
    headers: STREAMABLE_HEADERS,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.0.1' },
      },
    }),
  })
  const data = await extractJsonRpc(res.clone())
  const sessionId = res.headers.get('Mcp-Session-Id') ?? ''
  return { sessionId, result: data }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DO transport — Streamable HTTP routing', () => {
  it('routes to DO when Accept includes text/event-stream', async () => {
    const { status } = await mcpPost({ jsonrpc: '2.0', id: 1, method: 'ping' })
    // Any 2xx means the DO accepted and handled it (not a 406 from the SDK)
    expect(status).toBeLessThan(500)
    expect(status).not.toBe(406)
  })

  it('returns 401 when MCP_API_KEY is set and X-Api-Key is wrong', async () => {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'X-Api-Key': 'wrong-key',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 when MCP_API_KEY is set and X-Api-Key is absent', async () => {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('DO transport — initialize', () => {
  it('returns server info with holmgard name and version', async () => {
    const { result } = await initialize()
    expect(result.result?.serverInfo?.name).toBe('holmgard-lore-mcp')
    expect(result.result?.serverInfo?.version).toBe('0.3.0')
  })

  it('returns a Mcp-Session-Id response header', async () => {
    const { sessionId } = await initialize()
    expect(sessionId).toBeTruthy()
    expect(sessionId.length).toBeGreaterThan(0)
  })

  it('returns tools capability', async () => {
    const { result } = await initialize()
    expect(result.result?.capabilities?.tools).toBeDefined()
  })
})

describe('DO transport — tools/list', () => {
  it('returns exactly 35 tools (same as legacy path)', async () => {
    const { sessionId } = await initialize()
    const { data } = await mcpPost(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { 'Mcp-Session-Id': sessionId }
    )
    const tools: Array<{ name: string }> = data.result?.tools ?? []
    expect(tools).toHaveLength(35)
  })

  it('includes all expected tool names', async () => {
    const { sessionId } = await initialize()
    const { data } = await mcpPost(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { 'Mcp-Session-Id': sessionId }
    )
    const names = (data.result?.tools ?? []).map((t: { name: string }) => t.name)
    // Consolidated tools
    expect(names).toContain('lore_manage')
    expect(names).toContain('entity_manage')
    expect(names).toContain('world_manage')
    expect(names).toContain('scene_manage')
    expect(names).toContain('continuity_manage')
    // Meta-tools
    expect(names).toContain('search_tools')
  })
})

describe('DO transport — tools/call', () => {
  it('ping_tool returns pong', async () => {
    const { sessionId } = await initialize()
    const { data } = await mcpPost(
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'ping_tool', arguments: {} },
      },
      { 'Mcp-Session-Id': sessionId }
    )
    expect(data.result?.content?.[0]?.text).toBe('pong')
  })

  it('check_authentication returns authenticated', async () => {
    const { sessionId } = await initialize()
    const { data } = await mcpPost(
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'check_authentication', arguments: {} },
      },
      { 'Mcp-Session-Id': sessionId }
    )
    expect(data.result?.content?.[0]?.text).toContain('Authenticated')
  })

  it('list_topics returns KV keys via DO path', async () => {
    const { sessionId } = await initialize()
    const { data } = await mcpPost(
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'list_topics', arguments: {} },
      },
      { 'Mcp-Session-Id': sessionId }
    )
    // Empty KV is fine — just check for a valid tool result shape
    expect(data.result?.content).toBeDefined()
    expect(Array.isArray(data.result.content)).toBe(true)
  })

  it('returns error for unknown tool', async () => {
    const { sessionId } = await initialize()
    const { data } = await mcpPost(
      {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'nonexistent_tool_xyz', arguments: {} },
      },
      { 'Mcp-Session-Id': sessionId }
    )
    expect(data.result?.isError).toBe(true)
  })
})
