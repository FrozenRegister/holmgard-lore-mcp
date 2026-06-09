import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('legacy bare methods (pre-tools/call)', () => {
  it('list_topics direct method returns keys array', async () => {
    await seedKV('legacy:item1', 'text1')
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'list_topics' }),
    }).then(r => r.json() as Promise<Record<string, any>>)
    expect(res.result.keys).toContain('legacy:item1')
  })

  it('get_lore direct method retrieves by key param', async () => {
    await seedKV('legacy:thing', 'Legacy content')
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'get_lore', params: { key: 'legacy:thing' } }),
    }).then(r => r.json() as Promise<Record<string, any>>)
    expect(res.result.text).toBe('Legacy content')
  })
})

