// Direct handler tests for travel-manage (not registered in rpgToolRegistry)
import { describe } from './support/helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'
import { handleTravelManage, fordingCost } from '@/rpg/handlers/travel-manage'
import { handleBiomeManage } from '@/rpg/handlers/biome-manage'
import { handleWorldMap } from '@/rpg/handlers/world-map'
import { handleWeatherManage } from '@/rpg/handlers/weather-manage'

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

  // ── rappel action (#437) ───────────────────────────────────────────────────

  it('rappel requires characterId', async () => {
    const r = await handleTravelManage(db(), { action: 'rappel', worldId: WORLD, height: 'low' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('characterId')
  })

  it('rappel requires height', async () => {
    const r = await handleTravelManage(db(), {
      action: 'rappel',
      characterId: 'char-1',
      worldId: WORLD,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('height')
  })

  it('rappel requires worldId', async () => {
    const r = await handleTravelManage(db(), {
      action: 'rappel',
      characterId: 'char-1',
      height: 'low',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('worldId')
  })

  it('rappel untrained + extreme height auto-fails without roll', async () => {
    const r = await handleTravelManage(db(), {
      action: 'rappel',
      characterId: 'char-1',
      height: 'extreme',
      worldId: WORLD,
      proficient: false,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.outcome).toBe('not_attempted')
    expect(body.damage).toBe(0)
    expect(body.roll).toBeUndefined()
  })

  it('rappel proficient low height can succeed', async () => {
    const r = await handleTravelManage(db(), {
      action: 'rappel',
      characterId: 'char-2',
      height: 'low',
      worldId: WORLD,
      proficient: true,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(['success', 'rough_landing', 'hard_landing', 'fall', 'critical_fail']).toContain(
      body.outcome,
    )
    expect(body.roll).toBeDefined()
    expect(body.roll.expr).toBe('1d20')
    expect(body.roll.modifier).toBe(0)
    expect(typeof body.damage).toBe('number')
    expect(Array.isArray(body.effects)).toBe(true)
  })

  it('rappel untrained non-extreme uses disadvantage (2d20kl1)', async () => {
    const r = await handleTravelManage(db(), {
      action: 'rappel',
      characterId: 'char-3',
      height: 'low',
      worldId: WORLD,
      proficient: false,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.roll).toBeDefined()
    expect(body.roll.expr).toBe('2d20kl1')
  })

  it('rappel high height applies -2 DEX modifier', async () => {
    const r = await handleTravelManage(db(), {
      action: 'rappel',
      characterId: 'char-4',
      height: 'high',
      worldId: WORLD,
      proficient: true,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.roll).toBeDefined()
    expect(body.roll.modifier).toBe(-2)
  })

  it('rappel extreme height applies -5 DEX modifier', async () => {
    const r = await handleTravelManage(db(), {
      action: 'rappel',
      characterId: 'char-5',
      height: 'extreme',
      worldId: WORLD,
      proficient: true,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.roll).toBeDefined()
    expect(body.roll.modifier).toBe(-5)
  })

  it('rappel success outcome when margin >= 0', async () => {
    // This is probabilistic, so we just verify the structure is correct.
    // A sufficiently high roll will succeed. Multiple attempts increase chance.
    let foundSuccess = false
    for (let i = 0; i < 30; i++) {
      const r = await handleTravelManage(db(), {
        action: 'rappel',
        characterId: `char-success-${i}`,
        height: 'low',
        worldId: WORLD,
        proficient: true,
      })
      const body = JSON.parse(r.content[0].text)
      if (body.outcome === 'success') {
        foundSuccess = true
        expect(body.damage).toBe(0)
        expect(body.effects.length).toBe(0)
        break
      }
    }
    expect(foundSuccess).toBe(true)
  })

  it('rappel rough_landing outcome on fail by 1-5', async () => {
    // We test this multiple times to increase chance of hitting the range.
    let foundOutcome = false
    for (let i = 0; i < 50; i++) {
      const r = await handleTravelManage(db(), {
        action: 'rappel',
        characterId: `char-rough-${i}`,
        height: 'low',
        worldId: WORLD,
        proficient: true,
      })
      const body = JSON.parse(r.content[0].text)
      if (body.outcome === 'rough_landing') {
        foundOutcome = true
        expect(body.damage).toBeGreaterThanOrEqual(1)
        expect(body.damage).toBeLessThanOrEqual(4)
        expect(body.effects).toContain('twisted ankle')
        expect(body.effects).toContain('half speed for 1 hour')
        break
      }
    }
    expect(foundOutcome).toBe(true)
  })

  it('rappel hard_landing outcome on fail by 6-10', async () => {
    let foundOutcome = false
    for (let i = 0; i < 50; i++) {
      const r = await handleTravelManage(db(), {
        action: 'rappel',
        characterId: `char-hard-${i}`,
        height: 'low',
        worldId: WORLD,
        proficient: true,
      })
      const body = JSON.parse(r.content[0].text)
      if (body.outcome === 'hard_landing') {
        foundOutcome = true
        expect(body.damage).toBeGreaterThanOrEqual(2)
        expect(body.damage).toBeLessThanOrEqual(12)
        expect(body.effects).toContain('sprain or minor fracture')
        expect(body.effects).toContain('half speed for 24 hours')
        expect(body.effects).toContain('disadvantage on DEX')
        break
      }
    }
    expect(foundOutcome).toBe(true)
  })

  it('rappel fall outcome on fail by >10', async () => {
    // height: 'low' carries a 0 DEX modifier, so with DC 12 the only roll that
    // yields margin < -10 is a natural 1 — which the handler always resolves
    // as critical_fail (checked before the margin bands), making the plain
    // "fall" outcome structurally unreachable at this height. 'extreme' (-5
    // modifier) opens up rolls 2-6 as non-nat-1 routes into "fall".
    let foundOutcome = false
    for (let i = 0; i < 50; i++) {
      const r = await handleTravelManage(db(), {
        action: 'rappel',
        characterId: `char-fall-${i}`,
        height: 'extreme',
        worldId: WORLD,
        proficient: true,
      })
      const body = JSON.parse(r.content[0].text)
      if (body.outcome === 'fall') {
        foundOutcome = true
        expect(body.damage).toBeGreaterThanOrEqual(4)
        expect(body.effects).toContain('possible fracture')
        expect(body.effects).toContain('possible unconsciousness')
        break
      }
    }
    expect(foundOutcome).toBe(true)
  })

  it('rappel critical_fail outcome on natural 1', async () => {
    // Natural 1 on d20 is guaranteed to be critical_fail for proficient roll.
    // For untrained (2d20kl1), a natural 1 kept means critical_fail.
    // We test multiple times to catch a critical fail.
    let foundCritical = false
    for (let i = 0; i < 100; i++) {
      const r = await handleTravelManage(db(), {
        action: 'rappel',
        characterId: `char-crit-${i}`,
        height: 'low',
        worldId: WORLD,
        proficient: true,
      })
      const body = JSON.parse(r.content[0].text)
      if (body.outcome === 'critical_fail') {
        foundCritical = true
        expect(body.roll.critical).toBe('failure')
        expect(body.damage).toBeGreaterThan(0)
        expect(body.effects).toContain('equipment failure')
        expect(body.effects).toContain('fall from full height')
        break
      }
    }
    expect(foundCritical).toBe(true)
  })

  // ── takeoff action (#436 slice 2) ───────────────────────────────────────

  it('takeoff requires characterId', async () => {
    const r = await handleTravelManage(db(), {
      action: 'takeoff',
      worldId: WORLD,
      q: 0,
      r: 0,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toMatch(/characterId.*required/i)
  })

  it('takeoff requires worldId', async () => {
    const r = await handleTravelManage(db(), {
      action: 'takeoff',
      characterId: 'char-1',
      q: 0,
      r: 0,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toMatch(/worldId.*required/i)
  })

  it('takeoff requires q and r', async () => {
    const r = await handleTravelManage(db(), {
      action: 'takeoff',
      characterId: 'char-1',
      worldId: WORLD,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toMatch(/required/i)
  })

  it('takeoff requires aircraftClass', async () => {
    const r = await handleTravelManage(db(), {
      action: 'takeoff',
      characterId: 'char-1',
      worldId: WORLD,
      q: 0,
      r: 0,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toMatch(/aircraftClass.*required/i)
  })

  it('takeoff returns error for unknown hex', async () => {
    const r = await handleTravelManage(db(), {
      action: 'takeoff',
      characterId: 'char-1',
      worldId: WORLD,
      q: 999,
      r: 999,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toMatch(/not found/i)
  })

  it('takeoff rejects aircraft class when LZ does not meet minimum', async () => {
    await createWorld()
    // Set up hex with forest biome (unlandable)
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 10, 10, 'forest', 100)
      .run()

    const r = await handleTravelManage(db(), {
      action: 'takeoff',
      characterId: 'char-1',
      worldId: WORLD,
      q: 10,
      r: 10,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.outcome).toBe('rejected')
    expect(body.reason).toMatch(/cannot take off/i)
    expect(body.landingZone).toBe('unlandable')
  })

  it('takeoff allows aircraft class when LZ meets minimum', async () => {
    await createWorld()
    // Set up hex with clearing biome (suitable for light aircraft)
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 11, 11, 'glade', 100)
      .run()

    const r = await handleTravelManage(db(), {
      action: 'takeoff',
      characterId: 'char-1',
      worldId: WORLD,
      q: 11,
      r: 11,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.outcome).toMatch(/success|aborted|crash/)
    expect(body.landingZone).toBe('clearing')
  })

  it('takeoff can produce success outcome', async () => {
    await createWorld()
    // Set up hex with runway (ideal)
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 12, 12, 'road', 100)
      .run()

    let foundSuccess = false
    for (let i = 0; i < 50; i++) {
      const r = await handleTravelManage(db(), {
        action: 'takeoff',
        characterId: `char-success-${i}`,
        worldId: WORLD,
        q: 12,
        r: 12,
        aircraftClass: 'light_fixed_wing',
      })
      const body = JSON.parse(r.content[0].text)
      if (body.outcome === 'success') {
        foundSuccess = true
        expect(body.fuelWasted).toBe(false)
        expect(body.damage).toBe(0)
        break
      }
    }
    expect(foundSuccess).toBe(true)
  })

  it('takeoff can produce aborted outcome', async () => {
    await createWorld()
    // Set up hex with clearing (more difficult)
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 13, 13, 'glade', 100)
      .run()

    let foundAborted = false
    for (let i = 0; i < 50; i++) {
      const r = await handleTravelManage(db(), {
        action: 'takeoff',
        characterId: `char-aborted-${i}`,
        worldId: WORLD,
        q: 13,
        r: 13,
        aircraftClass: 'light_fixed_wing',
      })
      const body = JSON.parse(r.content[0].text)
      if (body.outcome === 'aborted') {
        foundAborted = true
        expect(body.fuelWasted).toBe(true)
        break
      }
    }
    expect(foundAborted).toBe(true)
  })

  it('takeoff can produce crash outcome', async () => {
    await createWorld()
    // Set up hex with clearing
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 14, 14, 'glade', 100)
      .run()

    let foundCrash = false
    for (let i = 0; i < 50; i++) {
      const r = await handleTravelManage(db(), {
        action: 'takeoff',
        characterId: `char-crash-${i}`,
        worldId: WORLD,
        q: 14,
        r: 14,
        aircraftClass: 'light_fixed_wing',
      })
      const body = JSON.parse(r.content[0].text)
      if (body.outcome === 'crash') {
        foundCrash = true
        expect(body.fuelWasted).toBe(true)
        expect(body.damage).toBeGreaterThan(0)
        expect(body.effects).toContain('runway overrun')
        break
      }
    }
    expect(foundCrash).toBe(true)
  })

  it('takeoff crash via natural-1 critical failure', async () => {
    await createWorld()
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 35, 35, 'glade', 100)
      .run()

    let foundCritCrash = false
    for (let i = 0; i < 300; i++) {
      const r = await handleTravelManage(db(), {
        action: 'takeoff',
        characterId: `char-crit-crash-${i}`,
        worldId: WORLD,
        q: 35,
        r: 35,
        aircraftClass: 'light_fixed_wing',
      })
      const body = JSON.parse(r.content[0].text)
      if (body.outcome === 'crash' && body.roll?.critical === 'failure') {
        foundCritCrash = true
        expect(body.effects).toContain('runway overrun')
        expect(body.effects).toContain('aircraft damaged')
        break
      }
    }
    expect(foundCritCrash).toBe(true)
  })

  it('takeoff computes slope from a neighboring hex', async () => {
    await createWorld()
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 36, 36, 'glade', 100)
      .run()
    // Axial neighbor (q+1, r) with a large elevation delta — pushes slope > 10,
    // reclassifying the departure hex from 'clearing' to 'unlandable'.
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 37, 36, 'glade', 200)
      .run()

    const r = await handleTravelManage(db(), {
      action: 'takeoff',
      characterId: 'char-1',
      worldId: WORLD,
      q: 36,
      r: 36,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.outcome).toBe('rejected')
    expect(body.landingZone).toBe('unlandable')
  })

  it('takeoff blocked by storm', async () => {
    await createWorld()
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 30, 30, 'glade', 100)
      .run()
    await handleWeatherManage(db(), { action: 'set_forecast', worldId: WORLD, conditions: 'storm' })

    const r = await handleTravelManage(db(), {
      action: 'takeoff',
      characterId: 'char-1',
      worldId: WORLD,
      q: 30,
      r: 30,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.outcome).toBe('rejected')
    expect(body.reason).toMatch(/storm/i)
  })

  it('takeoff blocked by heavy precipitation', async () => {
    await createWorld()
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 31, 31, 'glade', 100)
      .run()
    await handleWeatherManage(db(), {
      action: 'set_forecast',
      worldId: WORLD,
      conditions: 'overcast',
      precipitationType: 'snow',
    })

    const r = await handleTravelManage(db(), {
      action: 'takeoff',
      characterId: 'char-1',
      worldId: WORLD,
      q: 31,
      r: 31,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.outcome).toBe('rejected')
    expect(body.reason).toMatch(/snow/i)
  })

  it('takeoff blocked by low visibility', async () => {
    await createWorld()
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 32, 32, 'glade', 100)
      .run()
    await handleWeatherManage(db(), {
      action: 'set_forecast',
      worldId: WORLD,
      conditions: 'overcast',
      visibility: 'nil',
    })

    const r = await handleTravelManage(db(), {
      action: 'takeoff',
      characterId: 'char-1',
      worldId: WORLD,
      q: 32,
      r: 32,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.outcome).toBe('rejected')
    expect(body.reason).toMatch(/visibility/i)
  })

  it('takeoff blocked by excessive crosswind', async () => {
    await createWorld()
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 33, 33, 'glade', 100)
      .run()
    await handleWeatherManage(db(), {
      action: 'set_forecast',
      worldId: WORLD,
      conditions: 'overcast',
      windSpeed: 50,
    })

    const r = await handleTravelManage(db(), {
      action: 'takeoff',
      characterId: 'char-1',
      worldId: WORLD,
      q: 33,
      r: 33,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.outcome).toBe('rejected')
    expect(body.reason).toMatch(/crosswind/i)
  })

  it('takeoff proceeds when weather is found but clear', async () => {
    await createWorld()
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 34, 34, 'road', 100)
      .run()
    await handleWeatherManage(db(), {
      action: 'set_forecast',
      worldId: WORLD,
      conditions: 'clear',
      windSpeed: 5,
      visibility: 'unlimited',
      precipitationType: 'none',
    })

    const r = await handleTravelManage(db(), {
      action: 'takeoff',
      characterId: 'char-1',
      worldId: WORLD,
      q: 34,
      r: 34,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.outcome).toMatch(/success|aborted|crash/)
  })

  // ── land action (#436 slice 2) ────────────────────────────────────────────

  it('land requires characterId', async () => {
    const r = await handleTravelManage(db(), {
      action: 'land',
      worldId: WORLD,
      toQ: 0,
      toR: 0,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toMatch(/characterId.*required/i)
  })

  it('land requires worldId', async () => {
    const r = await handleTravelManage(db(), {
      action: 'land',
      characterId: 'char-1',
      toQ: 0,
      toR: 0,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toMatch(/worldId.*required/i)
  })

  it('land requires toQ and toR', async () => {
    const r = await handleTravelManage(db(), {
      action: 'land',
      characterId: 'char-1',
      worldId: WORLD,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toMatch(/required/i)
  })

  it('land requires aircraftClass', async () => {
    const r = await handleTravelManage(db(), {
      action: 'land',
      characterId: 'char-1',
      worldId: WORLD,
      toQ: 0,
      toR: 0,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toMatch(/aircraftClass.*required/i)
  })

  it('land returns error for unknown hex', async () => {
    const r = await handleTravelManage(db(), {
      action: 'land',
      characterId: 'char-1',
      worldId: WORLD,
      toQ: 999,
      toR: 999,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toMatch(/not found/i)
  })

  it('land rejects aircraft class when LZ does not meet minimum', async () => {
    await createWorld()
    // Set up hex with forest biome (unlandable)
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 20, 20, 'forest', 100)
      .run()

    const r = await handleTravelManage(db(), {
      action: 'land',
      characterId: 'char-1',
      worldId: WORLD,
      toQ: 20,
      toR: 20,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.outcome).toBe('rejected')
    expect(body.reason).toMatch(/cannot land/i)
    expect(body.landingZone).toBe('unlandable')
  })

  it('land allows aircraft class when LZ meets minimum', async () => {
    await createWorld()
    // Set up hex with clearing biome (suitable for light aircraft)
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 21, 21, 'glade', 100)
      .run()

    const r = await handleTravelManage(db(), {
      action: 'land',
      characterId: 'char-1',
      worldId: WORLD,
      toQ: 21,
      toR: 21,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.outcome).toMatch(/success|go_around|hard_landing|crash/)
    expect(body.landingZone).toBe('clearing')
  })

  it('land can produce success outcome', async () => {
    await createWorld()
    // Set up hex with road biome
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 22, 22, 'road', 100)
      .run()

    let foundSuccess = false
    for (let i = 0; i < 50; i++) {
      const r = await handleTravelManage(db(), {
        action: 'land',
        characterId: `char-land-success-${i}`,
        worldId: WORLD,
        toQ: 22,
        toR: 22,
        aircraftClass: 'light_fixed_wing',
      })
      const body = JSON.parse(r.content[0].text)
      if (body.outcome === 'success') {
        foundSuccess = true
        expect(body.fuelWasted).toBe(false)
        expect(body.damage).toBe(0)
        break
      }
    }
    expect(foundSuccess).toBe(true)
  })

  it('land can produce go_around outcome', async () => {
    await createWorld()
    // Set up hex with clearing
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 23, 23, 'glade', 100)
      .run()

    let foundGoAround = false
    for (let i = 0; i < 50; i++) {
      const r = await handleTravelManage(db(), {
        action: 'land',
        characterId: `char-go-around-${i}`,
        worldId: WORLD,
        toQ: 23,
        toR: 23,
        aircraftClass: 'light_fixed_wing',
      })
      const body = JSON.parse(r.content[0].text)
      if (body.outcome === 'go_around') {
        foundGoAround = true
        expect(body.fuelWasted).toBe(true)
        break
      }
    }
    expect(foundGoAround).toBe(true)
  })

  it('land can produce hard_landing outcome', async () => {
    await createWorld()
    // Set up hex with clearing (more difficult than road)
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 24, 24, 'glade', 100)
      .run()

    let foundHardLanding = false
    for (let i = 0; i < 50; i++) {
      const r = await handleTravelManage(db(), {
        action: 'land',
        characterId: `char-hard-land-${i}`,
        worldId: WORLD,
        toQ: 24,
        toR: 24,
        aircraftClass: 'light_fixed_wing',
      })
      const body = JSON.parse(r.content[0].text)
      if (body.outcome === 'hard_landing') {
        foundHardLanding = true
        expect(body.damage).toBeGreaterThanOrEqual(1)
        expect(body.damage).toBeLessThanOrEqual(6)
        expect(body.effects).toContain('landing gear stress')
        break
      }
    }
    expect(foundHardLanding).toBe(true)
  })

  it('land can produce crash outcome', async () => {
    await createWorld()
    // Set up hex with clearing
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 25, 25, 'glade', 100)
      .run()

    let foundCrash = false
    for (let i = 0; i < 50; i++) {
      const r = await handleTravelManage(db(), {
        action: 'land',
        characterId: `char-land-crash-${i}`,
        worldId: WORLD,
        toQ: 25,
        toR: 25,
        aircraftClass: 'light_fixed_wing',
      })
      const body = JSON.parse(r.content[0].text)
      if (body.outcome === 'crash') {
        foundCrash = true
        expect(body.fuelWasted).toBe(true)
        expect(body.damage).toBeGreaterThan(0)
        expect(body.effects).toContain('aircraft damaged')
        break
      }
    }
    expect(foundCrash).toBe(true)
  })

  it('land crash via natural-1 critical failure', async () => {
    await createWorld()
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 45, 45, 'glade', 100)
      .run()

    let foundCritCrash = false
    for (let i = 0; i < 300; i++) {
      const r = await handleTravelManage(db(), {
        action: 'land',
        characterId: `char-land-crit-crash-${i}`,
        worldId: WORLD,
        toQ: 45,
        toR: 45,
        aircraftClass: 'light_fixed_wing',
      })
      const body = JSON.parse(r.content[0].text)
      if (body.outcome === 'crash' && body.roll?.critical === 'failure') {
        foundCritCrash = true
        expect(body.effects).toContain('aircraft damaged')
        expect(body.effects).toContain('possible injuries to occupants')
        break
      }
    }
    expect(foundCritCrash).toBe(true)
  })

  it('land computes slope from a neighboring hex', async () => {
    await createWorld()
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 46, 46, 'glade', 100)
      .run()
    // Axial neighbor (toQ+1, toR) with a large elevation delta — pushes slope > 10,
    // reclassifying the destination hex from 'clearing' to 'unlandable'.
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 47, 46, 'glade', 200)
      .run()

    const r = await handleTravelManage(db(), {
      action: 'land',
      characterId: 'char-1',
      worldId: WORLD,
      toQ: 46,
      toR: 46,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.outcome).toBe('rejected')
    expect(body.landingZone).toBe('unlandable')
  })

  it('land blocked by storm', async () => {
    await createWorld()
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 40, 40, 'glade', 100)
      .run()
    await handleWeatherManage(db(), { action: 'set_forecast', worldId: WORLD, conditions: 'storm' })

    const r = await handleTravelManage(db(), {
      action: 'land',
      characterId: 'char-1',
      worldId: WORLD,
      toQ: 40,
      toR: 40,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.outcome).toBe('rejected')
    expect(body.reason).toMatch(/storm/i)
  })

  it('land blocked by heavy precipitation', async () => {
    await createWorld()
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 41, 41, 'glade', 100)
      .run()
    await handleWeatherManage(db(), {
      action: 'set_forecast',
      worldId: WORLD,
      conditions: 'overcast',
      precipitationType: 'sleet',
    })

    const r = await handleTravelManage(db(), {
      action: 'land',
      characterId: 'char-1',
      worldId: WORLD,
      toQ: 41,
      toR: 41,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.outcome).toBe('rejected')
    expect(body.reason).toMatch(/sleet/i)
  })

  it('land blocked by low visibility', async () => {
    await createWorld()
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 42, 42, 'glade', 100)
      .run()
    await handleWeatherManage(db(), {
      action: 'set_forecast',
      worldId: WORLD,
      conditions: 'overcast',
      visibility: 'poor',
    })

    const r = await handleTravelManage(db(), {
      action: 'land',
      characterId: 'char-1',
      worldId: WORLD,
      toQ: 42,
      toR: 42,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.outcome).toBe('rejected')
    expect(body.reason).toMatch(/visibility/i)
  })

  it('land blocked by excessive crosswind', async () => {
    await createWorld()
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 43, 43, 'glade', 100)
      .run()
    await handleWeatherManage(db(), {
      action: 'set_forecast',
      worldId: WORLD,
      conditions: 'overcast',
      windSpeed: 50,
    })

    const r = await handleTravelManage(db(), {
      action: 'land',
      characterId: 'char-1',
      worldId: WORLD,
      toQ: 43,
      toR: 43,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.outcome).toBe('rejected')
    expect(body.reason).toMatch(/crosswind/i)
  })

  it('land proceeds when weather is found but clear', async () => {
    await createWorld()
    await env
      .RPG_DB!.prepare(
        'INSERT INTO hexes (world_id, q, r, biome, elevation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(WORLD, 44, 44, 'road', 100)
      .run()
    await handleWeatherManage(db(), {
      action: 'set_forecast',
      worldId: WORLD,
      conditions: 'clear',
      windSpeed: 5,
      visibility: 'unlimited',
      precipitationType: 'none',
    })

    const r = await handleTravelManage(db(), {
      action: 'land',
      characterId: 'char-1',
      worldId: WORLD,
      toQ: 44,
      toR: 44,
      aircraftClass: 'light_fixed_wing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.outcome).toMatch(/success|go_around|hard_landing|crash/)
  })

  // ── rappel slice 2 — weather modifiers & pilot hover-stability check ────

  it('rappel with no weather forecast uses no weather modifier (found: false)', async () => {
    // When weather is not found, no modifier applied. Should behave identically to slice 1.
    // This tests the regression: "no regression" requirement.
    const r = await handleTravelManage(db(), {
      action: 'rappel',
      characterId: 'char-noweather',
      height: 'low',
      worldId: WORLD,
      proficient: true,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.roll).toBeDefined()
    // Height modifier low = 0, no weather modifier, no pilot failure = total 0
    expect(body.roll.modifier).toBe(0)
  })

  it('rappel with storm weather blocks rappel entirely', async () => {
    // Set up world_state and weather_log with storm
    const env = db()
    await createWorld()
    const worldRow = (await env.RPG_DB!.prepare(
      'SELECT world_day FROM world_state WHERE world_id = ?',
    )
      .bind(WORLD)
      .first()) as { world_day: number } | null
    const currentDay = worldRow?.world_day ?? 0

    // Insert weather with storm condition
    await env.RPG_DB!.prepare(
      'INSERT INTO weather_log (world_id, day, season, conditions, temperature_high, temperature_low, wind_speed, wind_direction, precipitation_type, humidity, visibility, fog, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        WORLD,
        currentDay,
        'summer',
        'storm',
        25,
        15,
        50,
        'NW',
        'rain',
        0.9,
        'poor',
        0,
        'test',
      )
      .run()

    const r = await handleTravelManage(db(), {
      action: 'rappel',
      characterId: 'char-storm',
      height: 'low',
      worldId: WORLD,
      proficient: true,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.outcome).toBe('not_attempted')
    expect(body.reason).toContain('Storm')
  })

  it('rappel with high wind (>25 knots) applies -4 penalty', async () => {
    const env = db()
    await createWorld()
    const worldRow = (await env.RPG_DB!.prepare(
      'SELECT world_day FROM world_state WHERE world_id = ?',
    )
      .bind(WORLD)
      .first()) as { world_day: number } | null
    const currentDay = worldRow?.world_day ?? 0

    // Insert weather with high wind but clear skies
    await env.RPG_DB!.prepare(
      'INSERT INTO weather_log (world_id, day, season, conditions, temperature_high, temperature_low, wind_speed, wind_direction, precipitation_type, humidity, visibility, fog, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        WORLD,
        currentDay,
        'summer',
        'clear',
        25,
        15,
        30,
        'NW',
        'none',
        0.5,
        'unlimited',
        0,
        'test',
      )
      .run()

    const r = await handleTravelManage(db(), {
      action: 'rappel',
      characterId: 'char-wind',
      height: 'low',
      worldId: WORLD,
      proficient: true,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.roll).toBeDefined()
    // Height modifier 0 + weather modifier -4 = -4
    expect(body.roll.modifier).toBe(-4)
    expect(body.effects).toContain('high wind')
  })

  it('rappel with rain applies -2 penalty (wet rope)', async () => {
    const env = db()
    await createWorld()
    const worldRow = (await env.RPG_DB!.prepare(
      'SELECT world_day FROM world_state WHERE world_id = ?',
    )
      .bind(WORLD)
      .first()) as { world_day: number } | null
    const currentDay = worldRow?.world_day ?? 0

    // Insert weather with rain
    await env.RPG_DB!.prepare(
      'INSERT INTO weather_log (world_id, day, season, conditions, temperature_high, temperature_low, wind_speed, wind_direction, precipitation_type, humidity, visibility, fog, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        WORLD,
        currentDay,
        'summer',
        'rain',
        20,
        15,
        15,
        'W',
        'rain',
        0.8,
        'moderate',
        0,
        'test',
      )
      .run()

    const r = await handleTravelManage(db(), {
      action: 'rappel',
      characterId: 'char-rain',
      height: 'low',
      worldId: WORLD,
      proficient: true,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.roll).toBeDefined()
    // Height modifier 0 + weather modifier -2 = -2
    expect(body.roll.modifier).toBe(-2)
    expect(body.effects).toContain('wet rope')
  })

  it('rappel with combined modifiers: high wind + rain', async () => {
    const env = db()
    await createWorld()
    const worldRow = (await env.RPG_DB!.prepare(
      'SELECT world_day FROM world_state WHERE world_id = ?',
    )
      .bind(WORLD)
      .first()) as { world_day: number } | null
    const currentDay = worldRow?.world_day ?? 0

    // Insert weather with both wind and rain
    await env.RPG_DB!.prepare(
      'INSERT INTO weather_log (world_id, day, season, conditions, temperature_high, temperature_low, wind_speed, wind_direction, precipitation_type, humidity, visibility, fog, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        WORLD,
        currentDay,
        'summer',
        'rain',
        20,
        15,
        30,
        'W',
        'rain',
        0.8,
        'moderate',
        0,
        'test',
      )
      .run()

    const r = await handleTravelManage(db(), {
      action: 'rappel',
      characterId: 'char-windrain',
      height: 'high',
      worldId: WORLD,
      proficient: true,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.roll).toBeDefined()
    // Height modifier -2 + wind -4 + rain -2 = -8
    expect(body.roll.modifier).toBe(-8)
    expect(body.effects).toContain('high wind')
    expect(body.effects).toContain('wet rope')
  })

  it('rappel with pilot present in standard weather auto-passes (no roll)', async () => {
    const env = db()
    await createWorld()
    const worldRow = (await env.RPG_DB!.prepare(
      'SELECT world_day FROM world_state WHERE world_id = ?',
    )
      .bind(WORLD)
      .first()) as { world_day: number } | null
    const currentDay = worldRow?.world_day ?? 0

    // Insert clear weather (no adverse conditions)
    await env.RPG_DB!.prepare(
      'INSERT INTO weather_log (world_id, day, season, conditions, temperature_high, temperature_low, wind_speed, wind_direction, precipitation_type, humidity, visibility, fog, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        WORLD,
        currentDay,
        'summer',
        'clear',
        25,
        15,
        10,
        'NW',
        'none',
        0.5,
        'unlimited',
        0,
        'test',
      )
      .run()

    const r = await handleTravelManage(db(), {
      action: 'rappel',
      characterId: 'char-pilotpresent',
      height: 'low',
      worldId: WORLD,
      proficient: true,
      pilotCharacterId: 'pilot-1',
      pilotProficient: true,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    // Pilot auto-passes in standard conditions, no additional penalty
    expect(body.roll.modifier).toBe(0)
  })

  it('rappel with pilot failure in adverse weather applies -2 penalty to rappeller', async () => {
    const env = db()
    await createWorld()
    const worldRow = (await env.RPG_DB!.prepare(
      'SELECT world_day FROM world_state WHERE world_id = ?',
    )
      .bind(WORLD)
      .first()) as { world_day: number } | null
    const currentDay = worldRow?.world_day ?? 0

    // Insert weather with rain (adverse condition triggering pilot check)
    await env.RPG_DB!.prepare(
      'INSERT INTO weather_log (world_id, day, season, conditions, temperature_high, temperature_low, wind_speed, wind_direction, precipitation_type, humidity, visibility, fog, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        WORLD,
        currentDay,
        'summer',
        'rain',
        20,
        15,
        15,
        'W',
        'rain',
        0.8,
        'moderate',
        0,
        'test',
      )
      .run()

    // Test multiple times to increase chance of pilot failure
    // With untrained pilot (-2 weather modifier on their check), failure more likely
    let foundPilotFailure = false
    for (let i = 0; i < 100; i++) {
      const r = await handleTravelManage(db(), {
        action: 'rappel',
        characterId: `char-pilot-fail-${i}`,
        height: 'low',
        worldId: WORLD,
        proficient: true,
        pilotCharacterId: `pilot-untrained-${i}`,
        pilotProficient: false,
      })
      const body = JSON.parse(r.content[0].text)
      // When pilot fails, rappeller gets -2 additional penalty (rain -2 + pilot failure -2 = -4 total)
      if (body.roll.modifier === -4) {
        foundPilotFailure = true
        expect(body.success).toBe(true)
        break
      }
    }
    expect(foundPilotFailure).toBe(true)
  })

  it('rappel with pilot critical failure (nat 1) triggers rappeller DEX save', async () => {
    const env = db()
    await createWorld()
    const worldRow = (await env.RPG_DB!.prepare(
      'SELECT world_day FROM world_state WHERE world_id = ?',
    )
      .bind(WORLD)
      .first()) as { world_day: number } | null
    const currentDay = worldRow?.world_day ?? 0

    // Insert weather with rain to trigger pilot check
    await env.RPG_DB!.prepare(
      'INSERT INTO weather_log (world_id, day, season, conditions, temperature_high, temperature_low, wind_speed, wind_direction, precipitation_type, humidity, visibility, fog, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        WORLD,
        currentDay,
        'summer',
        'rain',
        20,
        15,
        15,
        'W',
        'rain',
        0.8,
        'moderate',
        0,
        'test',
      )
      .run()

    // Test multiple times to catch a pilot critical failure (nat 1)
    let foundCritical = false
    for (let i = 0; i < 200; i++) {
      const r = await handleTravelManage(db(), {
        action: 'rappel',
        characterId: `char-pilot-crit-${i}`,
        height: 'extreme',
        worldId: WORLD,
        proficient: true,
        pilotCharacterId: `pilot-crit-${i}`,
        pilotProficient: true,
      })
      const body = JSON.parse(r.content[0].text)
      // Critical failure results in DEX save check
      if (body.dexSave) {
        foundCritical = true
        expect(body.outcome).toBe('fall')
        expect(body.effects).toContain('pilot lost control')
        break
      }
    }
    expect(foundCritical).toBe(true)
  })

  it('rappel with pilot critical failure and rappeller DEX save success is rescued (no fall)', async () => {
    const env = db()
    await createWorld()
    const worldRow = (await env.RPG_DB!.prepare(
      'SELECT world_day FROM world_state WHERE world_id = ?',
    )
      .bind(WORLD)
      .first()) as { world_day: number } | null
    const currentDay = worldRow?.world_day ?? 0

    // Insert weather with rain to trigger pilot check
    await env.RPG_DB!.prepare(
      'INSERT INTO weather_log (world_id, day, season, conditions, temperature_high, temperature_low, wind_speed, wind_direction, precipitation_type, humidity, visibility, fog, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        WORLD,
        currentDay,
        'summer',
        'rain',
        20,
        15,
        15,
        'W',
        'rain',
        0.8,
        'moderate',
        0,
        'test',
      )
      .run()

    // Test multiple times to catch a pilot critical failure followed by a
    // passed rappeller DEX save — the "rescued" fall-through path, which
    // has no dedicated response field (unlike the failed-save "fall" path)
    // so it must be detected via the effects text.
    let foundRescued = false
    for (let i = 0; i < 500; i++) {
      const r = await handleTravelManage(db(), {
        action: 'rappel',
        characterId: `char-pilot-rescue-${i}`,
        height: 'extreme',
        worldId: WORLD,
        proficient: true,
        pilotCharacterId: `pilot-rescue-${i}`,
        pilotProficient: true,
      })
      const body = JSON.parse(r.content[0].text)
      if (body.effects?.includes('pilot lost control but rescued')) {
        foundRescued = true
        expect(body.dexSave).toBeUndefined()
        break
      }
    }
    expect(foundRescued).toBe(true)
  })
})
