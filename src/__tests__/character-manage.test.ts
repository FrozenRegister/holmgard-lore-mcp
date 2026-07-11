// Tests for character_manage tool — D1 character CRUD and progression management
import { describe } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'

describe('character_manage tool', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    })

    const resClone = res.clone()
    let json: Record<string, any>
    try {
      json = await res.json() as Record<string, any>
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

  // ── Lifecycle Tests ──────────────────────────────────────────────────────────

  it('create inserts a new character', async () => {
    const r = await callTool('character_manage', {
      action: 'create',
      name: 'Theron Blackwood',
      characterType: 'pc',
      characterClass: 'Rogue',
      race: 'Half-Elf',
      level: 3
    })
    expect(r.success).toBe(true)
    expect(r.characterId).toBeTruthy()
    expect(r.name).toBe('Theron Blackwood')
    expect(r.characterType).toBe('pc')
  })

  it('create with default stats', async () => {
    const r = await callTool('character_manage', {
      action: 'create',
      name: 'Basic Character'
    })
    expect(r.success).toBe(true)
    const char = await callTool('character_manage', { action: 'get', id: r.characterId })
    expect(char.character.stats).toEqual({
      str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10
    })
  })

  it('create with custom stats', async () => {
    const stats = { str: 16, dex: 14, con: 15, int: 12, wis: 13, cha: 8 }
    const r = await callTool('character_manage', {
      action: 'create',
      name: 'Barbarian',
      stats
    })
    expect(r.success).toBe(true)
    const char = await callTool('character_manage', { action: 'get', id: r.characterId })
    expect(char.character.stats).toEqual(stats)
  })

  it('create accepts custom values for every character field', async () => {
    const payload = {
      action: 'create',
      name: 'Ancient Wyrm',
      characterType: 'enemy',
      characterClass: 'Dragon',
      race: 'Wyrm',
      level: 20,
      hp: 300,
      maxHp: 300,
      ac: 22,
      stats: { str: 27, dex: 10, con: 25, int: 16, wis: 15, cha: 19 },
      factionId: 'faction:dragons',
      behavior: 'territorial',
      background: 'Ancient hoarder',
      alignment: 'Chaotic Evil',
      origin: 'The Sundered Peaks',
      conditions: ['frightened'],
      resistances: ['fire'],
      vulnerabilities: ['cold'],
      immunities: ['poison'],
      knownSpells: ['fireball'],
      preparedSpells: ['fireball'],
      cantripsKnown: ['fire-bolt'],
      spellSlots: { '3': { max: 3, current: 3 } },
      pactMagicSlots: { max: 2, current: 2, level: 3 },
      maxSpellLevel: 5,
      concentratingOn: 'mage-armor',
      legendaryActions: 3,
      legendaryActionsRemaining: 3,
      legendaryResistances: 3,
      legendaryResistancesRemaining: 3,
      hasLairActions: true,
      currency: { gold: 5000, silver: 0, copper: 0 },
      currentRoomId: null,
      perceptionBonus: 8,
      stealthBonus: 2,
      resourcePools: { breathWeapon: { max: 1, current: 1 } },
    }
    const r = await callTool('character_manage', payload)
    expect(r.success).toBe(true)

    const char = await callTool('character_manage', { action: 'get', id: r.characterId })
    expect(char.character.stats).toEqual(payload.stats)
    expect(char.character.faction_id).toBe('faction:dragons')
    expect(char.character.behavior).toBe('territorial')
    expect(char.character.origin).toBe('The Sundered Peaks')
    expect(char.character.conditions).toEqual(['frightened'])
    expect(char.character.resistances).toEqual(['fire'])
    expect(char.character.vulnerabilities).toEqual(['cold'])
    expect(char.character.immunities).toEqual(['poison'])
    expect(char.character.known_spells).toEqual(['fireball'])
    expect(char.character.prepared_spells).toEqual(['fireball'])
    expect(char.character.cantrips_known).toEqual(['fire-bolt'])
    expect(char.character.spell_slots).toEqual({ '3': { max: 3, current: 3 } })
    expect(char.character.pact_magic_slots).toEqual({ max: 2, current: 2, level: 3 })
    expect(char.character.max_spell_level).toBe(5)
    expect(char.character.concentrating_on).toBe('mage-armor')
    expect(char.character.legendary_actions).toBe(3)
    expect(char.character.legendary_actions_remaining).toBe(3)
    expect(char.character.legendary_resistances).toBe(3)
    expect(char.character.legendary_resistances_remaining).toBe(3)
    expect(char.character.has_lair_actions).toBe(1)
    expect(char.character.currency).toEqual({ gold: 5000, silver: 0, copper: 0 })
    expect(char.character.perception_bonus).toBe(8)
    expect(char.character.stealth_bonus).toBe(2)
    expect(char.character.resource_pools).toEqual({ breathWeapon: { max: 1, current: 1 } })
  })

  it('create without name returns error', async () => {
    const r = await callTool('character_manage', { action: 'create' })
    expect(r.error).toBe(true)
    expect(r.message).toContain('required')
  })

  it('get retrieves character by ID', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Syreth'
    })
    const r = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(r.success).toBe(true)
    expect(r.character.name).toBe('Syreth')
    expect(r.character.id).toBe(created.characterId)
  })

  it('get with characterId parameter', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Lyra'
    })
    const r = await callTool('character_manage', { action: 'get', characterId: created.characterId })
    expect(r.success).toBe(true)
    expect(r.character.name).toBe('Lyra')
  })

  it('get non-existent character returns error', async () => {
    const r = await callTool('character_manage', { action: 'get', id: 'nonexistent' })
    expect(r.error).toBe(true)
    expect(r.message).toContain('not found')
  })

  it('get without ID returns error', async () => {
    const r = await callTool('character_manage', { action: 'get' })
    expect(r.error).toBe(true)
    expect(r.message).toContain('required')
  })

  it('list returns all characters', async () => {
    await callTool('character_manage', { action: 'create', name: 'Alice' })
    await callTool('character_manage', { action: 'create', name: 'Bob' })
    await callTool('character_manage', { action: 'create', name: 'Charlie' })

    const r = await callTool('character_manage', { action: 'list' })
    expect(r.success).toBe(true)
    expect(r.count).toBeGreaterThanOrEqual(3)
    expect(r.characters).toBeInstanceOf(Array)
  })

  it('list respects limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await callTool('character_manage', { action: 'create', name: `Char${i}` })
    }
    const r = await callTool('character_manage', { action: 'list', limit: 2 })
    expect(r.success).toBe(true)
    expect(r.count).toBeLessThanOrEqual(2)
  })

  it('list with characterTypeFilter for PC', async () => {
    await callTool('character_manage', {
      action: 'create',
      name: 'PC Character',
      characterType: 'pc'
    })
    await callTool('character_manage', {
      action: 'create',
      name: 'NPC Character',
      characterType: 'npc'
    })

    const r = await callTool('character_manage', {
      action: 'list',
      characterTypeFilter: 'pc'
    })
    expect(r.success).toBe(true)
    const pcOnly = r.characters.filter((c: any) => c.character_type === 'pc')
    expect(pcOnly.length).toBeGreaterThan(0)
  })

  it('list with characterTypeFilter for NPC', async () => {
    await callTool('character_manage', {
      action: 'create',
      name: 'Innkeeper',
      characterType: 'npc'
    })

    const r = await callTool('character_manage', {
      action: 'list',
      characterTypeFilter: 'npc'
    })
    expect(r.success).toBe(true)
    const npcOnly = r.characters.filter((c: any) => c.character_type === 'npc')
    expect(npcOnly.length).toBeGreaterThan(0)
  })

  it('list with characterTypeFilter for enemy', async () => {
    await callTool('character_manage', {
      action: 'create',
      name: 'Goblin',
      characterType: 'enemy'
    })

    const r = await callTool('character_manage', {
      action: 'list',
      characterTypeFilter: 'enemy'
    })
    expect(r.success).toBe(true)
  })

  it('list returns empty when no characters match filter', async () => {
    const r = await callTool('character_manage', {
      action: 'list',
      characterTypeFilter: 'neutral'
    })
    expect(r.success).toBe(true)
    expect(r.count).toBeGreaterThanOrEqual(0)
  })

  // ── World Scoping (#268) ─────────────────────────────────────────────────────

  it('create accepts a worldId', async () => {
    const r = await callTool('character_manage', {
      action: 'create',
      name: 'World-Scoped Char',
      worldId: 'world:calder'
    })
    expect(r.success).toBe(true)
    const char = await callTool('character_manage', { action: 'get', id: r.characterId })
    expect(char.character.world_id).toBe('world:calder')
  })

  it('list with worldId filters out cross-world characters (two Kael regression)', async () => {
    await callTool('character_manage', { action: 'create', name: 'Kael', worldId: 'world:calder' })
    await callTool('character_manage', { action: 'create', name: 'Kael', worldId: 'world:verdant-verge' })

    const r = await callTool('character_manage', { action: 'list', worldId: 'world:calder' })
    expect(r.success).toBe(true)
    expect(r.characters.length).toBe(1)
    expect(r.characters[0].world_id).toBe('world:calder')
  })

  it('list with worldId combined with characterTypeFilter', async () => {
    await callTool('character_manage', { action: 'create', name: 'Calder PC', characterType: 'pc', worldId: 'world:calder' })
    await callTool('character_manage', { action: 'create', name: 'Calder NPC', characterType: 'npc', worldId: 'world:calder' })
    await callTool('character_manage', { action: 'create', name: 'Verge PC', characterType: 'pc', worldId: 'world:verdant-verge' })

    const r = await callTool('character_manage', { action: 'list', worldId: 'world:calder', characterTypeFilter: 'pc' })
    expect(r.success).toBe(true)
    expect(r.characters.length).toBe(1)
    expect(r.characters[0].name).toBe('Calder PC')
  })

  it('list with no worldId is backward-compatible and returns all worlds', async () => {
    await callTool('character_manage', { action: 'create', name: 'Calder Char', worldId: 'world:calder' })
    await callTool('character_manage', { action: 'create', name: 'Verge Char', worldId: 'world:verdant-verge' })

    const r = await callTool('character_manage', { action: 'list' })
    expect(r.success).toBe(true)
    const worlds = r.characters.map((c: any) => c.world_id)
    expect(worlds).toContain('world:calder')
    expect(worlds).toContain('world:verdant-verge')
  })

  it('search with worldId filters out cross-world matches', async () => {
    await callTool('character_manage', { action: 'create', name: 'Kael', worldId: 'world:calder' })
    await callTool('character_manage', { action: 'create', name: 'Kael', worldId: 'world:verdant-verge' })

    const r = await callTool('character_manage', { action: 'search', query: 'Kael', worldId: 'world:calder' })
    expect(r.success).toBe(true)
    expect(r.characters.length).toBe(1)
    expect(r.characters[0].world_id).toBe('world:calder')
  })

  it('search with no worldId is backward-compatible and returns all worlds', async () => {
    await callTool('character_manage', { action: 'create', name: 'Kael', worldId: 'world:calder' })
    await callTool('character_manage', { action: 'create', name: 'Kael', worldId: 'world:verdant-verge' })

    const r = await callTool('character_manage', { action: 'search', query: 'Kael' })
    expect(r.success).toBe(true)
    expect(r.characters.length).toBe(2)
  })

  it('list with snake_case world_id filters out cross-world characters (the actual #268 reproduction)', async () => {
    // The issue's own reproduction calls `world_id` (snake_case) — the
    // WHERE-clause filtering already worked for camelCase `worldId`, but
    // Zod silently drops unrecognized keys, so `world_id` was accepted
    // without erroring yet never actually filtered anything.
    await callTool('character_manage', { action: 'create', name: 'Kael', worldId: 'world:calder' })
    await callTool('character_manage', { action: 'create', name: 'Kael', worldId: 'world:verdant-verge' })

    const r = await callTool('character_manage', { action: 'list', world_id: 'world:calder' })
    expect(r.success).toBe(true)
    expect(r.characters.length).toBe(1)
    expect(r.characters[0].world_id).toBe('world:calder')
  })

  it('search with snake_case world_id filters out cross-world matches', async () => {
    await callTool('character_manage', { action: 'create', name: 'Kael', worldId: 'world:calder' })
    await callTool('character_manage', { action: 'create', name: 'Kael', worldId: 'world:verdant-verge' })

    const r = await callTool('character_manage', { action: 'search', query: 'Kael', world_id: 'world:calder' })
    expect(r.success).toBe(true)
    expect(r.characters.length).toBe(1)
    expect(r.characters[0].world_id).toBe('world:calder')
  })

  it('create accepts snake_case world_id', async () => {
    const r = await callTool('character_manage', { action: 'create', name: 'Snake Case Char', world_id: 'world:calder' })
    expect(r.success).toBe(true)
    const char = await callTool('character_manage', { action: 'get', id: r.characterId })
    expect(char.character.world_id).toBe('world:calder')
  })

  it('update accepts snake_case world_id', async () => {
    const created = await callTool('character_manage', { action: 'create', name: 'Unassigned Char 2' })
    const r = await callTool('character_manage', { action: 'update', id: created.characterId, world_id: 'world:calder' })
    expect(r.success).toBe(true)
    const char = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(char.character.world_id).toBe('world:calder')
  })

  it('camelCase worldId still takes priority when both are given (defensive, not expected in practice)', async () => {
    await callTool('character_manage', { action: 'create', name: 'Both Keys', worldId: 'world:calder', world_id: 'world:verdant-verge' })
    const r = await callTool('character_manage', { action: 'list', worldId: 'world:calder' })
    expect(r.characters.some((c: any) => c.name === 'Both Keys')).toBe(true)
  })

  it('update sets worldId on an existing character', async () => {
    const created = await callTool('character_manage', { action: 'create', name: 'Unassigned Char' })
    const r = await callTool('character_manage', {
      action: 'update',
      id: created.characterId,
      worldId: 'world:calder'
    })
    expect(r.success).toBe(true)
    const char = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(char.character.world_id).toBe('world:calder')
  })

  it('update modifies character properties', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Original Name'
    })
    const r = await callTool('character_manage', {
      action: 'update',
      id: created.characterId,
      name: 'New Name'
    })
    expect(r.success).toBe(true)

    const char = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(char.character.name).toBe('New Name')
  })

  it('update HP', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Test',
      maxHp: 50
    })
    const r = await callTool('character_manage', {
      action: 'update',
      id: created.characterId,
      hp: 25
    })
    expect(r.success).toBe(true)

    const char = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(char.character.hp).toBe(25)
  })

  it('update AC', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Armored'
    })
    const r = await callTool('character_manage', {
      action: 'update',
      id: created.characterId,
      ac: 18
    })
    expect(r.success).toBe(true)

    const char = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(char.character.ac).toBe(18)
  })

  it('update level', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Novice',
      level: 1
    })
    const r = await callTool('character_manage', {
      action: 'update',
      id: created.characterId,
      level: 5
    })
    expect(r.success).toBe(true)

    const char = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(char.character.level).toBe(5)
  })

  it('update background', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Mystery'
    })
    const r = await callTool('character_manage', {
      action: 'update',
      id: created.characterId,
      background: 'Former soldier'
    })
    expect(r.success).toBe(true)

    const char = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(char.character.background).toBe('Former soldier')
  })

  it('update alignment', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Moralist'
    })
    const r = await callTool('character_manage', {
      action: 'update',
      id: created.characterId,
      alignment: 'Lawful Good'
    })
    expect(r.success).toBe(true)

    const char = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(char.character.alignment).toBe('Lawful Good')
  })

  it('update accepts factionId, behavior, origin, currentRoomId, and bonus fields', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Sentinel'
    })
    const r = await callTool('character_manage', {
      action: 'update',
      id: created.characterId,
      factionId: 'faction:watchers',
      behavior: 'guard',
      origin: 'The Old Keep',
      currentRoomId: null,
      perceptionBonus: 5,
      stealthBonus: 1,
    })
    expect(r.success).toBe(true)

    const char = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(char.character.faction_id).toBe('faction:watchers')
    expect(char.character.behavior).toBe('guard')
    expect(char.character.origin).toBe('The Old Keep')
    expect(char.character.perception_bonus).toBe(5)
    expect(char.character.stealth_bonus).toBe(1)
  })

  it('update with characterId parameter', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Original'
    })
    const r = await callTool('character_manage', {
      action: 'update',
      characterId: created.characterId,
      name: 'Updated'
    })
    expect(r.success).toBe(true)
  })

  it('update without ID returns error', async () => {
    const r = await callTool('character_manage', {
      action: 'update',
      name: 'New Name'
    })
    expect(r.error).toBe(true)
    expect(r.message).toContain('required')
  })

  it('delete removes character', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Doomed'
    })
    const r = await callTool('character_manage', {
      action: 'delete',
      id: created.characterId
    })
    expect(r.success).toBe(true)

    const char = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(char.error).toBe(true)
  })

  it('delete with characterId parameter', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Gone'
    })
    const r = await callTool('character_manage', {
      action: 'delete',
      characterId: created.characterId
    })
    expect(r.success).toBe(true)
  })

  it('delete without ID returns error', async () => {
    const r = await callTool('character_manage', { action: 'delete' })
    expect(r.error).toBe(true)
    expect(r.message).toContain('required')
  })

  // ── XP and Progression Tests ─────────────────────────────────────────────────

  it('add_xp increases XP and triggers level up at thresholds', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Adventurer',
      level: 1
    })
    // Level 2 requires 300 XP
    const r = await callTool('character_manage', {
      action: 'add_xp',
      id: created.characterId,
      amount: 300
    })
    expect(r.success).toBe(true)
    expect(r.totalXp).toBe(300)
    expect(r.level).toBe(2)
    expect(r.leveledUp).toBe(true)
  })

  it('add_xp with xpAmount alias', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Test'
    })
    const r = await callTool('character_manage', {
      action: 'add_xp',
      characterId: created.characterId,
      xpAmount: 100
    })
    expect(r.success).toBe(true)
    expect(r.totalXp).toBe(100)
  })

  it('add_xp without level up', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Test'
    })
    const r = await callTool('character_manage', {
      action: 'add_xp',
      id: created.characterId,
      amount: 100
    })
    expect(r.success).toBe(true)
    expect(r.leveledUp).toBe(false)
  })

  it('add_xp requires amount', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Test'
    })
    const r = await callTool('character_manage', {
      action: 'add_xp',
      id: created.characterId
    })
    expect(r.error).toBe(true)
    expect(r.message).toContain('required')
  })

  it('add_xp to non-existent character returns error', async () => {
    const r = await callTool('character_manage', {
      action: 'add_xp',
      id: 'nonexistent',
      amount: 100
    })
    expect(r.error).toBe(true)
    expect(r.message).toContain('not found')
  })

  it('get_progression returns XP info', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Test',
      level: 1
    })
    const r = await callTool('character_manage', {
      action: 'get_progression',
      id: created.characterId
    })
    expect(r.success).toBe(true)
    expect(r.currentXp).toBe(0)
    expect(r.level).toBe(1)
    expect(r.xpForNextLevel).toBe(300) // Level 2 requires 300 XP
  })

  it('get_progression at max level', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Legendary',
      level: 20
    })
    const r = await callTool('character_manage', {
      action: 'get_progression',
      id: created.characterId
    })
    expect(r.success).toBe(true)
    expect(r.level).toBe(20)
    expect(r.xpForNextLevel).toBeNull()
  })

  it('get_progression with characterId parameter', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Test'
    })
    const r = await callTool('character_manage', {
      action: 'get_progression',
      characterId: created.characterId
    })
    expect(r.success).toBe(true)
  })

  it('get_progression without ID returns error', async () => {
    const r = await callTool('character_manage', { action: 'get_progression' })
    expect(r.error).toBe(true)
    expect(r.message).toContain('required')
  })

  it('level_up increases level and HP', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Hero',
      level: 1
    })
    const charBefore = await callTool('character_manage', { action: 'get', id: created.characterId })
    const hpBefore = charBefore.character.max_hp

    const r = await callTool('character_manage', {
      action: 'level_up',
      id: created.characterId
    })
    expect(r.success).toBe(true)
    expect(r.newLevel).toBe(2)
    expect(r.hpIncrease).toBe(8)

    const charAfter = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(charAfter.character.level).toBe(2)
    expect(charAfter.character.max_hp).toBe(hpBefore + 8)
  })

  it('level_up caps at level 20', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Max',
      level: 20
    })
    const r = await callTool('character_manage', {
      action: 'level_up',
      id: created.characterId
    })
    expect(r.success).toBe(true)
    expect(r.newLevel).toBe(20) // Capped at 20
  })

  it('level_up with characterId parameter', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Test',
      level: 5
    })
    const r = await callTool('character_manage', {
      action: 'level_up',
      characterId: created.characterId
    })
    expect(r.success).toBe(true)
  })

  it('level_up without ID returns error', async () => {
    const r = await callTool('character_manage', { action: 'level_up' })
    expect(r.error).toBe(true)
    expect(r.message).toContain('required')
  })

  it('level_up non-existent character returns error', async () => {
    const r = await callTool('character_manage', {
      action: 'level_up',
      id: 'nonexistent'
    })
    expect(r.error).toBe(true)
    expect(r.message).toContain('not found')
  })

  // ── Character Type Tests ─────────────────────────────────────────────────────

  it('create with all character types', async () => {
    const types = ['pc', 'npc', 'enemy', 'neutral']
    for (const type of types) {
      const r = await callTool('character_manage', {
        action: 'create',
        name: `${type}-character`,
        characterType: type as any
      })
      expect(r.success).toBe(true)
      expect(r.characterType).toBe(type)
    }
  })

  it('create defaults to PC type', async () => {
    const r = await callTool('character_manage', {
      action: 'create',
      name: 'Default Type'
    })
    expect(r.success).toBe(true)
    expect(r.characterType).toBe('pc')
  })

  // ── Alias Tests ──────────────────────────────────────────────────────────────

  it('supports "new_character" alias for create', async () => {
    const r = await callTool('character_manage', {
      action: 'new_character',
      name: 'Alias Test'
    })
    expect(r.success).toBe(true)
    expect(r.characterId).toBeTruthy()
  })

  it('supports "fetch" alias for get', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Fetch Test'
    })
    const r = await callTool('character_manage', {
      action: 'fetch',
      id: created.characterId
    })
    expect(r.success).toBe(true)
    expect(r.character.name).toBe('Fetch Test')
  })

  it('supports "xp" alias for add_xp', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'XP Alias'
    })
    const r = await callTool('character_manage', {
      action: 'xp',
      id: created.characterId,
      amount: 150
    })
    expect(r.success).toBe(true)
    expect(r.totalXp).toBe(150)
  })

  it('supports "progression" alias for get_progression', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Progression'
    })
    const r = await callTool('character_manage', {
      action: 'progression',
      id: created.characterId
    })
    expect(r.success).toBe(true)
    expect(r.currentXp).toBeDefined()
  })

  it('supports "levelup" alias for level_up', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Level Up',
      level: 3
    })
    const r = await callTool('character_manage', {
      action: 'levelup',
      id: created.characterId
    })
    expect(r.success).toBe(true)
    expect(r.newLevel).toBe(4)
  })

  // ── Ability Modifiers and Computed Fields ─────────────────────────────────

  it('get returns ability_modifiers computed from stats', async () => {
    const stats = { str: 16, dex: 14, con: 15, int: 12, wis: 13, cha: 8 }
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Calculator',
      stats
    })
    const char = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(char.character.ability_modifiers).toEqual({
      str: 3,   // (16-10)/2 = 3
      dex: 2,   // (14-10)/2 = 2
      con: 2,   // (15-10)/2 = 2
      int: 1,   // (12-10)/2 = 1
      wis: 1,   // (13-10)/2 = 1
      cha: -1   // (8-10)/2 = -1
    })
  })

  it('create auto-computes AC from DEX modifier when not provided', async () => {
    const stats = { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 }
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Dexterous',
      stats
    })
    const char = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(char.character.ac).toBe(13) // 10 + (16-10)/2 = 10 + 3 = 13
  })

  it('create respects explicit AC value over auto-compute', async () => {
    const stats = { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 }
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Armored',
      stats,
      ac: 18
    })
    const char = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(char.character.ac).toBe(18)
  })

  it('get auto-computes perception_bonus from WIS modifier when not explicitly set', async () => {
    const stats = { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 }
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Perceptive',
      stats
    })
    const char = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(char.character.perception_bonus).toBe(3) // (16-10)/2 = 3
  })

  it('get respects explicit perception_bonus over auto-compute', async () => {
    const stats = { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 }
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Expert',
      stats,
      perceptionBonus: 7
    })
    const char = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(char.character.perception_bonus).toBe(7)
  })

  it('get auto-computes stealth_bonus from DEX modifier when not explicitly set', async () => {
    const stats = { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 }
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Sneaky',
      stats
    })
    const char = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(char.character.stealth_bonus).toBe(2) // (14-10)/2 = 2
  })

  it('get respects explicit stealth_bonus over auto-compute', async () => {
    const stats = { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 }
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Master',
      stats,
      stealthBonus: 5
    })
    const char = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(char.character.stealth_bonus).toBe(5)
  })

  // ── PATCH Semantics (Preserve Existing Fields) ────────────────────────────

  it('update with only stats preserves level and other fields', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Hero',
      level: 20,
      hp: 150
    })
    const updateStats = { str: 18, dex: 16, con: 16, int: 12, wis: 14, cha: 13 }
    const r = await callTool('character_manage', {
      action: 'update',
      id: created.characterId,
      stats: updateStats
    })
    expect(r.success).toBe(true)

    const char = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(char.character.level).toBe(20) // Must not reset to 1
    expect(char.character.hp).toBe(150) // Must not reset
    expect(char.character.stats).toEqual(updateStats)
  })

  it('update with characterClass field', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Fighter',
      characterClass: 'Barbarian'
    })
    const r = await callTool('character_manage', {
      action: 'update',
      id: created.characterId,
      characterClass: 'Rogue'
    })
    expect(r.success).toBe(true)

    const char = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(char.character.character_class).toBe('Rogue')
  })

  it('update with born field', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Timeless'
    })
    const r = await callTool('character_manage', {
      action: 'update',
      id: created.characterId,
      born: '2150-03-15'
    })
    expect(r.success).toBe(true)

    const char = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(char.character.born).toBe('2150-03-15')
  })

  it('create accepts born field', async () => {
    const r = await callTool('character_manage', {
      action: 'create',
      name: 'Elf',
      born: '2100-06-20'
    })
    expect(r.success).toBe(true)

    const char = await callTool('character_manage', { action: 'get', id: r.characterId })
    expect(char.character.born).toBe('2100-06-20')
  })

  it('update multiple stats and level independently', async () => {
    const created = await callTool('character_manage', {
      action: 'create',
      name: 'Ascending',
      level: 5,
      stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }
    })
    const newStats = { str: 18, dex: 18, con: 18, int: 18, wis: 18, cha: 18 }
    const r = await callTool('character_manage', {
      action: 'update',
      id: created.characterId,
      stats: newStats,
      level: 15
    })
    expect(r.success).toBe(true)

    const char = await callTool('character_manage', { action: 'get', id: created.characterId })
    expect(char.character.level).toBe(15)
    expect(char.character.stats).toEqual(newStats)
  })
})
