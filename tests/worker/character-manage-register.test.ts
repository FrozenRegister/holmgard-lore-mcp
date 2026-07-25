// Tests for character_manage registration via registerTool() (#543)
import { describe } from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'
import { getToolHandler } from '../../src/tools/register'

describe('character_manage via registerTool() (Phase 2 #543)', () => {
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
  it('getToolHandler resolves character_manage', () => {
    const handler = getToolHandler('character_manage')
    expect(handler).toBeDefined()
    expect(typeof handler).toBe('function')
  })

  // Test that the registered tool can be called via MCP endpoint
  it('handles create action via MCP endpoint', async () => {
    const r = await callTool('character_manage', {
      action: 'create',
      name: 'Test Character',
      characterType: 'npc',
    })
    expect(r.success).toBe(true)
    expect(r.characterId).toBeTruthy()
    expect(r.name).toBe('Test Character')
  })

  it('handles get action via MCP endpoint', async () => {
    // Create a character first
    const createRes = await callTool('character_manage', {
      action: 'create',
      name: 'Fetch Test',
      characterType: 'pc',
      level: 5,
    })
    expect(createRes.success).toBe(true)

    // Now fetch it
    const getRes = await callTool('character_manage', {
      action: 'get',
      id: createRes.characterId,
    })
    expect(getRes.success).toBe(true)
    expect(getRes.character.name).toBe('Fetch Test')
    expect(getRes.character.level).toBe(5)
  })

  it('rejects invalid action via MCP endpoint', async () => {
    const r = await callTool('character_manage', {
      action: 'invalid_action_xyz',
    })
    // Should return an error response
    expect(r.success).toBeFalsy()
  })

  it('handles list action via MCP endpoint', async () => {
    // Create a couple of characters
    await callTool('character_manage', {
      action: 'create',
      name: 'Alice',
      characterType: 'pc',
    })
    await callTool('character_manage', {
      action: 'create',
      name: 'Bob',
      characterType: 'npc',
    })

    // List characters
    const r = await callTool('character_manage', {
      action: 'list',
    })
    expect(r.success).toBe(true)
    expect(Array.isArray(r.characters)).toBe(true)
    expect(r.characters.length).toBeGreaterThanOrEqual(2)
  })

  it('handles schema validation for required action parameter', async () => {
    const r = await callTool('character_manage', {
      name: 'Missing Action',
    })
    // Should fail validation or routing
    expect(r.success).toBeFalsy()
  })
})
