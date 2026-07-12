// Tests for Phase 3 RPG engine tools (Mnehmos port).
// Verifies basic tool dispatch, D1 round-trips, and gate assertions.
import { describe } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'

describe('RPG engine tools', () => {
  beforeEach(async () => {
    // hexes/landmarks are created by the migrations themselves (#319) — no
    // separate /admin/map/setup-db call needed any more.
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

  // ── meta-tools ────────────────────────────────────────────────────────────

  it('search_tools finds world_manage by keyword', async () => {
    const r = await callTool('search_tools', { query: 'world' })
    expect(r.success).toBe(true)
    expect(r.matches.some((m: any) => m.name === 'world_manage')).toBe(true)
  })

  it('load_tool_schema returns inputSchema for rpg', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'rpg' })
    expect(r.success).toBe(true)
    expect(r.schema.inputSchema.properties.sub).toBeDefined()
  })

  // ── rpg world ──────────────────────────────────────────────────────────────

  it('rpg world create+get round-trip', async () => {
    const created = await callTool('rpg', { sub: 'world', action: 'create', name: 'Holmgard', theme: 'fantasy' })
    expect(created.success).toBe(true)
    expect(created.worldId).toBeTruthy()

    const got = await callTool('rpg', { sub: 'world', action: 'get', worldId: created.worldId })
    expect(got.success).toBe(true)
    expect(got.world.name).toBe('Holmgard')
  })

  it('rpg world list returns created world', async () => {
    await callTool('rpg', { sub: 'world', action: 'create', name: 'Holmgard', theme: 'fantasy' })
    const listed = await callTool('rpg', { sub: 'world', action: 'list' })
    expect(listed.worlds.some((w: any) => w.name === 'Holmgard')).toBe(true)
  })

  // ── rpg strategy gate test (plan requirement) ─────────────────────────────

  it('rpg strategy create_nation after holmgard-main world seed', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'holmgard-main', theme: 'fantasy' })
    expect(world.success).toBe(true)

    const nation = await callTool('rpg', {
      sub: 'strategy',
      action: 'create_nation',
      worldId: world.worldId,
      name: 'The Iron Compact',
      leader: 'High Marshal Voss',
      ideology: 'autocracy',
    })
    expect(nation.success).toBe(true)
    expect(nation.nationId).toBeTruthy()

    const listed = await callTool('rpg', { sub: 'strategy', action: 'list_nations', worldId: world.worldId })
    expect(listed.nations.some((n: any) => n.name === 'The Iron Compact')).toBe(true)
  })

  // ── rpg character ─────────────────────────────────────────────────────────

  it('rpg character create+get+add_xp round-trip', async () => {
    const created = await callTool('rpg', {
      sub: 'character', action: 'create', name: 'Thorin', characterClass: 'Fighter', race: 'Dwarf', level: 1,
    })
    expect(created.success).toBe(true)

    const got = await callTool('rpg', { sub: 'character', action: 'get', characterId: created.characterId })
    expect(got.success).toBe(true)
    expect(got.character.name).toBe('Thorin')

    const xp = await callTool('rpg', { sub: 'character', action: 'add_xp', characterId: created.characterId, xpAmount: 300 })
    expect(xp.success).toBe(true)
    expect(xp.totalXp).toBe(300)
  })

  // ── rpg math ──────────────────────────────────────────────────────────────

  it('rpg math roll returns a number in range', async () => {
    const r = await callTool('rpg', { sub: 'math', action: 'roll', expression: '2d6' })
    expect(r.success).toBe(true)
    expect(r.total).toBeGreaterThanOrEqual(2)
    expect(r.total).toBeLessThanOrEqual(12)
  })

  it('rpg math probability returns a fraction', async () => {
    const r = await callTool('rpg', { sub: 'math', action: 'probability', sides: 6, target: 4 })
    expect(r.success).toBe(true)
    expect(r.probability).toBeGreaterThan(0)
    expect(r.probability).toBeLessThanOrEqual(1)
  })

  // ── rpg party ─────────────────────────────────────────────────────────────

  it('rpg party create+add_member round-trip', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'TestWorld', theme: 'fantasy' })
    const party = await callTool('rpg', {
      sub: 'party', action: 'create', name: 'The Wanderers', worldId: world.worldId,
    })
    expect(party.success).toBe(true)

    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Elara', characterClass: 'Wizard' })
    const added = await callTool('rpg', {
      sub: 'party', action: 'add_member', partyId: party.partyId, characterId: char.characterId,
    })
    expect(added.success).toBe(true)

    const got = await callTool('rpg', { sub: 'party', action: 'get', partyId: party.partyId })
    expect(got.party.members.length).toBeGreaterThan(0)
  })

  // ── rpg quest ─────────────────────────────────────────────────────────────

  it('rpg quest create+complete round-trip', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'QWorld', theme: 'fantasy' })
    const quest = await callTool('rpg', {
      sub: 'quest', action: 'create', worldId: world.worldId, name: 'Slay the Dragon', description: 'Find and slay the ancient dragon.',
    })
    expect(quest.success).toBe(true)

    const done = await callTool('rpg', { sub: 'quest', action: 'complete', questId: quest.questId })
    expect(done.success).toBe(true)

    const got = await callTool('rpg', { sub: 'quest', action: 'get', questId: quest.questId })
    expect(got.quest.status).toBe('completed')
  })

  // ── rpg combat + combat action ────────────────────────────────────────────

  it('rpg combat encounter lifecycle: create → add_combatant → start → next_turn', async () => {
    const enc = await callTool('rpg', { sub: 'combat', action: 'create_encounter' })
    expect(enc.success).toBe(true)

    const added = await callTool('rpg', {
      sub: 'combat',
      action: 'add_combatant',
      id: enc.encounterId,
      token: { id: 'hero-1', name: 'Hero', type: 'pc', initiative: 15, hp: 20 },
    })
    expect(added.success).toBe(true)

    const started = await callTool('rpg', { sub: 'combat', action: 'start', id: enc.encounterId })
    expect(started.success).toBe(true)
    expect(started.status).toBe('active')

    const next = await callTool('rpg', { sub: 'combat', action: 'next_turn', id: enc.encounterId })
    expect(next.success).toBe(true)
  })

  it('rpg combat create_encounter rejects a regionId that does not exist in the regions table', async () => {
    const enc = await callTool('rpg', { sub: 'combat', action: 'create_encounter', regionId: 'location:does-not-exist' })
    expect(enc.error).toBe(true)
    expect(enc.message).toMatch(/regionId/)
  })

  it('rpg combat create_encounter accepts a regionId that exists in the regions table', async () => {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare('INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind('world-1', 'RWorld', 'seed-1', 100, 100, now, now).run()
    await env.RPG_DB.prepare('INSERT INTO regions (id, world_id, name, type, center_x, center_y, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind('region-1', 'world-1', 'Thornwood', 'forest', 0, 0, '#00ff00', now, now).run()

    const enc = await callTool('rpg', { sub: 'combat', action: 'create_encounter', regionId: 'region-1' })
    expect(enc.success).toBe(true)
  })

  it('rpg combat_action apply_damage updates character hp', async () => {
    const char = await callTool('rpg', {
      sub: 'character', action: 'create', name: 'Guard', characterClass: 'Fighter', hp: 20, maxHp: 20,
    })
    const enc = await callTool('rpg', { sub: 'combat', action: 'create_encounter' })

    const dmg = await callTool('rpg', {
      sub: 'combat_action',
      action: 'apply_damage',
      encounterId: enc.encounterId,
      targetIds: [char.characterId],
      damage: 8,
    })
    expect(dmg.success).toBe(true)
    expect(dmg.hpChanges[char.characterId]).toBe(-8)
  })

  // ── rpg spatial ───────────────────────────────────────────────────────────

  it('rpg spatial generate+look+get_exits round-trip', async () => {
    const room = await callTool('rpg', {
      sub: 'spatial',
      action: 'generate', name: 'The Dusty Hall',
      description: 'A long hall with dusty stone floors.',
      biome: 'dungeon',
      exits: [{ direction: 'north', targetRoomId: 'some-room-id' }],
    })
    expect(room.success).toBe(true)

    const look = await callTool('rpg', { sub: 'spatial', action: 'look', roomId: room.roomId })
    expect(look.success).toBe(true)
    expect(look.name).toBe('The Dusty Hall')

    const exits = await callTool('rpg', { sub: 'spatial', action: 'get_exits', roomId: room.roomId })
    expect(exits.count).toBe(1)
    expect(exits.exits[0].direction).toBe('north')
  })

  // ── rpg scene ─────────────────────────────────────────────────────────────

  it('rpg scene create+get+get_latest round-trip', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'SceneWorld', theme: 'fantasy' })
    const scene = await callTool('rpg', {
      sub: 'scene',
      action: 'create',
      worldId: world.worldId,
      title: 'The Awakening',
      narration: 'The heroes stir from their long slumber.',
    })
    expect(scene.success).toBe(true)

    const got = await callTool('rpg', { sub: 'scene', action: 'get', id: scene.sceneId })
    expect(got.success).toBe(true)
    expect(got.scene.title).toBe('The Awakening')

    const latest = await callTool('rpg', { sub: 'scene', action: 'get_latest', worldId: world.worldId })
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

  it('load_tool_schema returns sub-level schema for rpg (+sub param) (#339)', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'combat' })
    expect(r.success).toBe(true)
    expect(r.schema.name).toContain('rpg.sub:combat')
    expect(r.schema.description).toContain('combat')
  })

  it('load_tool_schema errors for unknown rpg sub with did_you_mean (#339)', async () => {
    // "corps" should fuzzy-match "corpse" above the 0.3 threshold
    const r = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'corps' })
    expect(r.error).toBe(true)
    expect(r.didYouMean).toBeDefined()
    expect(r.didYouMean.length).toBeGreaterThan(0)
    expect(r.didYouMean.some((s: any) => s.name === 'corpse')).toBe(true)
  })

  // ── rpg world — remaining actions ─────────────────────────────────────────

  it('rpg world update, generate, get_state, delete', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'Origin', theme: 'fantasy' })
    const updated = await callTool('rpg', { sub: 'world', action: 'update', worldId: world.worldId, name: 'Renamed' })
    expect(updated.success).toBe(true)

    const generated = await callTool('rpg', { sub: 'world', action: 'generate', name: 'Procgen World' })
    expect(generated.success).toBe(true)
    expect(generated.worldId).toBeTruthy()

    const state = await callTool('rpg', { sub: 'world', action: 'get_state', id: world.worldId })
    expect(state.success).toBe(true)
    expect(state.world).toBeTruthy()

    const deleted = await callTool('rpg', { sub: 'world', action: 'delete', worldId: world.worldId })
    expect(deleted.success).toBe(true)
    const gone = await callTool('rpg', { sub: 'world', action: 'get', worldId: world.worldId })
    expect(gone.error).toBe(true)
  })

  it('rpg world create requires a name', async () => {
    const r = await callTool('rpg', { sub: 'world', action: 'create' })
    expect(r.error).toBe(true)
  })

  it('rpg world create auto-seeds the default biome registry (#274)', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'BiomeWorld', theme: 'fantasy' })
    const biomes = await callTool('rpg', { sub: 'biome', action: 'list', worldId: world.worldId })
    expect(biomes.success).toBe(true)
    expect(biomes.count).toBeGreaterThan(0)
    expect(biomes.biomes.some((b: any) => b.name === 'forest')).toBe(true)
  })

  it('rpg world generate auto-seeds the default biome registry (#274)', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'generate', name: 'ProcgenBiomeWorld' })
    const biomes = await callTool('rpg', { sub: 'biome', action: 'list', worldId: world.worldId })
    expect(biomes.success).toBe(true)
    expect(biomes.count).toBeGreaterThan(0)
  })

  it('rpg world create auto-seeds the default zone-type registry (#320)', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'ZoneTypeWorld', theme: 'fantasy' })
    const zoneTypes = await callTool('rpg', { sub: 'zone_type', action: 'list', worldId: world.worldId })
    expect(zoneTypes.success).toBe(true)
    expect(zoneTypes.count).toBeGreaterThan(0)
    expect(zoneTypes.zoneTypes.some((z: any) => z.name === 'perimeter')).toBe(true)
  })

  it('rpg world generate auto-seeds the default zone-type registry (#320)', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'generate', name: 'ProcgenZoneTypeWorld' })
    const zoneTypes = await callTool('rpg', { sub: 'zone_type', action: 'list', worldId: world.worldId })
    expect(zoneTypes.success).toBe(true)
    expect(zoneTypes.count).toBeGreaterThan(0)
  })

  it('rpg world create auto-seeds a world_state row so time.get_date works immediately (#330)', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'TimeStateWorld', theme: 'fantasy' })
    const date = await callTool('rpg', { sub: 'time', action: 'get_date', world_id: world.worldId })
    expect(date.error).toBeUndefined()
    expect(date.success).toBe(true)
  })

  it('rpg world generate auto-seeds a world_state row so time.get_date works immediately (#330)', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'generate', name: 'ProcgenTimeStateWorld' })
    const date = await callTool('rpg', { sub: 'time', action: 'get_date', world_id: world.worldId })
    expect(date.error).toBeUndefined()
    expect(date.success).toBe(true)
  })

  it('rpg time accepts camelCase worldId as an alias for world_id (#336)', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'TimeCasingWorld', theme: 'fantasy' })
    const date = await callTool('rpg', { sub: 'time', action: 'get_date', worldId: world.worldId })
    expect(date.error).toBeUndefined()
    expect(date.success).toBe(true)
  })

  it('rpg stealth is a working alias for perception\'s stealth_check action (#335)', async () => {
    const r = await callTool('rpg', { sub: 'stealth', action: 'stealth_check' })
    expect(r.error).toBeUndefined()
    expect(r.success).toBe(true)
    expect(r.actionType).toBe('stealth_check')
  })

  it('rpg world get requires id or worldId', async () => {
    const r = await callTool('rpg', { sub: 'world', action: 'get' })
    expect(r.error).toBe(true)
  })

  // ── rpg party — remaining actions ─────────────────────────────────────────

  it('rpg party list, update, remove_member, set_leader, delete', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'PartyWorld', theme: 'fantasy' })
    const party = await callTool('rpg', { sub: 'party', action: 'create', name: 'The Crew', worldId: world.worldId })
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Rook', characterClass: 'Rogue' })
    await callTool('rpg', { sub: 'party', action: 'add_member', partyId: party.partyId, characterId: char.characterId })

    const listed = await callTool('rpg', { sub: 'party', action: 'list' })
    expect(listed.parties.some((p: any) => p.name === 'The Crew')).toBe(true)

    const updated = await callTool('rpg', { sub: 'party', action: 'update', id: party.partyId, name: 'The Crew Renamed', status: 'dormant' })
    expect(updated.success).toBe(true)

    const leader = await callTool('rpg', { sub: 'party', action: 'set_leader', partyId: party.partyId, characterId: char.characterId })
    expect(leader.leaderId).toBe(char.characterId)

    const removed = await callTool('rpg', { sub: 'party', action: 'remove_member', partyId: party.partyId, characterId: char.characterId })
    expect(removed.success).toBe(true)

    const deleted = await callTool('rpg', { sub: 'party', action: 'delete', id: party.partyId })
    expect(deleted.success).toBe(true)
  })

  it('rpg party create requires a name; get requires partyId/id', async () => {
    const noName = await callTool('rpg', { sub: 'party', action: 'create' })
    expect(noName.error).toBe(true)
    const noId = await callTool('rpg', { sub: 'party', action: 'get' })
    expect(noId.error).toBe(true)
    const notFound = await callTool('rpg', { sub: 'party', action: 'get', partyId: 'nonexistent-party' })
    expect(notFound.error).toBe(true)
  })

  // ── rpg quest — remaining actions ─────────────────────────────────────────

  it('rpg quest list, update, fail, add_objective, complete_objective, delete', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'QuestWorld2', theme: 'fantasy' })
    const quest = await callTool('rpg', {
      sub: 'quest', action: 'create', worldId: world.worldId, name: 'Retrieve the Amulet', description: 'Find it.',
    })

    const listed = await callTool('rpg', { sub: 'quest', action: 'list', worldId: world.worldId })
    expect(listed.quests.some((q: any) => q.name === 'Retrieve the Amulet')).toBe(true)

    const updated = await callTool('rpg', { sub: 'quest', action: 'update', id: quest.questId, name: 'Retrieve the Lost Amulet' })
    expect(updated.success).toBe(true)

    const withObjective = await callTool('rpg', {
      sub: 'quest', action: 'add_objective', id: quest.questId, objective: { description: 'Find the cave', completed: false },
    })
    expect(withObjective.objectiveCount).toBe(1)

    const completedObjective = await callTool('rpg', { sub: 'quest', action: 'complete_objective', id: quest.questId, objectiveIndex: 0 })
    expect(completedObjective.allObjectivesComplete).toBe(true)

    const failed = await callTool('rpg', { sub: 'quest', action: 'fail', questId: quest.questId })
    expect(failed.status).toBe('failed')

    const deleted = await callTool('rpg', { sub: 'quest', action: 'delete', questId: quest.questId })
    expect(deleted.success).toBe(true)
  })

  it('rpg quest create requires name and worldId; get 404s for unknown quest', async () => {
    const noName = await callTool('rpg', { sub: 'quest', action: 'create', worldId: 'w1' })
    expect(noName.error).toBe(true)
    const notFound = await callTool('rpg', { sub: 'quest', action: 'get', questId: 'nonexistent-quest' })
    expect(notFound.error).toBe(true)
  })

  it('rpg quest complete_objective rejects an out-of-range index', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'QuestWorld3', theme: 'fantasy' })
    const quest = await callTool('rpg', { sub: 'quest', action: 'create', worldId: world.worldId, name: 'Empty Quest' })
    const r = await callTool('rpg', { sub: 'quest', action: 'complete_objective', questId: quest.questId, objectiveIndex: 5 })
    expect(r.error).toBe(true)
  })

  // ── rpg math — remaining actions ──────────────────────────────────────────

  it('rpg math solve/simplify report unavailable; projectile computes trajectory', async () => {
    const solve = await callTool('rpg', { sub: 'math', action: 'solve', equation: 'x+1=2' })
    expect(solve.success).toBe(false)
    const simplify = await callTool('rpg', { sub: 'math', action: 'simplify', expression: 'x+x' })
    expect(simplify.success).toBe(false)

    const proj = await callTool('rpg', { sub: 'math', action: 'projectile', velocity: 20, angle: 45 })
    expect(proj.success).toBe(true)
    expect(proj.range).toBeGreaterThan(0)
  })

  it('rpg math roll/probability/projectile require their params', async () => {
    const noExpr = await callTool('rpg', { sub: 'math', action: 'roll' })
    expect(noExpr.error).toBe(true)
    const noTarget = await callTool('rpg', { sub: 'math', action: 'probability', sides: 6 })
    expect(noTarget.error).toBe(true)
    const noVelocity = await callTool('rpg', { sub: 'math', action: 'projectile' })
    expect(noVelocity.error).toBe(true)
  })

  // ── rpg combat — remaining actions ────────────────────────────────────────

  it('rpg combat get_encounter, list_encounters, remove_combatant, get_state, end', async () => {
    const enc = await callTool('rpg', { sub: 'combat', action: 'create_encounter' })
    await callTool('rpg', {
      sub: 'combat', action: 'add_combatant', id: enc.encounterId,
      token: { id: 'goblin-1', name: 'Goblin', type: 'enemy', initiative: 8 },
    })

    const got = await callTool('rpg', { sub: 'combat', action: 'get_encounter', id: enc.encounterId })
    expect(got.encounter.tokens.length).toBe(1)

    const listed = await callTool('rpg', { sub: 'combat', action: 'list_encounters' })
    expect(listed.encounters.some((e: any) => e.id === enc.encounterId)).toBe(true)

    const state = await callTool('rpg', { sub: 'combat', action: 'get_state', id: enc.encounterId })
    expect(state.tokenCount).toBe(1)

    const removed = await callTool('rpg', { sub: 'combat', action: 'remove_combatant', id: enc.encounterId, tokenId: 'goblin-1' })
    expect(removed.remainingCombatants).toBe(0)

    const ended = await callTool('rpg', { sub: 'combat', action: 'end', id: enc.encounterId })
    expect(ended.status).toBe('completed')
  })

  it('rpg combat get_encounter 404s for an unknown id', async () => {
    const r = await callTool('rpg', { sub: 'combat', action: 'get_encounter', id: 'nonexistent-encounter' })
    expect(r.error).toBe(true)
  })

  it('rpg combat add_combatant auto-generates token from characterId (#343)', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Grimslade', characterClass: 'Fighter', hp: 25, maxHp: 25 })
    const enc = await callTool('rpg', { sub: 'combat', action: 'create_encounter' })
    const added = await callTool('rpg', { sub: 'combat', action: 'add_combatant', id: enc.encounterId, characterId: char.characterId })
    expect(added.success).toBe(true)
    expect(added.token.name).toBe('Grimslade')
  })

  it('rpg combat add_combatant errors without token or characterId (#343)', async () => {
    const enc = await callTool('rpg', { sub: 'combat', action: 'create_encounter' })
    const r = await callTool('rpg', { sub: 'combat', action: 'add_combatant', id: enc.encounterId })
    expect(r.error).toBe(true)
    expect(r.message).toContain('token')
  })

  // ── rpg combat_map ─────────────────────────────────────────────────────────

  it('rpg combat_map create+get+update+move_token+render+delete round-trip', async () => {
    const enc = await callTool('rpg', { sub: 'combat', action: 'create_encounter' })
    const map = await callTool('rpg', {
      sub: 'combat_map', action: 'create', encounterId: enc.encounterId, width: 5, height: 5,
      terrain: [{ x: 1, y: 1, type: 'wall' }],
    })
    expect(map.success).toBe(true)

    const got = await callTool('rpg', { sub: 'combat_map', action: 'get', id: map.mapId })
    expect(got.map.grid_data.width).toBe(5)

    const gotByEncounter = await callTool('rpg', { sub: 'combat_map', action: 'get', encounterId: enc.encounterId })
    expect(gotByEncounter.success).toBe(true)

    const updated = await callTool('rpg', { sub: 'combat_map', action: 'update', id: map.mapId, width: 8 })
    expect(updated.success).toBe(true)

    const moved = await callTool('rpg', { sub: 'combat_map', action: 'move_token', id: map.mapId, tokenId: 'hero-1', x: 2, y: 3 })
    expect(moved.x).toBe(2)
    expect(moved.y).toBe(3)

    const movedAgain = await callTool('rpg', { sub: 'combat_map', action: 'move_token', id: map.mapId, tokenId: 'hero-1', x: 4, y: 4 })
    expect(movedAgain.success).toBe(true)

    const rendered = await callTool('rpg', { sub: 'combat_map', action: 'render', id: map.mapId })
    expect(rendered.ascii).toContain('┌')

    const renderedByEncounter = await callTool('rpg', { sub: 'combat_map', action: 'render', encounterId: enc.encounterId })
    expect(renderedByEncounter.success).toBe(true)

    const deleted = await callTool('rpg', { sub: 'combat_map', action: 'delete', id: map.mapId })
    expect(deleted.success).toBe(true)
  })

  it('rpg combat_map validates required params and 404s on missing battlefield', async () => {
    const noEncounter = await callTool('rpg', { sub: 'combat_map', action: 'create' })
    expect(noEncounter.error).toBe(true)
    const noId = await callTool('rpg', { sub: 'combat_map', action: 'get' })
    expect(noId.error).toBe(true)
    const notFound = await callTool('rpg', { sub: 'combat_map', action: 'get', id: 'nonexistent-map' })
    expect(notFound.error).toBe(true)
    const updateNoId = await callTool('rpg', { sub: 'combat_map', action: 'update' })
    expect(updateNoId.error).toBe(true)
    const moveMissingFields = await callTool('rpg', { sub: 'combat_map', action: 'move_token', id: 'x' })
    expect(moveMissingFields.error).toBe(true)
    const deleteNoId = await callTool('rpg', { sub: 'combat_map', action: 'delete' })
    expect(deleteNoId.error).toBe(true)
  })

  // ── rpg combat_action — remaining actions ─────────────────────────────────

  it('rpg combat_action attack, heal, apply_condition, remove_condition, use_ability, get_log, get_turn_summary', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Duelist', characterClass: 'Fighter', hp: 15, maxHp: 20 })
    const enc = await callTool('rpg', { sub: 'combat', action: 'create_encounter' })

    const attack = await callTool('rpg', {
      sub: 'combat_action', action: 'attack', encounterId: enc.encounterId, actorId: char.characterId, targetIds: ['target-1'], attackRoll: 15, damage: 5,
    })
    expect(attack.hit).toBe(true)
    expect(attack.damage).toBe(5)

    const miss = await callTool('rpg', {
      sub: 'combat_action', action: 'attack', encounterId: enc.encounterId, actorId: char.characterId, targetIds: ['target-1'], attackRoll: 2,
    })
    expect(miss.hit).toBe(false)

    const heal = await callTool('rpg', { sub: 'combat_action', action: 'heal', targetIds: [char.characterId], healAmount: 3 })
    expect(heal.hpChanges[char.characterId]).toBe(3)

    const condition = await callTool('rpg', { sub: 'combat_action', action: 'apply_condition', targetIds: [char.characterId], conditionName: 'poisoned' })
    expect(condition.success).toBe(true)

    const removeCondition = await callTool('rpg', { sub: 'combat_action', action: 'remove_condition', targetIds: [char.characterId], conditionName: 'poisoned' })
    expect(removeCondition.success).toBe(true)

    const ability = await callTool('rpg', { sub: 'combat_action', action: 'use_ability', actorId: char.characterId, abilityName: 'Cleave', description: 'sweeping strike' })
    expect(ability.success).toBe(true)

    const log = await callTool('rpg', { sub: 'combat_action', action: 'get_log', encounterId: enc.encounterId })
    expect(log.count).toBeGreaterThan(0)

    const summary = await callTool('rpg', { sub: 'combat_action', action: 'get_turn_summary', encounterId: enc.encounterId, round: 1 })
    expect(summary.success).toBe(true)
  })

  it('rpg combat_action validates required params for each action', async () => {
    const noAttack = await callTool('rpg', { sub: 'combat_action', action: 'attack' })
    expect(noAttack.error).toBe(true)
    const noDamage = await callTool('rpg', { sub: 'combat_action', action: 'apply_damage' })
    expect(noDamage.error).toBe(true)
    const noHeal = await callTool('rpg', { sub: 'combat_action', action: 'heal' })
    expect(noHeal.error).toBe(true)
    const noCondition = await callTool('rpg', { sub: 'combat_action', action: 'apply_condition' })
    expect(noCondition.error).toBe(true)
    const noRemoveCondition = await callTool('rpg', { sub: 'combat_action', action: 'remove_condition' })
    expect(noRemoveCondition.error).toBe(true)
    const noAbility = await callTool('rpg', { sub: 'combat_action', action: 'use_ability' })
    expect(noAbility.error).toBe(true)
    const noLog = await callTool('rpg', { sub: 'combat_action', action: 'get_log' })
    expect(noLog.error).toBe(true)
    const noSummary = await callTool('rpg', { sub: 'combat_action', action: 'get_turn_summary' })
    expect(noSummary.error).toBe(true)
  })

  // ── rpg strategy — remaining actions ──────────────────────────────────────

  it('rpg strategy get_state (public + private), propose_alliance, claim_region', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'StrategyWorld', theme: 'fantasy' })
    const nationA = await callTool('rpg', { sub: 'strategy', action: 'create_nation', worldId: world.worldId, name: 'Nation A', leader: 'Leader A', ideology: 'democracy' })
    const nationB = await callTool('rpg', { sub: 'strategy', action: 'create_nation', worldId: world.worldId, name: 'Nation B', leader: 'Leader B', ideology: 'theocracy' })

    const publicState = await callTool('rpg', { sub: 'strategy', action: 'get_state', nationId: nationA.nationId })
    expect(publicState.viewType).toBe('public')

    const privateState = await callTool('rpg', { sub: 'strategy', action: 'get_state', nationId: nationA.nationId, viewType: 'private' })
    expect(privateState.claims).toBeDefined()
    expect(privateState.diplomacy).toBeDefined()

    const alliance = await callTool('rpg', { sub: 'strategy', action: 'propose_alliance', fromNationId: nationA.nationId, toNationId: nationB.nationId })
    expect(alliance.allied).toBe(true)

    const regionId = 'region-1'
    await env.RPG_DB.prepare('INSERT INTO regions (id, world_id, name, type, center_x, center_y, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(regionId, world.worldId, 'Contested Region', 'plains', 0, 0, '#ffffff', new Date().toISOString(), new Date().toISOString()).run()
    const claim = await callTool('rpg', { sub: 'strategy', action: 'claim_region', nationId: nationA.nationId, regionId, justification: 'manifest destiny' })
    expect(claim.claimId).toBeTruthy()
  })

  it('rpg strategy create_nation 404s for unknown world; get_state 404s for unknown nation', async () => {
    const noWorld = await callTool('rpg', { sub: 'strategy', action: 'create_nation', worldId: 'nonexistent-world', name: 'N', leader: 'L', ideology: 'tribal' })
    expect(noWorld.error).toBe(true)
    const noNation = await callTool('rpg', { sub: 'strategy', action: 'get_state', nationId: 'nonexistent-nation' })
    expect(noNation.error).toBe(true)
  })

  it('rpg strategy resolve_turn requires an existing turn_state', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'TurnlessWorld', theme: 'fantasy' })
    const r = await callTool('rpg', { sub: 'strategy', action: 'resolve_turn', worldId: world.worldId, turnNumber: 1 })
    expect(r.error).toBe(true)
  })

  // ── rpg spatial — remaining actions ───────────────────────────────────────

  it('rpg spatial update, move, list, network_create, network_get, network_list', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'SpatialWorld', theme: 'fantasy' })
    const roomA = await callTool('rpg', { sub: 'spatial', action: 'generate', name: 'Entry Hall', description: 'A grand entry hall.', biome: 'urban' })
    const roomB = await callTool('rpg', {
      sub: 'spatial', action: 'generate', name: 'Inner Sanctum', description: 'A quiet sanctum.', biome: 'divine',
      exits: [{ direction: 'south', targetRoomId: roomA.roomId }],
    })
    const updatedRoomA = await callTool('rpg', {
      sub: 'spatial', action: 'update', roomId: roomA.roomId,
      exits: [{ direction: 'north', targetRoomId: roomB.roomId }],
    })
    expect(updatedRoomA.success).toBe(true)

    const moved = await callTool('rpg', { sub: 'spatial', action: 'move', roomId: roomA.roomId, direction: 'north' })
    expect(moved.toRoomId).toBe(roomB.roomId)

    const listed = await callTool('rpg', { sub: 'spatial', action: 'list' })
    expect(listed.rooms.length).toBeGreaterThanOrEqual(2)

    const network = await callTool('rpg', { sub: 'spatial', action: 'network_create', name: 'Sanctum Wing', worldId: world.worldId })
    expect(network.networkId).toBeTruthy()

    const networkGot = await callTool('rpg', { sub: 'spatial', action: 'network_get', networkId: network.networkId })
    expect(networkGot.network).toBeTruthy()

    const networksListed = await callTool('rpg', { sub: 'spatial', action: 'network_list' })
    expect(networksListed.networks.some((n: any) => n.id === network.networkId)).toBe(true)
  })

  it('rpg spatial move fails with no matching exit; validates required params', async () => {
    const room = await callTool('rpg', { sub: 'spatial', action: 'generate', name: 'Dead End', description: 'A dead end corridor.' })
    const noExit = await callTool('rpg', { sub: 'spatial', action: 'move', roomId: room.roomId, direction: 'up' })
    expect(noExit.error).toBe(true)

    const noRoomId = await callTool('rpg', { sub: 'spatial', action: 'look' })
    expect(noRoomId.error).toBe(true)
    const notFound = await callTool('rpg', { sub: 'spatial', action: 'look', roomId: 'nonexistent-room' })
    expect(notFound.error).toBe(true)
    const noName = await callTool('rpg', { sub: 'spatial', action: 'generate' })
    expect(noName.error).toBe(true)
    const noNetwork = await callTool('rpg', { sub: 'spatial', action: 'network_get', networkId: 'nonexistent-network' })
    expect(noNetwork.error).toBe(true)
  })

  // ── rpg scene — remaining actions ─────────────────────────────────────────

  it('rpg scene list, update, delete', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'SceneWorld2', theme: 'fantasy' })
    const scene = await callTool('rpg', { sub: 'scene', action: 'create', worldId: world.worldId, narration: 'A quiet moment.' })

    const listed = await callTool('rpg', { sub: 'scene', action: 'list', worldId: world.worldId })
    expect(listed.scenes.some((s: any) => s.id === scene.sceneId)).toBe(true)

    const updated = await callTool('rpg', { sub: 'scene', action: 'update', id: scene.sceneId, title: 'Renamed Scene' })
    expect(updated.success).toBe(true)

    const deleted = await callTool('rpg', { sub: 'scene', action: 'delete', id: scene.sceneId })
    expect(deleted.success).toBe(true)
    const gone = await callTool('rpg', { sub: 'scene', action: 'get', id: scene.sceneId })
    expect(gone.error).toBe(true)
  })

  it('rpg scene create requires worldId and narration; update rejects empty patch', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'SceneWorld3', theme: 'fantasy' })
    const noWorld = await callTool('rpg', { sub: 'scene', action: 'create', narration: 'x' })
    expect(noWorld.error).toBe(true)
    const noNarration = await callTool('rpg', { sub: 'scene', action: 'create', worldId: world.worldId })
    expect(noNarration.error).toBe(true)

    const scene = await callTool('rpg', { sub: 'scene', action: 'create', worldId: world.worldId, narration: 'x' })
    const emptyUpdate = await callTool('rpg', { sub: 'scene', action: 'update', id: scene.sceneId, participants: [] })
    expect(emptyUpdate.error).toBe(true)
    const notFound = await callTool('rpg', { sub: 'scene', action: 'update', id: 'nonexistent-scene', title: 'x' })
    expect(notFound.error).toBe(true)
    const deleteNotFound = await callTool('rpg', { sub: 'scene', action: 'delete', id: 'nonexistent-scene' })
    expect(deleteNotFound.error).toBe(true)
  })
})
