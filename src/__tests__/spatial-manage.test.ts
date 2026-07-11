// Direct handler tests for spatial-manage (#290 — dynamic biome registry
// integration; this file previously had no test coverage at all).
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handleSpatialManage } from '../rpg/handlers/spatial-manage'
import { handleBiomeManage } from '../rpg/handlers/biome-manage'

describe('handleSpatialManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)
  const WORLD = 'world-1'

  async function createWorld(id = WORLD) {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare('INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, 'Test World', 'abc123', 100, 100, now, now).run()
  }

  it('returns guiding error for unknown action', async () => {
    const r = await handleSpatialManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  // ── look ─────────────────────────────────────────────────────────────────

  it('look requires roomId', async () => {
    const r = await handleSpatialManage(db(), { action: 'look' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('look returns not found for a nonexistent room', async () => {
    const r = await handleSpatialManage(db(), { action: 'look', roomId: 'no-id' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('look returns room details, increments visitedCount, and includes worldId', async () => {
    await createWorld()
    const gen = await handleSpatialManage(db(), { action: 'generate', name: 'The Old Mill', description: 'A crumbling watermill by the river.', worldId: WORLD })
    const { roomId } = JSON.parse(gen.content[0].text)
    const r = await handleSpatialManage(db(), { action: 'look', roomId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.name).toBe('The Old Mill')
    expect(body.worldId).toBe(WORLD)
    expect(body.visitedCount).toBe(1)
  })

  // ── generate ─────────────────────────────────────────────────────────────

  it('generate requires name', async () => {
    const r = await handleSpatialManage(db(), { action: 'generate' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('generate uses a fallback description when none/too-short is given', async () => {
    const r = await handleSpatialManage(db(), { action: 'generate', name: 'Bare Room' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    const look = await handleSpatialManage(db(), { action: 'look', roomId: body.roomId })
    expect(JSON.parse(look.content[0].text).description).toContain('Bare Room')
  })

  it('generate defaults biome to dungeon and worldId to null when omitted', async () => {
    const r = await handleSpatialManage(db(), { action: 'generate', name: 'Unscoped Room' })
    const body = JSON.parse(r.content[0].text)
    expect(body.biome).toBe('dungeon')
    expect(body.worldId).toBeNull()
  })

  it('generate accepts any biome string when the world has no registered biomes (backward compatible)', async () => {
    await createWorld()
    const r = await handleSpatialManage(db(), { action: 'generate', name: 'Free-Form Room', biome: 'limestone_karst', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.biome).toBe('limestone_karst')
  })

  it('generate rejects a biome not registered for a world with a populated registry', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog' })
    const r = await handleSpatialManage(db(), { action: 'generate', name: 'Bad Biome Room', biome: 'nonexistent_biome', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('bog')
  })

  it('generate accepts a registered biome for a world with a populated registry', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog' })
    const r = await handleSpatialManage(db(), { action: 'generate', name: 'Bog Room', biome: 'bog', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  // ── update ───────────────────────────────────────────────────────────────

  it('update requires roomId', async () => {
    const r = await handleSpatialManage(db(), { action: 'update' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update returns not found for a nonexistent room', async () => {
    const r = await handleSpatialManage(db(), { action: 'update', roomId: 'no-id', name: 'X' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update modifies name/description/atmosphere/exits', async () => {
    const gen = await handleSpatialManage(db(), { action: 'generate', name: 'Old Name' })
    const { roomId } = JSON.parse(gen.content[0].text)
    const r = await handleSpatialManage(db(), {
      action: 'update', roomId, name: 'New Name', description: 'A brand new description here.',
      atmosphere: ['damp', 'cold'], exits: [{ direction: 'north', targetRoomId: 'other-room' }],
    })
    expect(JSON.parse(r.content[0].text).success).toBe(true)
    const look = await handleSpatialManage(db(), { action: 'look', roomId })
    const body = JSON.parse(look.content[0].text)
    expect(body.name).toBe('New Name')
    expect(body.description).toBe('A brand new description here.')
    expect(body.atmosphere).toEqual(['damp', 'cold'])
    expect(body.exits).toEqual([{ direction: 'north', targetRoomId: 'other-room' }])
  })

  it('update ignores a too-short description', async () => {
    const gen = await handleSpatialManage(db(), { action: 'generate', name: 'Desc Room' })
    const { roomId } = JSON.parse(gen.content[0].text)
    await handleSpatialManage(db(), { action: 'update', roomId, description: 'short' })
    const look = await handleSpatialManage(db(), { action: 'look', roomId })
    expect(JSON.parse(look.content[0].text).description).toContain('Desc Room')
  })

  it('update validates biome against the room\'s existing worldId when no new worldId is given', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog' })
    const gen = await handleSpatialManage(db(), { action: 'generate', name: 'Scoped Room', worldId: WORLD, biome: 'bog' })
    const { roomId } = JSON.parse(gen.content[0].text)
    const r = await handleSpatialManage(db(), { action: 'update', roomId, biome: 'nonexistent_biome' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update validates biome against an explicitly-supplied worldId (reassignment)', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog' })
    const gen = await handleSpatialManage(db(), { action: 'generate', name: 'Unscoped Room' })
    const { roomId } = JSON.parse(gen.content[0].text)
    const r = await handleSpatialManage(db(), { action: 'update', roomId, worldId: WORLD, biome: 'nonexistent_biome' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update accepts a valid biome and can reassign worldId', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog' })
    const gen = await handleSpatialManage(db(), { action: 'generate', name: 'Reassign Room' })
    const { roomId } = JSON.parse(gen.content[0].text)
    const r = await handleSpatialManage(db(), { action: 'update', roomId, worldId: WORLD, biome: 'bog' })
    expect(JSON.parse(r.content[0].text).success).toBe(true)
    const look = await handleSpatialManage(db(), { action: 'look', roomId })
    const body = JSON.parse(look.content[0].text)
    expect(body.biome).toBe('bog')
    expect(body.worldId).toBe(WORLD)
  })

  // ── get_exits ────────────────────────────────────────────────────────────

  it('get_exits requires roomId', async () => {
    const r = await handleSpatialManage(db(), { action: 'get_exits' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_exits returns not found for a nonexistent room', async () => {
    const r = await handleSpatialManage(db(), { action: 'get_exits', roomId: 'no-id' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_exits returns the exits array', async () => {
    const gen = await handleSpatialManage(db(), { action: 'generate', name: 'Exit Room', exits: [{ direction: 'east', targetRoomId: 'r2' }] })
    const { roomId } = JSON.parse(gen.content[0].text)
    const r = await handleSpatialManage(db(), { action: 'get_exits', roomId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBe(1)
  })

  // ── move ─────────────────────────────────────────────────────────────────

  it('move requires roomId and direction', async () => {
    const r = await handleSpatialManage(db(), { action: 'move', roomId: 'x' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('move returns not found for a nonexistent origin room', async () => {
    const r = await handleSpatialManage(db(), { action: 'move', roomId: 'no-id', direction: 'north' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('move errors when there is no exit in that direction', async () => {
    const gen = await handleSpatialManage(db(), { action: 'generate', name: 'Dead End' })
    const { roomId } = JSON.parse(gen.content[0].text)
    const r = await handleSpatialManage(db(), { action: 'move', roomId, direction: 'north' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('move errors when the exit target room no longer exists', async () => {
    const gen = await handleSpatialManage(db(), { action: 'generate', name: 'Broken Exit Room', exits: [{ direction: 'north', targetRoomId: 'ghost-room' }] })
    const { roomId } = JSON.parse(gen.content[0].text)
    const r = await handleSpatialManage(db(), { action: 'move', roomId, direction: 'north' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('move succeeds to a valid target room (case-insensitive direction)', async () => {
    const dest = await handleSpatialManage(db(), { action: 'generate', name: 'Destination Room' })
    const destId = JSON.parse(dest.content[0].text).roomId
    const gen = await handleSpatialManage(db(), { action: 'generate', name: 'Origin Room', exits: [{ direction: 'North', targetRoomId: destId }] })
    const { roomId } = JSON.parse(gen.content[0].text)
    const r = await handleSpatialManage(db(), { action: 'move', roomId, direction: 'north' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.toRoomId).toBe(destId)
  })

  // ── list ─────────────────────────────────────────────────────────────────

  it('list returns all rooms with no filter', async () => {
    await handleSpatialManage(db(), { action: 'generate', name: 'Room A' })
    await handleSpatialManage(db(), { action: 'generate', name: 'Room B' })
    const r = await handleSpatialManage(db(), { action: 'list' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBeGreaterThanOrEqual(2)
  })

  it('list filters by worldIdFilter', async () => {
    await createWorld()
    await createWorld('world-2')
    await handleSpatialManage(db(), { action: 'generate', name: 'Calder Room', worldId: WORLD })
    await handleSpatialManage(db(), { action: 'generate', name: 'Other Room', worldId: 'world-2' })
    const r = await handleSpatialManage(db(), { action: 'list', worldIdFilter: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.count).toBe(1)
    expect(body.rooms[0].name).toBe('Calder Room')
  })

  // ── network_create / network_get / network_list ─────────────────────────

  it('network_create requires name and worldId', async () => {
    const r = await handleSpatialManage(db(), { action: 'network_create' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('network_create creates a network', async () => {
    await createWorld()
    const r = await handleSpatialManage(db(), { action: 'network_create', name: 'The Old Quarter', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.networkId).toBeTruthy()
  })

  it('network_get requires networkId', async () => {
    const r = await handleSpatialManage(db(), { action: 'network_get' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('network_get returns not found for a nonexistent network', async () => {
    const r = await handleSpatialManage(db(), { action: 'network_get', networkId: 'no-id' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('network_get returns the network and its linked nodes', async () => {
    await createWorld()
    const net = await handleSpatialManage(db(), { action: 'network_create', name: 'The Docks', worldId: WORLD })
    const { networkId } = JSON.parse(net.content[0].text)
    const gen = await handleSpatialManage(db(), { action: 'generate', name: 'Dock Room' })
    const { roomId } = JSON.parse(gen.content[0].text)
    await env.RPG_DB.prepare('UPDATE room_nodes SET network_id = ? WHERE id = ?').bind(networkId, roomId).run()

    const r = await handleSpatialManage(db(), { action: 'network_get', networkId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.nodeCount).toBe(1)
  })

  it('network_list returns all networks', async () => {
    await createWorld()
    await handleSpatialManage(db(), { action: 'network_create', name: 'Network A', worldId: WORLD })
    const r = await handleSpatialManage(db(), { action: 'network_list' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBeGreaterThanOrEqual(1)
  })
})
