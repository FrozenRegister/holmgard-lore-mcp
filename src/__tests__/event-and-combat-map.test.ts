// Tests for event_manage (poll-based analogue of Mnehmos's subscribe_to_events)
// and combat_map's get_terrain/set_terrain/calculate_aoe actions. See issue #206.
import { describe } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'

describe('event_manage', () => {
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

  it('emit+poll+ack round-trip', async () => {
    const emitted = await callTool('rpg', { sub: 'event', action: 'emit', eventType: 'combat_update', payload: { encounterId: 'enc-1', round: 2 }, sourceType: 'combat' })
    expect(emitted.success).toBe(true)
    expect(emitted.eventId).toBeTruthy()

    const polled = await callTool('rpg', { sub: 'event', action: 'poll', eventType: 'combat_update' })
    expect(polled.count).toBe(1)
    expect(polled.events[0].payload).toEqual({ encounterId: 'enc-1', round: 2 })

    const acked = await callTool('rpg', { sub: 'event', action: 'ack', id: emitted.eventId })
    expect(acked.acked).toBe(1)

    const polledAfterAck = await callTool('rpg', { sub: 'event', action: 'poll', eventType: 'combat_update' })
    expect(polledAfterAck.count).toBe(0)
  })

  it('poll with unconsumedOnly: false still returns acked events', async () => {
    const emitted = await callTool('rpg', { sub: 'event', action: 'emit', eventType: 'quest_update', payload: { questId: 'q1' } })
    await callTool('rpg', { sub: 'event', action: 'ack', id: emitted.eventId })
    const polled = await callTool('rpg', { sub: 'event', action: 'poll', eventType: 'quest_update', unconsumedOnly: false })
    expect(polled.count).toBe(1)
  })

  it('ack accepts a batch of ids', async () => {
    const e1 = await callTool('rpg', { sub: 'event', action: 'emit', eventType: 'system', payload: { msg: 'a' } })
    const e2 = await callTool('rpg', { sub: 'event', action: 'emit', eventType: 'system', payload: { msg: 'b' } })
    const acked = await callTool('rpg', { sub: 'event', action: 'ack', ids: [e1.eventId, e2.eventId] })
    expect(acked.acked).toBe(2)
  })

  it('list_types returns the known event and source types', async () => {
    const r = await callTool('rpg', { sub: 'event', action: 'list_types' })
    expect(r.eventTypes).toContain('combat_update')
    expect(r.sourceTypes).toContain('npc')
  })

  it('emit requires eventType and payload; ack requires id or ids', async () => {
    const noType = await callTool('rpg', { sub: 'event', action: 'emit', payload: {} })
    expect(noType.error).toBe(true)
    const noPayload = await callTool('rpg', { sub: 'event', action: 'emit', eventType: 'system' })
    expect(noPayload.error).toBe(true)
    const noAckTarget = await callTool('rpg', { sub: 'event', action: 'ack' })
    expect(noAckTarget.error).toBe(true)
  })
})

describe('combat_map: terrain and AoE', () => {
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

  it('get_terrain and set_terrain round-trip', async () => {
    const enc = await callTool('rpg', { sub: 'combat', action: 'create_encounter' })
    const map = await callTool('rpg', { sub: 'combat_map', action: 'create', encounterId: enc.encounterId, width: 8, height: 8 })

    const empty = await callTool('rpg', { sub: 'combat_map', action: 'get_terrain', id: map.mapId })
    expect(empty.terrain).toEqual([])

    const set = await callTool('rpg', { sub: 'combat_map', action: 'set_terrain', id: map.mapId, terrain: [{ x: 1, y: 1, type: 'wall' }, { x: 2, y: 2, type: 'water' }] })
    expect(set.terrainCount).toBe(2)

    const got = await callTool('rpg', { sub: 'combat_map', action: 'get_terrain', id: map.mapId })
    expect(got.terrain.length).toBe(2)
  })

  it('get_terrain works by encounterId and requires id or encounterId', async () => {
    const enc = await callTool('rpg', { sub: 'combat', action: 'create_encounter' })
    await callTool('rpg', { sub: 'combat_map', action: 'create', encounterId: enc.encounterId })
    const r = await callTool('rpg', { sub: 'combat_map', action: 'get_terrain', encounterId: enc.encounterId })
    expect(r.success).toBe(true)
    const noId = await callTool('rpg', { sub: 'combat_map', action: 'get_terrain' })
    expect(noId.error).toBe(true)
    const notFound = await callTool('rpg', { sub: 'combat_map', action: 'get_terrain', id: 'nonexistent' })
    expect(notFound.error).toBe(true)
  })

  it('set_terrain requires id and terrain, and 404s for an unknown map', async () => {
    const noId = await callTool('rpg', { sub: 'combat_map', action: 'set_terrain', terrain: [] })
    expect(noId.error).toBe(true)
    const notFound = await callTool('rpg', { sub: 'combat_map', action: 'set_terrain', id: 'nonexistent', terrain: [] })
    expect(notFound.error).toBe(true)
  })

  it('calculate_aoe computes a circle of cells around an origin', async () => {
    const r = await callTool('rpg', { sub: 'combat_map', action: 'calculate_aoe', origin: { x: 5, y: 5 }, shape: 'circle', size: 1 })
    expect(r.success).toBe(true)
    expect(r.cells.some((c: any) => c.x === 5 && c.y === 5)).toBe(true)
    expect(r.cells.some((c: any) => c.x === 6 && c.y === 6)).toBe(false) // outside radius 1 circle
  })

  it('calculate_aoe computes a square of cells around an origin', async () => {
    const r = await callTool('rpg', { sub: 'combat_map', action: 'calculate_aoe', origin: { x: 5, y: 5 }, shape: 'square', size: 1 })
    expect(r.count).toBe(9)
    expect(r.cells.some((c: any) => c.x === 6 && c.y === 6)).toBe(true)
  })

  it('calculate_aoe computes a line from origin to target', async () => {
    const r = await callTool('rpg', { sub: 'combat_map', action: 'calculate_aoe', origin: { x: 0, y: 0 }, target: { x: 3, y: 0 }, shape: 'line' })
    expect(r.cells).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }])
  })

  it('calculate_aoe requires origin, and target for a line shape', async () => {
    const noOrigin = await callTool('rpg', { sub: 'combat_map', action: 'calculate_aoe' })
    expect(noOrigin.error).toBe(true)
    const noTarget = await callTool('rpg', { sub: 'combat_map', action: 'calculate_aoe', origin: { x: 0, y: 0 }, shape: 'line' })
    expect(noTarget.error).toBe(true)
  })
})
