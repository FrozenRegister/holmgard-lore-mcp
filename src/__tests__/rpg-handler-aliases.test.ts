// #404 — cross-sub action aliases. Tier 1 (sub-level aliases: characters,
// maps, npc_dialogue) and Tier 2 (action-level aliases: character/party
// .place_character -> spawn.place_character, character/world_map.move_hex
// -> travel.move_hex) routed through the real dispatcher end-to-end.
import { describe } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'

describe('rpg cross-sub action aliases (#404)', () => {
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

  // ── Tier 1: sub-level aliases ────────────────────────────────────────────

  it('characters is a working alias for character', async () => {
    const created = await callTool('rpg', { sub: 'characters', action: 'create', name: 'Plural Alias Test' })
    expect(created.success).toBe(true)
    const got = await callTool('rpg', { sub: 'character', action: 'get', characterId: created.characterId })
    expect(got.character.name).toBe('Plural Alias Test')
  })

  it('maps is a working alias for world_map', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'Maps Alias World', theme: 'fantasy' })
    const r = await callTool('rpg', { sub: 'maps', action: 'overview', worldId: world.worldId })
    expect(r.success).toBe(true)
    expect(r.actionType).toBe('overview')
  })

  it('npc_dialogue is a working alias for npc', async () => {
    const npc = await callTool('rpg', { sub: 'npc_dialogue', action: 'create', name: 'Merchant Alias Test' })
    expect(npc.success).toBe(true)
    expect(npc.characterType).toBe('npc')
  })

  it('load_tool_schema returns the canonical schema for a Tier 1 alias sub', async () => {
    const canonical = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'character' })
    const alias = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'characters' })
    expect(alias.schema.inputSchema).toEqual(canonical.schema.inputSchema)
    expect(alias.schema.description).toBe(canonical.schema.description)
  })

  it('stealth (pre-existing alias) still resolves to the same schema as perception, now via aliasOf', async () => {
    const canonical = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'perception' })
    const alias = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'stealth' })
    expect(alias.schema.inputSchema).toEqual(canonical.schema.inputSchema)
    expect(alias.schema.description).toBe(canonical.schema.description)
  })

  // ── Tier 2: action-level aliases ─────────────────────────────────────────

  it('character.place_character transparently routes to spawn.place_character', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'Place Char World', theme: 'fantasy' })
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Placeable', worldId: world.worldId })

    const r = await callTool('rpg', { sub: 'character', action: 'place_character', characterId: char.characterId, q: 3, r: 5 })
    expect(r.success).toBe(true)
    expect(r.actionType).toBe('place_character')

    const got = await callTool('rpg', { sub: 'character', action: 'get', characterId: char.characterId })
    expect(got.character.current_hex_q).toBe(3)
    expect(got.character.current_hex_r).toBe(5)
  })

  it('party.place_character transparently routes to spawn.place_character', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'Party Place Char World', theme: 'fantasy' })
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Party Placeable', worldId: world.worldId })

    const r = await callTool('rpg', { sub: 'party', action: 'place_character', characterId: char.characterId, q: 1, r: 1 })
    expect(r.success).toBe(true)
    expect(r.actionType).toBe('place_character')
  })

  it('character.move_hex transparently routes to travel.move_hex', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'Move Hex World', theme: 'fantasy' })
    const party = await callTool('rpg', { sub: 'party', action: 'create', name: 'Movers', worldId: world.worldId })

    const r = await callTool('rpg', {
      sub: 'character', action: 'move_hex', partyId: party.partyId, worldId: world.worldId, toQ: 2, toR: -2,
    })
    expect(r.success).toBe(true)
    expect(r.actionType).toBe('move_hex')
    expect(r.q).toBe(2)
    expect(r.r).toBe(-2)
  })

  it('world_map.move_hex transparently routes to travel.move_hex', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'World Map Move Hex World', theme: 'fantasy' })
    const party = await callTool('rpg', { sub: 'party', action: 'create', name: 'Map Movers', worldId: world.worldId })

    const r = await callTool('rpg', {
      sub: 'world_map', action: 'move_hex', partyId: party.partyId, worldId: world.worldId, toQ: -1, toR: 4,
    })
    expect(r.success).toBe(true)
    expect(r.actionType).toBe('move_hex')
  })

  it('an action with no alias on a sub that has other aliases dispatches normally', async () => {
    const r = await callTool('rpg', { sub: 'character', action: 'create', name: 'Unaliased Action' })
    expect(r.success).toBe(true)
    expect(r.actionType).toBe('create') // no alias interference — dispatched straight through
  })

  it('a missing action still dispatches to the requested sub unaliased (no crash)', async () => {
    const r = await callTool('rpg', { sub: 'character' })
    expect(r.error).toBe(true)
  })
})
