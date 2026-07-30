// tests/worker/two-transport-parity.test.ts
//
// Regression test for #547 (Phase 6 of #540): asserts the JSON-RPC `/mcp`
// handler (src/index.ts) and the HolmgardMCP Durable Object (Streamable HTTP,
// src/do/HolmgardMCP.ts) behave equivalently for the same tools/call and
// tools/list requests. Both transports share dispatchToolCall() (Phase 5,
// src/tools/dispatch.ts) for tool resolution, but each transport still owns
// its own response-shape formatting — this test compares the two at the
// semantic level (tool text, error text, isError), not byte-for-byte, since
// the envelopes are deliberately allowed to differ (JSON-RPC top-level
// `error` vs. an MCP tool result with `isError: true`).
import { describe, seedKV, SELF } from './support/helpers'
import { expect, it } from 'vitest'

// ── Transport helpers ────────────────────────────────────────────────────────

const API_KEY = 'test-api-key-xyz'

async function jsonRpcCall(method: string, params?: unknown): Promise<any> {
  const res = await SELF.fetch('http://example.com/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return res.json()
}

async function extractJsonRpc(res: Response): Promise<any> {
  const ct = res.headers.get('Content-Type') ?? ''
  const text = await res.text()
  if (ct.includes('text/event-stream')) {
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) return JSON.parse(line.slice(6))
    }
    throw new Error(`No SSE data line in response body: ${text.slice(0, 200)}`)
  }
  return JSON.parse(text)
}

async function doInitialize(): Promise<string> {
  const res = await SELF.fetch('http://example.com/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'X-Api-Key': API_KEY,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'parity-test-client', version: '0.0.1' },
      },
    }),
  })
  await extractJsonRpc(res.clone())
  return res.headers.get('Mcp-Session-Id') ?? ''
}

async function doCall(method: string, params: unknown, sessionId: string): Promise<any> {
  const res = await SELF.fetch('http://example.com/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'X-Api-Key': API_KEY,
      'Mcp-Session-Id': sessionId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method, params }),
  })
  return extractJsonRpc(res.clone())
}

// ── Normalization ────────────────────────────────────────────────────────────
// Reduces each transport's response to a comparable shape: whether it was an
// error, and the human-readable text describing the outcome. The envelope
// (top-level JSON-RPC `error` vs. `result.isError` + content block) is
// intentionally NOT part of the comparison — see file header.

interface Normalized {
  isError: boolean
  text: string | undefined
}

function normalizeJsonRpc(data: any): Normalized {
  if (data.error) {
    return { isError: true, text: data.error.message }
  }
  return {
    isError: Boolean(data.result?.isError),
    text: data.result?.content?.[0]?.text,
  }
}

function normalizeDo(data: any): Normalized {
  return {
    isError: Boolean(data.result?.isError),
    text: data.result?.content?.[0]?.text,
  }
}

// ── tools/list parity ────────────────────────────────────────────────────────

describe('Two-transport parity — tools/list', () => {
  it('returns the same set of tool names on both transports', async () => {
    const jsonRpcData = await jsonRpcCall('tools/list')
    const sessionId = await doInitialize()
    const doData = await doCall('tools/list', undefined, sessionId)

    const jsonRpcNames = (jsonRpcData.result?.tools ?? [])
      .map((t: { name: string }) => t.name)
      .sort()
    const doNames = (doData.result?.tools ?? []).map((t: { name: string }) => t.name).sort()

    expect(doNames).toEqual(jsonRpcNames)
    expect(doNames.length).toBeGreaterThan(0)
  })
})

// ── tools/call parity ────────────────────────────────────────────────────────

