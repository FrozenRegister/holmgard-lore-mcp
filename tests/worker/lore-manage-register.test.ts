// Tests for lore_manage registration via registerTool() (#545)
import { describe } from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it } from 'vitest'
import { getToolHandler } from '../../src/tools/register'

describe('lore_manage via registerTool() (Phase 4 #545)', () => {
  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    })

    const resClone = res.clone()
    let json: Record<string, any>
    try {
      json = (await res.json()) as Record<string, any>
    } catch (e) {
      const text = await resClone.text()
      if (text.includes('Internal Server Error') || text.includes('Error:')) {
        return { error: true, message: text }
      }
      throw new Error(`Failed to parse response: ${text}`, { cause: e })
    }

    const text = json.result?.content?.[0]?.text
    if (text) {
      try {
        return JSON.parse(text)
      } catch {
        return { error: true, message: `Failed to parse response text: ${text}` }
      }
    }
    return json
  }

  it('getToolHandler resolves lore_manage', () => {
    const handler = getToolHandler('lore_manage')
    expect(handler).toBeDefined()
    expect(typeof handler).toBe('function')
  })

  it('handles list action via MCP endpoint', async () => {
    const r = await callTool('lore_manage', { action: 'list' })
    expect(r.error).toBeFalsy()
  })

  it('handles validate action via MCP endpoint', async () => {
    const r = await callTool('lore_manage', { action: 'validate', query_string: 'test' })
    expect(r.error || r.success === false).toBeTruthy()
  })

  it('rejects missing action via MCP endpoint', async () => {
    const r = await callTool('lore_manage', { query: 'test' })
    expect(r.error || r.success === false).toBeTruthy()
  })

  it('rejects invalid action via MCP endpoint', async () => {
    const r = await callTool('lore_manage', { action: 'invalid_action_xyz' })
    expect(r.error || r.success === false).toBeTruthy()
  })
})