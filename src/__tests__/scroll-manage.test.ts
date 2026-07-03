// Tests for scroll_manage — previously declined as out-of-scope in issue #74;
// implemented per issue #206.
import { describe } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'

describe('scroll_manage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    })
    const json = await res.json() as Record<string, any>
    const text = json.result?.content?.[0]?.text
    return text ? JSON.parse(text) : json
  }

  it('create+get_details+get_dc+use+identify round-trip', async () => {
    const scroll = await callTool('rpg', { sub: 'scroll', action: 'create', name: 'Scroll of Fireball', spellName: 'Fireball', spellLevel: 3, saveDc: 15, charges: 1 })
    expect(scroll.success).toBe(true)

    const unidentified = await callTool('rpg', { sub: 'scroll', action: 'get_details', id: scroll.scrollId })
    expect(unidentified.identified).toBe(false)

    const dc = await callTool('rpg', { sub: 'scroll', action: 'get_dc', id: scroll.scrollId })
    expect(dc.saveDc).toBe(15)

    const used = await callTool('rpg', { sub: 'scroll', action: 'use', id: scroll.scrollId, casterId: 'caster-1' })
    expect(used.spellName).toBe('Fireball')
    expect(used.remainingCharges).toBe(0)

    const details = await callTool('rpg', { sub: 'scroll', action: 'get_details', id: scroll.scrollId })
    expect(details.identified).toBe(true)
    expect(details.charges).toBe(0)
  })

  it('use rejects a scroll with no charges remaining', async () => {
    const scroll = await callTool('rpg', { sub: 'scroll', action: 'create', name: 'Spent Scroll', spellName: 'Light', spellLevel: 0, charges: 0 })
    const r = await callTool('rpg', { sub: 'scroll', action: 'use', id: scroll.scrollId })
    expect(r.error).toBe(true)
  })

  it('identify reveals spell details directly', async () => {
    const scroll = await callTool('rpg', { sub: 'scroll', action: 'create', name: 'Mystery Scroll', spellName: 'Invisibility', spellLevel: 2 })
    const r = await callTool('rpg', { sub: 'scroll', action: 'identify', id: scroll.scrollId })
    expect(r.spellName).toBe('Invisibility')
    const details = await callTool('rpg', { sub: 'scroll', action: 'get_details', id: scroll.scrollId })
    expect(details.identified).toBe(true)
  })

  it('create requires name and spellName', async () => {
    const r = await callTool('rpg', { sub: 'scroll', action: 'create', name: 'No Spell' })
    expect(r.error).toBe(true)
  })

  it('use/identify/get_dc/get_details require id and 404 for an unknown scroll', async () => {
    const noId = await callTool('rpg', { sub: 'scroll', action: 'use' })
    expect(noId.error).toBe(true)
    const notFound = await callTool('rpg', { sub: 'scroll', action: 'use', id: 'nonexistent' })
    expect(notFound.error).toBe(true)
    const notFoundIdentify = await callTool('rpg', { sub: 'scroll', action: 'identify', id: 'nonexistent' })
    expect(notFoundIdentify.error).toBe(true)
    const notFoundDc = await callTool('rpg', { sub: 'scroll', action: 'get_dc', id: 'nonexistent' })
    expect(notFoundDc.error).toBe(true)
    const notFoundDetails = await callTool('rpg', { sub: 'scroll', action: 'get_details', id: 'nonexistent' })
    expect(notFoundDetails.error).toBe(true)
  })
})
