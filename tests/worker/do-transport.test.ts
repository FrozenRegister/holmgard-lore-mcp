// tests/worker/do-transport.test.ts
// Tests for the HolmgardMCP Durable Object path (Streamable HTTP transport).
// These tests send requests with the Streamable HTTP transport markers so the
// Worker routes them to the DO instead of the legacy JSON-RPC handler.
import { describe, SELF } from './support/helpers'
import { expect, it } from 'vitest'

// ── Helpers ───────────────────────────────────────────────────────────────────

const STREAMABLE_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  'X-Api-Key': 'test-api-key-xyz',
}

async function mcpPost(
  body: unknown,
  extra: Record<string, string> = {},
): Promise<{
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
        Accept: 'application/json, text/event-stream',
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
        Accept: 'application/json, text/event-stream',
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
  it('returns exactly 9 tools (same as legacy path)', async () => {
    const { sessionId } = await initialize()
    const { data } = await mcpPost(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { 'Mcp-Session-Id': sessionId },
    )
    const tools: Array<{ name: string }> = data.result?.tools ?? []
    expect(tools).toHaveLength(9)
  })

  it('includes all expected tool names', async () => {
    const { sessionId } = await initialize()
    const { data } = await mcpPost(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { 'Mcp-Session-Id': sessionId },
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

describe('WebSocket reconnect rate limit', () => {
  it('allows normal WebSocket upgrade requests under the limit', async () => {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'GET',
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
        'CF-Connecting-IP': '1.2.3.1',
        'X-Api-Key': 'test-api-key-xyz',
        Accept: 'text/event-stream',
        'Mcp-Session-Id': 'test-session-rate-limit-1',
      },
    })
    // Should not be rate-limited (first request from this IP)
    expect(res.status).not.toBe(429)
  })

  it('returns 429 with Retry-After after exceeding the reconnect limit', async () => {
    const ip = '1.2.3.99'
    const headers = {
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version': '13',
      'CF-Connecting-IP': ip,
      'X-Api-Key': 'test-api-key-xyz',
      Accept: 'text/event-stream',
      'Mcp-Session-Id': 'test-session-rate-limit-2',
    }
    // Fire 10 requests to exhaust the WS_RECONNECT_LIMIT (10)
    for (let i = 0; i < 10; i++) {
      await SELF.fetch('http://example.com/mcp', { method: 'GET', headers })
    }
    // The 11th should be rate-limited
    const res = await SELF.fetch('http://example.com/mcp', { method: 'GET', headers })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/reconnect/i)
  })

  it('fires Slack notification on first excess request (SLACK_WEBHOOK_URL is set)', async () => {
    // The miniflare env has SLACK_WEBHOOK_URL set to a fake URL. The middleware
    // attempts the fetch on count === WS_RECONNECT_LIMIT + 1; the connection error
    // is caught and swallowed. Response must still be 429 (notification is best-effort).
    const ip = '1.2.3.100'
    const headers = {
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version': '13',
      'CF-Connecting-IP': ip,
      'X-Api-Key': 'test-api-key-xyz',
      Accept: 'text/event-stream',
      'Mcp-Session-Id': 'test-session-rate-limit-3',
    }
    for (let i = 0; i < 10; i++) {
      await SELF.fetch('http://example.com/mcp', { method: 'GET', headers })
    }
    const res = await SELF.fetch('http://example.com/mcp', { method: 'GET', headers })
    // Notification fires asynchronously via waitUntil; response is still 429
    expect(res.status).toBe(429)
  })

  it('does not rate-limit non-WebSocket upgrade requests', async () => {
    // Regular POST to /mcp should not be affected by WS rate limiter
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'CF-Connecting-IP': '1.2.3.99',
        'X-Api-Key': 'test-api-key-xyz',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(res.status).not.toBe(429)
  })
})

describe('DO transport — tools/call', () => {
  it('lore_manage ping returns pong', async () => {
    const { sessionId } = await initialize()
    const { data } = await mcpPost(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'lore_manage', arguments: { action: 'ping' } },
      },
      { 'Mcp-Session-Id': sessionId },
    )
    expect(data.result?.content?.[0]?.text).toBe('pong')
  })

  it('lore_manage auth_check returns authenticated', async () => {
    const { sessionId } = await initialize()
    const { data } = await mcpPost(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'lore_manage', arguments: { action: 'auth_check' } },
      },
      { 'Mcp-Session-Id': sessionId },
    )
    expect(data.result?.content?.[0]?.text).toContain('Authenticated')
  })

  it('lore_manage list returns KV keys via DO path', async () => {
    const { sessionId } = await initialize()
    const { data } = await mcpPost(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'lore_manage', arguments: { action: 'list' } },
      },
      { 'Mcp-Session-Id': sessionId },
    )
    // Empty KV is fine — just check for a valid tool result shape
    expect(data.result?.content).toBeDefined()
    expect(Array.isArray(data.result.content)).toBe(true)
  })

  it('returns error for unknown tool', async () => {
    const { sessionId } = await initialize()
    const { data } = await mcpPost(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'nonexistent_tool_xyz', arguments: {} },
      },
      { 'Mcp-Session-Id': sessionId },
    )
    expect(data.result?.isError).toBe(true)
  })
})
