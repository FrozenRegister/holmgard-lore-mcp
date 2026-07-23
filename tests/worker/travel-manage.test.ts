// Direct handler tests for travel-manage (not registered in rpgToolRegistry)
import { describe } from './support/helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'
import { handleTravelManage, fordingCost } from '@/rpg/handlers/travel-manage'
import { handleBiomeManage } from '@/rpg/handlers/biome-manage'
import { handleWorldMap } from '@/rpg/handlers/world-map'

describe('handleTravelManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB }) as any

  async function createRoom(id: string, name: string, exits: unknown[] = []) {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO room_nodes (id, name, base_description, biome_context, atmospherics, exits, entity_ids, created_at, updated_at, visited_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        id,
        name,
        `A ${name} room for testing.`,
        'forest',
        '[]',
        JSON.stringify(exits),
        '[]',
        now,
        now,
        0,
      )
      .run()
  }

  async function createCharacter(id: string) {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      `INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, character_type, character_class, race, conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells, cantrips_known, currency, resource_pools, xp, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        id,
        '{}',
        5,
        20,
        10,
        4,
        'pc',
        'Fighter',
        'Human',
        '[]',
        '[]',
        '[]',
        '[]',
        '[]',
        '[]',
        '[]',
        '{}',
        '{}',
        0,
        now,
        now,
      )
      .run()
  }

  it('returns guiding error for unknown action', async () => {
    const r = await handleTravelManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  it('travel requires toRoomId or fromRoomId+direction', async () => {
    const r = await handleTravelManage(db(), { action: 'travel', partyId: 'p1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('travel to unknown room returns error', async () => {
    const r = await handleTravelManage(db(), { action: 'travel', toRoomId: 'no-room' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('travel to known room succeeds', async () => {
    await createRoom('room-1', 'Tavern')
    const r = await handleTravelManage(db(), { action: 'travel', toRoomId: 'room-1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.arrived).toBe(true)
    expect(body.roomId).toBe('room-1')
  })

  it('travel via direction from unknown origin returns error', async () => {
    const r = await handleTravelManage(db(), {
      action: 'travel',
      fromRoomId: 'no-room',
      direction: 'north',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('travel via direction returns error when no matching exit', async () => {
    await createRoom('room-2', 'Forest')
    const r = await handleTravelManage(db(), {
      action: 'travel',
      fromRoomId: 'room-2',
      direction: 'north',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('travel via direction follows exit', async () => {
    await createRoom('room-3', 'Cave')
    await createRoom('room-4', 'Dungeon', [{ direction: 'south', targetRoomId: 'no-room' }])
    await createRoom('room-5', 'Exit Room')
    await createRoom('room-6', 'Room With Exit', [{ direction: 'east', targetRoomId: 'room-5' }])
    const r = await handleTravelManage(db(), {
      action: 'travel',
      fromRoomId: 'room-6',
      direction: 'east',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.roomId).toBe('room-5')
  })

  it('travel via direction fails when target room not found', async () => {
    await createRoom('room-7', 'Broken Room', [{ direction: 'west', targetRoomId: 'ghost-room' }])
    const r = await handleTravelManage(db(), {
      action: 'travel',
      fromRoomId: 'room-7',
      direction: 'west',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('loot requires roomId', async () => {
    const r = await handleTravelManage(db(), { action: 'loot' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('loot returns error for unknown room', async () => {
    const r = await handleTravelManage(db(), { action: 'loot', roomId: 'no-room' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('loot returns found items', async () => {
    await createRoom('room-8', 'Treasure Room')
    const r = await handleTravelManage(db(), {
      action: 'loot',
      roomId: 'room-8',
      partyId: 'party-1',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.itemsFound).toBeDefined()
  })

  it('rest requires characterIds', async () => {
    const r = await handleTravelManage(db(), { action: 'rest', characterIds: [] })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('rest performs short rest', async () => {
    await createCharacter('char-rest-1')
    const r = await handleTravelManage(db(), {
      action: 'rest',
      characterIds: ['char-rest-1'],
      restType: 'short',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hoursElapsed).toBe(1)
  })

  it('rest performs long rest', async () => {
    await createCharacter('char-rest-2')
    const r = await handleTravelManage(db(), {
      action: 'rest',
      characterIds: ['char-rest-2', 'missing-char'],
      restType: 'long',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hoursElapsed).toBe(8)
  })

  // ── resolveEncounter integration (#280) ────────────────────────────────────

  const WORLD = 'world-1'
  async function createWorld() {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(WORLD, 'Test World', 'abc123', 100, 100, now, now)
      .run()
  }

  it('travel without resolveEncounter keeps the legacy flat-chance flag', async () => {
    await createRoom('room-legacy', 'Legacy Room')
    const r = await handleTravelManage(db(), { action: 'travel', toRoomId: 'room-legacy' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(typeof body.randomEncounter).toBe('boolean')
    expect(body.encounter).toBeUndefined()
  })

  it('travel with resolveEncounter but no worldId/q/r falls back to the legacy flag', async () => {
    await createRoom('room-nocoords', 'No Coords Room')
    const r = await handleTravelManage(db(), {
      action: 'travel',
      toRoomId: 'room-nocoords',
      resolveEncounter: true,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(typeof body.randomEncounter).toBe('boolean')
    expect(body.encounter).toBeUndefined()
  })

  it('travel with resolveEncounter and worldId/q/r calls the full encounter engine', async () => {
    await createWorld()
    await handleBiomeManage(db(), {
      action: 'register',
      worldId: WORLD,
      name: 'deadly_ground',
      baseThreat: 100,
    })
    await handleWorldMap(db(), {
      action: 'patch',
      worldId: WORLD,
      hexes: [{ q: 5, r: 5, biome: 'deadly_ground' }],
    })
    await createRoom('room-encounter', 'Ambush Room')
    const r = await handleTravelManage(db(), {
      action: 'travel',
      toRoomId: 'room-encounter',
      resolveEncounter: true,
      worldId: WORLD,
      q: 5,
      r: 5,
      includeInjuries: false,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.arrived).toBe(true)
    expect(body.encounter).toBeDefined()
    expect(body.encounter.encounter).toBe(true)
    expect(body.encounter.threshold).toBe(100)
    expect(body.randomEncounter).toBeUndefined()
  })

  // ── move_hex action (issue #337) ────────────────────────────────────

  async function createParty(id: string) {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO parties (id, name, world_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(id, `Party ${id}`, WORLD, now, now)
      .run()
  }

  it('move_hex requires partyId', async () => {
    const r = await handleTravelManage(db(), { action: 'move_hex', worldId: WORLD, toQ: 0, toR: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('partyId')
  })

  it('move_hex requires worldId', async () => {
    const r = await handleTravelManage(db(), { action: 'move_hex', partyId: 'p1', toQ: 0, toR: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('worldId')
  })

  it('move_hex requires toQ and toR', async () => {
    const r = await handleTravelManage(db(), { action: 'move_hex', partyId: 'p1', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('"toQ"')
  })

  it('move_hex returns error for unknown party', async () => {
    await createWorld()
    const r = await handleTravelManage(db(), {
      action: 'move_hex',
      partyId: 'no-party',
      worldId: WORLD,
      toQ: 0,
      toR: 0,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('not found')
  })

  it('move_hex moves a party to a hex with no biome row', async () => {
    await createWorld()
    await createParty('party-move-1')
    const r = await handleTravelManage(db(), {
      action: 'move_hex',
      partyId: 'party-move-1',
      worldId: WORLD,
      toQ: 10,
      toR: 20,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.q).toBe(10)
    expect(body.r).toBe(20)
    expect(body.biome).toBeNull()
    const stored = (await env.RPG_DB.prepare(
      'SELECT current_hex_q, current_hex_r FROM parties WHERE id = ?',
    )
      .bind('party-move-1')
      .first()) as any
    expect(stored.current_hex_q).toBe(10)
    expect(stored.current_hex_r).toBe(20)
  })

  it('move_hex moves a party to a hex with biome', async () => {
    await createWorld()
    await createParty('party-move-2')
    await handleBiomeManage(db(), {
      action: 'register',
      worldId: WORLD,
      name: 'forest',
      baseThreat: 10,
    })
    await handleWorldMap(db(), {
      action: 'patch',
      worldId: WORLD,
      hexes: [{ q: 3, r: 4, biome: 'forest' }],
    })
    const r = await handleTravelManage(db(), {
      action: 'move_hex',
      partyId: 'party-move-2',
      worldId: WORLD,
      toQ: 3,
      toR: 4,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.biome).toBe('forest')
  })

  it('move_hex without resolveEncounter does not call the encounter engine', async () => {
    await createWorld()
    await createParty('party-move-3')
    await handleBiomeManage(db(), {
      action: 'register',
      worldId: WORLD,
      name: 'mountains',
      baseThreat: 50,
    })
    await handleWorldMap(db(), {
      action: 'patch',
      worldId: WORLD,
      hexes: [{ q: 7, r: 8, biome: 'mountains' }],
    })
    const r = await handleTravelManage(db(), {
      action: 'move_hex',
      partyId: 'party-move-3',
      worldId: WORLD,
      toQ: 7,
      toR: 8,
      resolveEncounter: false,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.biome).toBe('mountains')
    expect(body.encounter).toBeUndefined()
  })

  it('move_hex with resolveEncounter calls the encounter engine', async () => {
    await createWorld()
    await createParty('party-move-4')
    await handleBiomeManage(db(), {
      action: 'register',
      worldId: WORLD,
      name: 'mountains',
      baseThreat: 50,
    })
    await handleWorldMap(db(), {
      action: 'patch',
      worldId: WORLD,
      hexes: [{ q: 7, r: 8, biome: 'mountains' }],
    })
    const r = await handleTravelManage(db(), {
      action: 'move_hex',
      partyId: 'party-move-4',
      worldId: WORLD,
      toQ: 7,
      toR: 8,
      resolveEncounter: true,
      includeInjuries: false,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.biome).toBe('mountains')
    expect(body.encounter).toBeDefined()
    expect(body.encounter.threshold).toBe(50)
  })

  // ── move_hex mode-aware passability (#429) ────────────────────────────

  it('move_hex defaults mode to foot with effective speed at the biome baseline', async () => {
    await createWorld()
    await createParty('party-move-5')
    await handleBiomeManage(db(), {
      action: 'register',
      worldId: WORLD,
      name: 'grass_429',
      movementCost: 1.0,
    })
    await handleWorldMap(db(), {
      action: 'patch',
      worldId: WORLD,
      hexes: [{ q: 1, r: 1, biome: 'grass_429' }],
    })
    const r = await handleTravelManage(db(), {
      action: 'move_hex',
      partyId: 'party-move-5',
      worldId: WORLD,
      toQ: 1,
      toR: 1,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.mode).toBe('foot')
    expect(body.effectiveSpeedKmPerDay).toBe(5)
  })

  it('move_hex to a hex with no biome row is unrestricted regardless of mode', async () => {
    await createWorld()
    await createParty('party-move-6')
    const r = await handleTravelManage(db(), {
      action: 'move_hex',
      partyId: 'party-move-6',
      worldId: WORLD,
      toQ: 99,
      toR: 99,
      mode: 'aircraft',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.mode).toBe('aircraft')
    expect(body.effectiveSpeedKmPerDay).toBe(600)
  })

  it('move_hex uses a mode-specific cost override when present', async () => {
    await createWorld()
    await createParty('party-move-7')
    await handleBiomeManage(db(), {
      action: 'register',
      worldId: WORLD,
      name: 'heath_429',
      movementCost: 1.0,
      modeCosts: { horse: 2.0 },
    })
    await handleWorldMap(db(), {
      action: 'patch',
      worldId: WORLD,
      hexes: [{ q: 2, r: 2, biome: 'heath_429' }],
    })
    const r = await handleTravelManage(db(), {
      action: 'move_hex',
      partyId: 'party-move-7',
      worldId: WORLD,
      toQ: 2,
      toR: 2,
      mode: 'horse',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.effectiveSpeedKmPerDay).toBe(35 / 2.0)
  })

  it('move_hex falls back to movementCost when the mode has no override', async () => {
    await createWorld()
    await createParty('party-move-8')
    await handleBiomeManage(db(), {
      action: 'register',
      worldId: WORLD,
      name: 'sand_429',
      movementCost: 2.0,
      modeCosts: { horse: 4.0 },
    })
    await handleWorldMap(db(), {
      action: 'patch',
      worldId: WORLD,
      hexes: [{ q: 3, r: 3, biome: 'sand_429' }],
    })
    const r = await handleTravelManage(db(), {
      action: 'move_hex',
      partyId: 'party-move-8',
      worldId: WORLD,
      toQ: 3,
      toR: 3,
      mode: 'car',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.effectiveSpeedKmPerDay).toBe(400 / 2.0)
  })

  it('move_hex rejects a mode blocked by a 0.0 cost override (impassable) and does not move the party', async () => {
    await createWorld()
    await createParty('party-move-9')
    await handleBiomeManage(db(), {
      action: 'register',
      worldId: WORLD,
      name: 'river_429',
      movementCost: 2.0,
      modeCosts: { carriage: 0, car: 0 },
    })
    await handleWorldMap(db(), {
      action: 'patch',
      worldId: WORLD,
      hexes: [{ q: 4, r: 4, biome: 'river_429' }],
    })
    const r = await handleTravelManage(db(), {
      action: 'move_hex',
      partyId: 'party-move-9',
      worldId: WORLD,
      toQ: 4,
      toR: 4,
      mode: 'car',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('impassable')
    const stored = (await env.RPG_DB.prepare(
      'SELECT current_hex_q, current_hex_r FROM parties WHERE id = ?',
    )
      .bind('party-move-9')
      .first()) as any
    expect(stored.current_hex_q).toBeNull()
    expect(stored.current_hex_r).toBeNull()
  })

  it('move_hex allows foot/horse across the same river hex that blocks carriage/car', async () => {
    await createWorld()
    await createParty('party-move-10')
    await handleBiomeManage(db(), {
      action: 'register',
      worldId: WORLD,
      name: 'river_429b',
      movementCost: 2.0,
      modeCosts: { carriage: 0, car: 0 },
    })
    await handleWorldMap(db(), {
      action: 'patch',
      worldId: WORLD,
      hexes: [{ q: 5, r: 5, biome: 'river_429b' }],
    })
    const r = await handleTravelManage(db(), {
      action: 'move_hex',
      partyId: 'party-move-10',
      worldId: WORLD,
      toQ: 5,
      toR: 5,
      mode: 'foot',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.effectiveSpeedKmPerDay).toBe(5 / 2.0)
  })

  // ── fordingCost pure function (#431) ────────────────────────────────

  it('fordingCost returns null when water_depth is null (no fording rule)', () => {
    expect(fordingCost(null, 'foot')).toBeNull()
  })

  it('fordingCost always returns null for aircraft regardless of depth', () => {
    expect(fordingCost(0.3, 'aircraft')).toBeNull()
    expect(fordingCost(5.0, 'aircraft')).toBeNull()
  })

  it('fordingCost — shallow (<=0.6m): foot/horse fordable at half speed, no swim risk', () => {
    expect(fordingCost(0.6, 'foot')).toEqual({ cost: 2.0, swimRisk: false })
    expect(fordingCost(0, 'horse')).toEqual({ cost: 2.0, swimRisk: false })
  })

  it('fordingCost — medium (0.6-1.2m): foot/horse fordable at half speed, with swim risk', () => {
    expect(fordingCost(0.8, 'foot')).toEqual({ cost: 2.0, swimRisk: true })
    expect(fordingCost(1.2, 'horse')).toEqual({ cost: 2.0, swimRisk: true })
  })

  it('fordingCost — deep (>1.2m): impassable for every surface mode', () => {
    expect(fordingCost(1.3, 'foot')).toEqual({ cost: 0, swimRisk: false })
    expect(fordingCost(1.3, 'horse')).toEqual({ cost: 0, swimRisk: false })
    expect(fordingCost(1.3, 'carriage')).toEqual({ cost: 0, swimRisk: false })
    expect(fordingCost(1.3, 'car')).toEqual({ cost: 0, swimRisk: false })
  })

  it('fordingCost — carriage/car are always impassable at any positive depth', () => {
    expect(fordingCost(0.1, 'carriage')).toEqual({ cost: 0, swimRisk: false })
    expect(fordingCost(0.1, 'car')).toEqual({ cost: 0, swimRisk: false })
  })

  // ── move_hex water_depth integration (#431) ─────────────────────────

  it('move_hex ignores water_depth when null even on a costly biome', async () => {
    await createWorld()
    await createParty('party-move-11')
    await handleBiomeManage(db(), {
      action: 'register',
      worldId: WORLD,
      name: 'marsh_431',
      movementCost: 2.0,
    })
    await handleWorldMap(db(), {
      action: 'patch',
      worldId: WORLD,
      hexes: [{ q: 6, r: 6, biome: 'marsh_431' }],
    })
    const r = await handleTravelManage(db(), {
      action: 'move_hex',
      partyId: 'party-move-11',
      worldId: WORLD,
      toQ: 6,
      toR: 6,
      mode: 'foot',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.effectiveSpeedKmPerDay).toBe(5 / 2.0)
    expect(body.swimRisk).toBeUndefined()
  })

  it('move_hex water_depth overrides a permissive biome cost and blocks carriage', async () => {
    await createWorld()
    await createParty('party-move-12')
    // Biome itself has no mode override (would normally be fully passable),
    // but an explicit water_depth on this specific hex still blocks carriage.
    await handleBiomeManage(db(), {
      action: 'register',
      worldId: WORLD,
      name: 'grass_431',
      movementCost: 1.0,
    })
    await handleWorldMap(db(), {
      action: 'patch',
      worldId: WORLD,
      hexes: [{ q: 7, r: 7, biome: 'grass_431', waterDepth: 1.5 }],
    })
    const r = await handleTravelManage(db(), {
      action: 'move_hex',
      partyId: 'party-move-12',
      worldId: WORLD,
      toQ: 7,
      toR: 7,
      mode: 'carriage',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('water too deep to ford')
  })

  it('move_hex reports swimRisk for a medium-depth foot crossing', async () => {
    await createWorld()
    await createParty('party-move-13')
    await handleWorldMap(db(), {
      action: 'patch',
      worldId: WORLD,
      hexes: [{ q: 8, r: 8, biome: 'grass', waterDepth: 0.9 }],
    })
    const r = await handleTravelManage(db(), {
      action: 'move_hex',
      partyId: 'party-move-13',
      worldId: WORLD,
      toQ: 8,
      toR: 8,
      mode: 'foot',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.swimRisk).toBe(true)
    expect(body.effectiveSpeedKmPerDay).toBe(5 / 2.0)
  })

  it('move_hex ignores water_depth entirely for aircraft', async () => {
    await createWorld()
    await createParty('party-move-14')
    await handleWorldMap(db(), {
      action: 'patch',
      worldId: WORLD,
      hexes: [{ q: 9, r: 9, biome: 'grass', waterDepth: 5.0 }],
    })
    const r = await handleTravelManage(db(), {
      action: 'move_hex',
      partyId: 'party-move-14',
      worldId: WORLD,
      toQ: 9,
      toR: 9,
      mode: 'aircraft',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.effectiveSpeedKmPerDay).toBe(600)
    expect(body.swimRisk).toBeUndefined()
  })
})
