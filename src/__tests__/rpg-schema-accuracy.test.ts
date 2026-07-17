// #423 — the world_map sub-schema (SUB_SCHEMAS in index.ts) previously advertised
// square-grid actions (generate/get_hex/set_hex/get_map) and x/y coordinates that
// don't exist in the real hex-axial handler (world-map.ts, rewritten for #320).
// #424 — the aliasOf pattern (maps->world_map, stealth->perception, etc.) had no
// discoverability path beyond guessing; load_tool_schema({toolName:"rpg"})'s
// no-sub response now surfaces an `aliases` map.
import { describe } from './helpers'
import { SELF } from 'cloudflare:test'
import { expect, it } from 'vitest'

// load_tool_schema (and every other rpg-registry tool routed through wrap() in
// rpg/registry.ts) returns its payload as ok(data) — a JSON-stringified blob
// inside content[0].text, not spread at the top level of the JSON-RPC result
// the way entity_manage/lore_manage-style handlers do. The shared callTool in
// ./helpers returns the raw envelope, so rpg-tool tests need this unwrapping
// variant instead — same pattern as rpg-tools.test.ts and rpg-handler-aliases.test.ts.
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

describe('world_map schema accuracy (#423)', () => {
  it('advertises the real hex-axial actions, not the stale square-grid ones', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'world_map' })
    expect(r.success).toBe(true)
    const description: string = r.schema.description
    for (const action of ['overview', 'region', 'hexes', 'patch', 'batch', 'preview', 'find_poi', 'suggest_poi', 'update_poi', 'query_zone', 'list_zones', 'render_svg']) {
      expect(description).toContain(action)
    }
    // Word-boundary match — plain .toContain('get_hex') would false-positive
    // against the real 'get_hexes' alias name that legitimately appears now.
    for (const staleAction of ['generate', 'get_hex', 'set_hex', 'get_map', 'list_regions']) {
      expect(description).not.toMatch(new RegExp(`\\b${staleAction}\\b`))
    }
  })

  it('advertises hex-axial q/r coordinates, not square-grid x/y', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'world_map' })
    const props = r.schema.inputSchema.properties
    expect(props.q).toBeDefined()
    expect(props.r).toBeDefined()
    expect(props.x).toBeUndefined()
    expect(props.y).toBeUndefined()
  })

  it('includes the real handler parameters (mapId, hexes array, POI/zone fields)', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'world_map' })
    const props = r.schema.inputSchema.properties
    expect(props.mapId).toBeDefined()
    expect(props.hexes).toBeDefined()
    expect(props.structureType).toBeDefined()
    expect(props.zoneType).toBeDefined()
    expect(props.renderWidth).toBeDefined()
  })

  it('the maps alias inherits the corrected world_map schema', async () => {
    const worldMap = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'world_map' })
    const maps = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'maps' })
    expect(maps.schema.inputSchema).toEqual(worldMap.schema.inputSchema)
    expect(maps.schema.description).toBe(worldMap.schema.description)
  })
})

describe('rpg tool aliases map (#424)', () => {
  it('load_tool_schema({toolName:"rpg"}) with no sub includes an aliases map', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'rpg' })
    expect(r.success).toBe(true)
    expect(r.aliases).toBeDefined()
    expect(r.aliases.maps).toBe('world_map')
    expect(r.aliases.stealth).toBe('perception')
    expect(r.aliases.characters).toBe('character')
    expect(r.aliases.npc_dialogue).toBe('npc')
  })

  it('does not include an aliases key for non-rpg tools', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'entity_manage' })
    expect(r.success).toBe(true)
    expect(r.aliases).toBeUndefined()
  })

  it('sub-level lookups (with a sub param) do not carry the top-level aliases map', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'world_map' })
    expect(r.success).toBe(true)
    expect(r.aliases).toBeUndefined()
  })
})
