// Tests for Phase 3 RPG engine tools (Mnehmos port).
// Verifies basic tool dispatch, D1 round-trips, and gate assertions.
import { describe } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'

describe('RPG engine tools', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
    await SELF.fetch('http://example.com/admin/map/setup-db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: 'test-secret-123' }),
    })
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

  // ── meta-tools ────────────────────────────────────────────────────────────

  it('search_tools finds world_manage by keyword', async () => {
    const r = await callTool('search_tools', { query: 'world' })
    expect(r.success).toBe(true)
    expect(r.matches.some((m: any) => m.name === 'world_manage')).toBe(true)
  })

  it('load_tool_schema returns inputSchema for character_manage', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'character_manage' })
    expect(r.success).toBe(true)
    expect(r.schema.inputSchema.properties.action).toBeDefined()
  })

  // ── world_manage ──────────────────────────────────────────────────────────

  it('world_manage create+get round-trip', async () => {
    const created = await callTool('world_manage', { action: 'create', name: 'Holmgard', theme: 'fantasy' })
    expect(created.success).toBe(true)
    expect(created.worldId).toBeTruthy()

    const got = await callTool('world_manage', { action: 'get', worldId: created.worldId })
    expect(got.success).toBe(true)
    expect(got.world.name).toBe('Holmgard')
  })

  it('world_manage list returns created world', async () => {
    await callTool('world_manage', { action: 'create', name: 'Holmgard', theme: 'fantasy' })
    const listed = await callTool('world_manage', { action: 'list' })
    expect(listed.worlds.some((w: any) => w.name === 'Holmgard')).toBe(true)
  })

  // ── strategy_manage gate test (plan requirement) ─────────────────────────

  it('strategy_manage create_nation after holmgard-main world seed', async () => {
    const world = await callTool('world_manage', { action: 'create', name: 'holmgard-main', theme: 'fantasy' })
    expect(world.success).toBe(true)

    const nation = await callTool('strategy_manage', {
      action: 'create_nation',
      worldId: world.worldId,
      name: 'The Iron Compact',
      leader: 'High Marshal Voss',
      ideology: 'autocracy',
    })
    expect(nation.success).toBe(true)
    expect(nation.nationId).toBeTruthy()

    const listed = await callTool('strategy_manage', { action: 'list_nations', worldId: world.worldId })
    expect(listed.nations.some((n: any) => n.name === 'The Iron Compact')).toBe(true)
  })

  // ── character_manage ──────────────────────────────────────────────────────

  it('character_manage create+get+add_xp round-trip', async () => {
    const created = await callTool('character_manage', {
      action: 'create', name: 'Thorin', characterClass: 'Fighter', race: 'Dwarf', level: 1,
    })
    expect(created.success).toBe(true)

    const got = await callTool('character_manage', { action: 'get', characterId: created.characterId })
    expect(got.success).toBe(true)
    expect(got.character.name).toBe('Thorin')

    const xp = await callTool('character_manage', { action: 'add_xp', characterId: created.characterId, xpAmount: 300 })
    expect(xp.success).toBe(true)
    expect(xp.totalXp).toBe(300)
  })

  // ── math_manage ───────────────────────────────────────────────────────────

  it('math_manage roll returns a number in range', async () => {
    const r = await callTool('math_manage', { action: 'roll', expression: '2d6' })
    expect(r.success).toBe(true)
    expect(r.total).toBeGreaterThanOrEqual(2)
    expect(r.total).toBeLessThanOrEqual(12)
  })

  it('math_manage probability returns a fraction', async () => {
    const r = await callTool('math_manage', { action: 'probability', sides: 6, target: 4 })
    expect(r.success).toBe(true)
    expect(r.probability).toBeGreaterThan(0)
    expect(r.probability).toBeLessThanOrEqual(1)
  })

  // ── party_manage ──────────────────────────────────────────────────────────

  it('party_manage create+add_member round-trip', async () => {
    const world = await callTool('world_manage', { action: 'create', name: 'TestWorld', theme: 'fantasy' })
    const party = await callTool('party_manage', {
      action: 'create', name: 'The Wanderers', worldId: world.worldId,
    })
    expect(party.success).toBe(true)

    const char = await callTool('character_manage', { action: 'create', name: 'Elara', characterClass: 'Wizard' })
    const added = await callTool('party_manage', {
      action: 'add_member', partyId: party.partyId, characterId: char.characterId,
    })
    expect(added.success).toBe(true)

    const got = await callTool('party_manage', { action: 'get', partyId: party.partyId })
    expect(got.party.members.length).toBeGreaterThan(0)
  })

  // ── quest_manage ──────────────────────────────────────────────────────────

  it('quest_manage create+complete round-trip', async () => {
    const world = await callTool('world_manage', { action: 'create', name: 'QWorld', theme: 'fantasy' })
    const quest = await callTool('quest_manage', {
      action: 'create', worldId: world.worldId, name: 'Slay the Dragon', description: 'Find and slay the ancient dragon.',
    })
    expect(quest.success).toBe(true)

    const done = await callTool('quest_manage', { action: 'complete', questId: quest.questId })
    expect(done.success).toBe(true)

    const got = await callTool('quest_manage', { action: 'get', questId: quest.questId })
    expect(got.quest.status).toBe('completed')
  })

  // ── combat_manage + combat_action ─────────────────────────────────────────

  it('combat_manage encounter lifecycle: create → add_combatant → start → next_turn', async () => {
    const enc = await callTool('combat_manage', { action: 'create_encounter' })
    expect(enc.success).toBe(true)

    const added = await callTool('combat_manage', {
      action: 'add_combatant',
      id: enc.encounterId,
      token: { id: 'hero-1', name: 'Hero', type: 'pc', initiative: 15, hp: 20 },
    })
    expect(added.success).toBe(true)

    const started = await callTool('combat_manage', { action: 'start', id: enc.encounterId })
    expect(started.success).toBe(true)
    expect(started.status).toBe('active')

    const next = await callTool('combat_manage', { action: 'next_turn', id: enc.encounterId })
    expect(next.success).toBe(true)
  })

  it('combat_action apply_damage updates character hp', async () => {
    const char = await callTool('character_manage', {
      action: 'create', name: 'Guard', characterClass: 'Fighter', hp: 20, maxHp: 20,
    })
    const enc = await callTool('combat_manage', { action: 'create_encounter' })

    const dmg = await callTool('combat_action', {
      action: 'apply_damage',
      encounterId: enc.encounterId,
      targetIds: [char.characterId],
      damage: 8,
    })
    expect(dmg.success).toBe(true)
    expect(dmg.hpChanges[char.characterId]).toBe(-8)
  })

  // ── spatial_manage ────────────────────────────────────────────────────────

  it('spatial_manage generate+look+get_exits round-trip', async () => {
    const room = await callTool('spatial_manage', {
      action: 'generate', name: 'The Dusty Hall',
      description: 'A long hall with dusty stone floors.',
      biome: 'dungeon',
      exits: [{ direction: 'north', targetRoomId: 'some-room-id' }],
    })
    expect(room.success).toBe(true)

    const look = await callTool('spatial_manage', { action: 'look', roomId: room.roomId })
    expect(look.success).toBe(true)
    expect(look.name).toBe('The Dusty Hall')

    const exits = await callTool('spatial_manage', { action: 'get_exits', roomId: room.roomId })
    expect(exits.count).toBe(1)
    expect(exits.exits[0].direction).toBe('north')
  })

  // ── scene_manage ──────────────────────────────────────────────────────────

  it('scene_manage create+get+get_latest round-trip', async () => {
    const world = await callTool('world_manage', { action: 'create', name: 'SceneWorld', theme: 'fantasy' })
    const scene = await callTool('scene_manage', {
      action: 'create',
      worldId: world.worldId,
      title: 'The Awakening',
      narration: 'The heroes stir from their long slumber.',
    })
    expect(scene.success).toBe(true)

    const got = await callTool('scene_manage', { action: 'get', id: scene.sceneId })
    expect(got.success).toBe(true)
    expect(got.scene.title).toBe('The Awakening')

    const latest = await callTool('scene_manage', { action: 'get_latest', worldId: world.worldId })
    expect(latest.success).toBe(true)
    expect(latest.scene.id).toBe(scene.sceneId)
  })

  // ── search_tools + load_tool_schema ───────────────────────────────────────

  it('search_tools returns empty matches for nonsense query', async () => {
    const r = await callTool('search_tools', { query: 'zzznomatch999' })
    expect(r.success).toBe(true)
    expect(r.count).toBe(0)
  })

  it('load_tool_schema returns error for unknown tool', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'definitely_does_not_exist' })
    expect(r.error).toBe(true)
  })
})
