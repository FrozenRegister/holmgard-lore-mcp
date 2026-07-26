// Tests for agent_manage registration via registerTool() (#544)
// Workers runtime tier — agent_manage touches D1 (agents, agent_prompt_slices, agent_secrets, agent_journal, agent_calls).
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
      throw new Error(`Failed to parse response: ${text}`)
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
  it('handles create action via MCP endpoint', async () => {
    const r = await callTool('agent_manage', {
      action: 'create',
      characterId: '550e8400-e29b-41d4-a716-446655440000',
      model: '@cf/meta/llama-3.1-8b-instruct',
      temperature: 0.7,
      maxTokens: 512,
      budgetTokens: 10000,
    })
    expect(r.success).toBe(true)
    expect(r.agentId).toBeTruthy()
    expect(r.characterId).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('handles get action via MCP endpoint', async () => {
    // Create an agent first
    const createRes = await callTool('agent_manage', {
      action: 'create',
      characterId: '550e8400-e29b-41d4-a716-446655440001',
    })
    expect(createRes.success).toBe(true)

    // Now fetch it
    const getRes = await callTool('agent_manage', {
      action: 'get',
      id: createRes.agentId,
    })
    expect(getRes.success).toBe(true)
    expect(getRes.agent.id).toBe(createRes.agentId)
  })

  it('rejects invalid action via MCP endpoint', async () => {
    const r = await callTool('agent_manage', {
      action: 'invalid_action_xyz',
    })
    // Should return an error response
    expect(r.success).toBeFalsy()
  })

  it('handles list action via MCP endpoint', async () => {
    // Create a couple of agents
    await callTool('agent_manage', {
      action: 'create',
      characterId: '550e8400-e29b-41d4-a716-446655440002',
    })
    await callTool('agent_manage', {
      action: 'create',
      characterId: '550e8400-e29b-41d4-a716-446655440003',
    })

    // List agents
    const r = await callTool('agent_manage', {
      action: 'list',
    })
    expect(r.success).toBe(true)
    expect(Array.isArray(r.agents)).toBe(true)
    expect(r.agents.length).toBeGreaterThanOrEqual(2)
  })

  it('handles health action via MCP endpoint', async () => {
    // Create an agent first
    const createRes = await callTool('agent_manage', {
      action: 'create',
      characterId: '550e8400-e29b-41d4-a716-446655440004',
    })
    expect(createRes.success).toBe(true)

    // Check health
    const healthRes = await callTool('agent_manage', {
      action: 'health',
      id: createRes.agentId,
    })
    expect(healthRes.success).toBe(true)
    expect(healthRes.canInvoke).toBeDefined()
    expect(healthRes.status).toBe('active')
  })

  it('handles set_slice action via MCP endpoint', async () => {
    // Create an agent first
    const createRes = await callTool('agent_manage', {
      action: 'create',
      characterId: '550e8400-e29b-41d4-a716-446655440005',
    })
    expect(createRes.success).toBe(true)

    // Add a prompt slice
    const sliceRes = await callTool('agent_manage', {
      action: 'set_slice',
      id: createRes.agentId,
      kind: 'persona',
      content: 'You are a wise old wizard.',
    })
    expect(sliceRes.success).toBe(true)
    expect(sliceRes.sliceId).toBeTruthy()
    expect(sliceRes.kind).toBe('persona')
  })

  it('handles schema validation for required action parameter', async () => {
    const r = await callTool('agent_manage', {
      model: '@cf/meta/llama-3.1-8b-instruct',
    })
    // Should fail validation or routing
    expect(r.success).toBeFalsy()
  })
})
