// Tests for agent_manage registration via registerTool() (#544)
import { describe } from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'
import { getToolHandler } from '../../src/tools/register'

describe('agent_manage via registerTool() (Phase 3 #544)', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

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

  // Test that the handler is registered and resolvable
  it('getToolHandler resolves agent_manage', () => {
    const handler = getToolHandler('agent_manage')
    expect(handler).toBeDefined()
    expect(typeof handler).toBe('function')
  })

  // Test that the registered tool can be called via MCP endpoint
  it('handles list action via MCP endpoint', async () => {
    const r = await callTool('agent_manage', {
      action: 'list',
    })
    expect(r.success).toBe(true)
    expect(Array.isArray(r.agents)).toBe(true)
  })

  it('rejects invalid action via MCP endpoint', async () => {
    const r = await callTool('agent_manage', {
      action: 'invalid_action_xyz',
    })
    expect(r.success).toBeFalsy()
  })

  it('handles get action for missing agent gracefully', async () => {
    const r = await callTool('agent_manage', {
      action: 'get',
      id: 'nonexistent-agent-id',
    })
    // Should return an error for a nonexistent agent
    expect(r.success).toBeFalsy()
  })

  it('handles schema validation for required action parameter', async () => {
    const r = await callTool('agent_manage', {
      id: 'some-agent',
    })
    expect(r.success).toBeFalsy()
  })
})
