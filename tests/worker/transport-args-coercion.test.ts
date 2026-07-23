// #505 — the Shapes MCP bridge stringifies every non-string tools/call
// argument before it reaches this Worker (`true` -> `"true"`, `0.7` ->
// `"0.7"`, an array -> its JSON text). These are end-to-end regression tests
// through the actual /mcp JSON-RPC endpoint (not the handler directly) that
// prove coerceTransportArgs() undoes that stringification before validation.
import { describe } from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'

describe('transport arg coercion end-to-end (#505)', () => {
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
    const json = (await res.json()) as Record<string, any>
    const text = json.result?.content?.[0]?.text
    if (!text) return json
    try {
      return JSON.parse(text)
    } catch {
      return { raw: text }
    }
  }

  it('entity_manage.set_attributes: accepts a stringified boolean merge + stringified numeric attributes', async () => {
    await callTool('lore_manage', { action: 'set', key: 'character:test-npc', text: 'A test NPC.' })

    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'entity_manage',
          arguments: {
            action: 'set_attributes',
            entity_key: 'character:test-npc',
            // As the bridge would send them: JSON.stringify()'d individually.
            attributes: '{"weight-1":0.7,"weight-2":0.15}',
            merge: 'true',
          },
        },
      }),
    })
    const json = (await res.json()) as { result?: Record<string, any>; error?: unknown }

    expect(json.error).toBeUndefined()
    expect(json.result?.attributes).toEqual({ 'weight-1': 0.7, 'weight-2': 0.15 })
    expect(json.result?.merged).toBe(false) // no prior attributes existed to merge into
  })

  it('rpg{sub:waypoint, action:register}: accepts stringified numeric q/r/lat/lon', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'Coercion World' })

    const res = await callTool('rpg', {
      sub: 'waypoint',
      action: 'register',
      worldId: world.worldId,
      name: 'Visby',
      q: '0',
      r: '0',
      lat: '57.6348',
      lon: '18.2948',
    })

    expect(res.success).toBe(true)
    expect(res.q).toBe(0)
    expect(res.r).toBe(0)
  })

  it('rpg{sub:world_map, action:batch}: accepts a stringified hexes array with stringified numeric fields', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'Hex World' })

    const res = await callTool('rpg', {
      sub: 'world_map',
      action: 'batch',
      worldId: world.worldId,
      hexes: JSON.stringify([
        { q: '0', r: '0', biome: 'grass', elevation: '10', moisture: '40', temperature: '15' },
        { q: '1', r: '0', biome: 'grass', elevation: '12', moisture: '35', temperature: '14' },
      ]),
    })

    expect(res.hexesInserted).toBe(2)
  })

  it('lore_manage.set: a bracket-looking-but-invalid-JSON string field is stored verbatim, not parsed', async () => {
    // Starts/ends with [ ] so it passes the "looks like JSON" heuristic in
    // coerceTransportArgs, but the trailing comma makes it invalid JSON —
    // exercises the JSON.parse() catch fallback (must stay a plain string).
    const malformed = '[1, 2,]'
    await callTool('lore_manage', { action: 'set', key: 'test:malformed-json-text', text: malformed })

    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'get_lore',
        params: { key: 'test:malformed-json-text' },
      }),
    })
    const json = (await res.json()) as { result?: { text?: string } }
    expect(json.result?.text).toBe(malformed)
  })
})