describe('Two-transport parity — tools/call', () => {
  it('lore_manage ping: pong on both transports', async () => {
    const jsonRpcData = await jsonRpcCall('tools/call', {
      name: 'lore_manage',
      arguments: { action: 'ping' },
    })
    const sessionId = await doInitialize()
    const doData = await doCall(
      'tools/call',
      { name: 'lore_manage', arguments: { action: 'ping' } },
      sessionId,
    )

    const jsonRpcResult = normalizeJsonRpc(jsonRpcData)
    const doResult = normalizeDo(doData)

    expect(jsonRpcResult).toEqual({ isError: false, text: 'pong' })
    expect(doResult).toEqual({ isError: false, text: 'pong' })
  })

  it('lore_manage auth_check: authenticated on both transports', async () => {
    const jsonRpcData = await jsonRpcCall('tools/call', {
      name: 'lore_manage',
      arguments: { action: 'auth_check' },
    })
    const sessionId = await doInitialize()
    const doData = await doCall(
      'tools/call',
      { name: 'lore_manage', arguments: { action: 'auth_check' } },
      sessionId,
    )

    const jsonRpcResult = normalizeJsonRpc(jsonRpcData)
    const doResult = normalizeDo(doData)

    // JSON-RPC computes `authenticated` per-request (valid X-Api-Key here);
    // the DO transport is always authenticated by the time it reaches
    // dispatch (auth is enforced at the Worker level before routing to the
    // DO) — both should report authenticated for this request.
    expect(jsonRpcResult).toEqual({ isError: false, text: 'Authenticated.' })
    expect(doResult).toEqual({ isError: false, text: 'Authenticated.' })
  })

  it('unknown tool: "Method not found" on both transports', async () => {
    const jsonRpcData = await jsonRpcCall('tools/call', {
      name: 'nonexistent_tool_xyz',
      arguments: {},
    })
    const sessionId = await doInitialize()
    const doData = await doCall(
      'tools/call',
      { name: 'nonexistent_tool_xyz', arguments: {} },
      sessionId,
    )

    const jsonRpcResult = normalizeJsonRpc(jsonRpcData)
    const doResult = normalizeDo(doData)

    expect(jsonRpcResult.isError).toBe(true)
    expect(doResult.isError).toBe(true)
    expect(jsonRpcResult.text).toContain('Method not found: tool "nonexistent_tool_xyz"')
    expect(doResult.text).toContain('Method not found: tool "nonexistent_tool_xyz"')
  })

  it('real handler success (lore_manage get): same lore text on both transports', async () => {
    await seedKV('character:parity-test-npc', 'A test NPC used for transport parity checks.')

    const jsonRpcData = await jsonRpcCall('tools/call', {
      name: 'lore_manage',
      arguments: { action: 'get', query: 'character:parity-test-npc' },
    })
    const sessionId = await doInitialize()
    const doData = await doCall(
      'tools/call',
      { name: 'lore_manage', arguments: { action: 'get', query: 'character:parity-test-npc' } },
      sessionId,
    )

    const jsonRpcResult = normalizeJsonRpc(jsonRpcData)
    const doResult = normalizeDo(doData)

    expect(jsonRpcResult.isError).toBe(false)
    expect(doResult.isError).toBe(false)
    expect(jsonRpcResult.text).toContain('A test NPC used for transport parity checks.')
    expect(doResult.text).toEqual(jsonRpcResult.text)
  })

  it('real handler error (lore_manage increment on missing key): same error text on both transports', async () => {
    const args = {
      action: 'increment',
      key: 'character:does-not-exist-parity',
      field_path: 'Reputation',
    }

    const jsonRpcData = await jsonRpcCall('tools/call', { name: 'lore_manage', arguments: args })
    const sessionId = await doInitialize()
    const doData = await doCall('tools/call', { name: 'lore_manage', arguments: args }, sessionId)

    const jsonRpcResult = normalizeJsonRpc(jsonRpcData)
    const doResult = normalizeDo(doData)

    expect(jsonRpcResult.isError).toBe(true)
    expect(doResult.isError).toBe(true)
    expect(jsonRpcResult.text).toContain('Topic "character:does-not-exist-parity" not found')
    expect(doResult.text).toEqual(jsonRpcResult.text)
  })
})
