// Direct handler tests for travel-manage (not registered in rpgToolRegistry)
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handleTravelManage } from '../rpg/handlers/travel-manage'
import { handleBiomeManage } from '../rpg/handlers/biome-manage'
import { handleWorldMap } from '../rpg/handlers/world-map'

describe('handleTravelManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)

  async function createRoom(id: string, name: string, exits: unknown[] = []) {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare("INSERT INTO room_nodes (id, name, base_description, biome_context, atmospherics, exits, entity_ids, created_at, updated_at, visited_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, name, `A ${name} room for testing.`, 'forest', '[]', JSON.stringify(exits), '[]', now, now, 0).run()
  }

  async function createCharacter(id: string) {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(`INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, character_type, character_class, race, conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells, cantrips_known, currency, resource_pools, xp, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, id, '{}', 5, 20, 10, 4, 'pc', 'Fighter', 'Human', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', 0, now, now).run()
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
    const r = await handleTravelManage(db(), { action: 'travel', fromRoomId: 'no-room', direction: 'north' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('travel via direction returns error when no matching exit', async () => {
    await createRoom('room-2', 'Forest')
    const r = await handleTravelManage(db(), { action: 'travel', fromRoomId: 'room-2', direction: 'north' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('travel via direction follows exit', async () => {
    await createRoom('room-3', 'Cave')
    await createRoom('room-4', 'Dungeon', [{ direction: 'south', targetRoomId: 'no-room' }])
    await createRoom('room-5', 'Exit Room')
    await createRoom('room-6', 'Room With Exit', [{ direction: 'east', targetRoomId: 'room-5' }])
    const r = await handleTravelManage(db(), { action: 'travel', fromRoomId: 'room-6', direction: 'east' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.roomId).toBe('room-5')
  })

  it('travel via direction fails when target room not found', async () => {
    await createRoom('room-7', 'Broken Room', [{ direction: 'west', targetRoomId: 'ghost-room' }])
    const r = await handleTravelManage(db(), { action: 'travel', fromRoomId: 'room-7', direction: 'west' })
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
    const r = await handleTravelManage(db(), { action: 'loot', roomId: 'room-8', partyId: 'party-1' })
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
    const r = await handleTravelManage(db(), { action: 'rest', characterIds: ['char-rest-1'], restType: 'short' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hoursElapsed).toBe(1)
  })

  it('rest performs long rest', async () => {
    await createCharacter('char-rest-2')
    const r = await handleTravelManage(db(), { action: 'rest', characterIds: ['char-rest-2', 'missing-char'], restType: 'long' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hoursElapsed).toBe(8)
  })

  // ── resolveEncounter integration (#280) ────────────────────────────────────

  const WORLD = 'world-1'
  async function createWorld() {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare('INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(WORLD, 'Test World', 'abc123', 100, 100, now, now).run()
  }

  it('travel without resolveEncounter keeps the legacy flat-chance flag', async () => {
    await createRoom('room-legacy', 'Legacy Room')
    const r = await handleTravelManage(db(), { action: 'travel', toRoomId: 'room-legacy' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(typeof body.randomEncounter).toBe('boolean')
    expect(body.encounter).toBeUndefined()
  })

  it('travel with resolveEncounter but no worldId/x/y falls back to the legacy flag', async () => {
    await createRoom('room-nocoords', 'No Coords Room')
    const r = await handleTravelManage(db(), { action: 'travel', toRoomId: 'room-nocoords', resolveEncounter: true })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(typeof body.randomEncounter).toBe('boolean')
    expect(body.encounter).toBeUndefined()
  })

  it('travel with resolveEncounter and worldId/x/y calls the full encounter engine', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'deadly_ground', baseThreat: 100 })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 5, r: 5, biome: 'deadly_ground' }] })
    await createRoom('room-encounter', 'Ambush Room')
    const r = await handleTravelManage(db(), {
      action: 'travel', toRoomId: 'room-encounter', resolveEncounter: true, worldId: WORLD, x: 5, y: 5, includeInjuries: false,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.arrived).toBe(true)
    expect(body.encounter).toBeDefined()
    expect(body.encounter.encounter).toBe(true)
    expect(body.encounter.threshold).toBe(100)
    expect(body.randomEncounter).toBeUndefined()
  })
})
