// Direct handler tests for zone-type-manage (#320 follow-up)
import { describe } from './support/helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'
import { handleZoneTypeManage, DEFAULT_ZONE_TYPES, seedDefaultZoneTypes, getZoneTypeRegistry } from '@/rpg/handlers/zone-type-manage'

describe('handleZoneTypeManage', () => {
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
    const r = await handleZoneTypeManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  // register
  it('register requires worldId and name', async () => {
    const r = await handleZoneTypeManage(db(), { action: 'register' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('register rejects invalid name pattern', async () => {
    await createWorld()
    const r = await handleZoneTypeManage(db(), { action: 'register', worldId: WORLD, name: 'Bad-Name' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('lowercase')
  })

  it('register returns not found for unknown world', async () => {
    const r = await handleZoneTypeManage(db(), { action: 'register', worldId: 'no-world', name: 'sacred_ground' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('register rejects a glyph that is not exactly 1 character', async () => {
    await createWorld()
    const r = await handleZoneTypeManage(db(), { action: 'register', worldId: WORLD, name: 'sacred_ground', glyph: 'xx' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('1 character')
  })

  it('register accepts a null glyph (informational-only, no overlay)', async () => {
    await createWorld()
    const r = await handleZoneTypeManage(db(), { action: 'register', worldId: WORLD, name: 'sacred_ground', glyph: null })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.glyph).toBeNull()
  })

  it('register rejects an invalid colorHex', async () => {
    await createWorld()
    const r = await handleZoneTypeManage(db(), { action: 'register', worldId: WORLD, name: 'sacred_ground', colorHex: 'not-a-color' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('hex color')
  })

  it('register creates a zone type with null defaults', async () => {
    await createWorld()
    const r = await handleZoneTypeManage(db(), { action: 'register', worldId: WORLD, name: 'sacred_ground' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.glyph).toBeNull()
    expect(body.colorHex).toBeNull()
    expect(body.zoneTypeId).toBeTruthy()
  })

  it('register creates a zone type with explicit fields', async () => {
    await createWorld()
    const r = await handleZoneTypeManage(db(), {
      action: 'register', worldId: WORLD, name: 'sacred_ground', glyph: 'S', colorHex: '#AABBCC', description: 'A shrine site',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.glyph).toBe('S')
    expect(body.colorHex).toBe('#AABBCC')
  })

  it('register rejects a duplicate name for the same world', async () => {
    await createWorld()
    await handleZoneTypeManage(db(), { action: 'register', worldId: WORLD, name: 'sacred_ground' })
    const r = await handleZoneTypeManage(db(), { action: 'register', worldId: WORLD, name: 'sacred_ground' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('already exists')
  })

  // list
  it('list requires worldId', async () => {
    const r = await handleZoneTypeManage(db(), { action: 'list' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('list returns empty for a world with no zone types', async () => {
    await createWorld()
    const r = await handleZoneTypeManage(db(), { action: 'list', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBe(0)
    expect(body.zoneTypes).toEqual([])
  })

  it('list returns registered zone types ordered by name', async () => {
    await createWorld()
    await handleZoneTypeManage(db(), { action: 'register', worldId: WORLD, name: 'sacred_ground' })
    await handleZoneTypeManage(db(), { action: 'register', worldId: WORLD, name: 'ambush_site' })
    const r = await handleZoneTypeManage(db(), { action: 'list', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBe(2)
    expect(body.zoneTypes[0].name).toBe('ambush_site')
  })

  // get
  it('get requires id/zoneTypeId or worldId+name', async () => {
    const r = await handleZoneTypeManage(db(), { action: 'get' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get returns not found for an unknown id', async () => {
    const r = await handleZoneTypeManage(db(), { action: 'get', id: 'no-such-zone-type' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get fetches by id', async () => {
    await createWorld()
    const created = JSON.parse((await handleZoneTypeManage(db(), { action: 'register', worldId: WORLD, name: 'sacred_ground' })).content[0].text)
    const r = await handleZoneTypeManage(db(), { action: 'get', id: created.zoneTypeId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.zoneType.name).toBe('sacred_ground')
  })

  it('get fetches by worldId + name', async () => {
    await createWorld()
    await handleZoneTypeManage(db(), { action: 'register', worldId: WORLD, name: 'sacred_ground' })
    const r = await handleZoneTypeManage(db(), { action: 'get', worldId: WORLD, name: 'sacred_ground' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.zoneType.name).toBe('sacred_ground')
  })

  // update
  it('update requires id or zoneTypeId', async () => {
    const r = await handleZoneTypeManage(db(), { action: 'update' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update returns not found for an unknown id', async () => {
    const r = await handleZoneTypeManage(db(), { action: 'update', id: 'no-such-zone-type', glyph: 'X' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update rejects an invalid glyph', async () => {
    await createWorld()
    const created = JSON.parse((await handleZoneTypeManage(db(), { action: 'register', worldId: WORLD, name: 'sacred_ground' })).content[0].text)
    const r = await handleZoneTypeManage(db(), { action: 'update', id: created.zoneTypeId, glyph: 'xx' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update rejects an invalid colorHex', async () => {
    await createWorld()
    const created = JSON.parse((await handleZoneTypeManage(db(), { action: 'register', worldId: WORLD, name: 'sacred_ground' })).content[0].text)
    const r = await handleZoneTypeManage(db(), { action: 'update', id: created.zoneTypeId, colorHex: 'nope' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update applies all fields', async () => {
    await createWorld()
    const created = JSON.parse((await handleZoneTypeManage(db(), { action: 'register', worldId: WORLD, name: 'sacred_ground' })).content[0].text)
    const r = await handleZoneTypeManage(db(), {
      action: 'update', id: created.zoneTypeId, glyph: 'S', colorHex: '#112233', description: 'Updated description',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    const fetched = JSON.parse((await handleZoneTypeManage(db(), { action: 'get', id: created.zoneTypeId })).content[0].text)
    expect(fetched.zoneType.glyph).toBe('S')
    expect(fetched.zoneType.color_hex).toBe('#112233')
    expect(fetched.zoneType.description).toBe('Updated description')
  })

  it('update can clear glyph back to null', async () => {
    await createWorld()
    const created = JSON.parse((await handleZoneTypeManage(db(), { action: 'register', worldId: WORLD, name: 'sacred_ground', glyph: 'S' })).content[0].text)
    await handleZoneTypeManage(db(), { action: 'update', id: created.zoneTypeId, glyph: null })
    const fetched = JSON.parse((await handleZoneTypeManage(db(), { action: 'get', id: created.zoneTypeId })).content[0].text)
    expect(fetched.zoneType.glyph).toBeNull()
  })

  // delete
  it('delete requires id or zoneTypeId', async () => {
    const r = await handleZoneTypeManage(db(), { action: 'delete' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('delete returns not found for an unknown id', async () => {
    const r = await handleZoneTypeManage(db(), { action: 'delete', id: 'no-such-zone-type' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('delete removes an unreferenced zone type', async () => {
    await createWorld()
    const created = JSON.parse((await handleZoneTypeManage(db(), { action: 'register', worldId: WORLD, name: 'sacred_ground' })).content[0].text)
    const r = await handleZoneTypeManage(db(), { action: 'delete', id: created.zoneTypeId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    const fetched = JSON.parse((await handleZoneTypeManage(db(), { action: 'get', id: created.zoneTypeId })).content[0].text)
    expect(fetched.error).toBe(true)
  })

  it('delete rejects removal of a zone type referenced by an existing landmark', async () => {
    await createWorld()
    const created = JSON.parse((await handleZoneTypeManage(db(), { action: 'register', worldId: WORLD, name: 'sacred_ground' })).content[0].text)
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO landmarks (id, map_id, q, r, name, category, world_id, zone_type, zone_shape, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind('lm-1', 'main', 1, 1, 'Shrine', 'landmark', WORLD, 'sacred_ground', JSON.stringify({ type: 'circle', circle: { radius: 2 } }), now).run()
    const r = await handleZoneTypeManage(db(), { action: 'delete', id: created.zoneTypeId })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('referenced by existing landmarks')
  })

  // validate
  it('validate requires worldId and name', async () => {
    const r = await handleZoneTypeManage(db(), { action: 'validate' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('validate returns valid: true for an existing zone type', async () => {
    await createWorld()
    await handleZoneTypeManage(db(), { action: 'register', worldId: WORLD, name: 'sacred_ground' })
    const r = await handleZoneTypeManage(db(), { action: 'validate', worldId: WORLD, name: 'sacred_ground' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.valid).toBe(true)
  })

  it('validate returns valid: false with didYouMean suggestions for a near-miss', async () => {
    await createWorld()
    await handleZoneTypeManage(db(), { action: 'register', worldId: WORLD, name: 'sacred_ground' })
    const r = await handleZoneTypeManage(db(), { action: 'validate', worldId: WORLD, name: 'sacred_grond' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.valid).toBe(false)
    expect(body.didYouMean).toContain('sacred_ground')
  })

  it('validate returns empty didYouMean when nothing is close', async () => {
    await createWorld()
    const r = await handleZoneTypeManage(db(), { action: 'validate', worldId: WORLD, name: 'zzz' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.valid).toBe(false)
    expect(body.didYouMean).toEqual([])
  })

  // seed_defaults
  it('seed_defaults requires worldId', async () => {
    const r = await handleZoneTypeManage(db(), { action: 'seed_defaults' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('seed_defaults returns not found for an unknown world', async () => {
    const r = await handleZoneTypeManage(db(), { action: 'seed_defaults', worldId: 'no-world' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('seed_defaults seeds all defaults for a fresh world', async () => {
    await createWorld()
    const r = await handleZoneTypeManage(db(), { action: 'seed_defaults', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.seeded).toBe(DEFAULT_ZONE_TYPES.length)
    expect(body.totalDefaults).toBe(DEFAULT_ZONE_TYPES.length)
  })

  it('seed_defaults is idempotent — re-seeding inserts nothing new', async () => {
    await createWorld()
    await handleZoneTypeManage(db(), { action: 'seed_defaults', worldId: WORLD })
    const r = await handleZoneTypeManage(db(), { action: 'seed_defaults', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.seeded).toBe(0)
  })

  it('seed_defaults only seeds missing defaults when some already exist', async () => {
    await createWorld()
    await handleZoneTypeManage(db(), { action: 'register', worldId: WORLD, name: 'perimeter', glyph: '⚡' })
    const r = await handleZoneTypeManage(db(), { action: 'seed_defaults', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.seeded).toBe(DEFAULT_ZONE_TYPES.length - 1)
  })

  // getZoneTypeRegistry (used by world_map.ts)
  it('getZoneTypeRegistry returns an empty map for a world with no zone types', async () => {
    await createWorld()
    const registry = await getZoneTypeRegistry(env.RPG_DB, WORLD)
    expect(registry.size).toBe(0)
  })

  it('getZoneTypeRegistry returns a name -> glyph/colorHex map after seeding', async () => {
    await createWorld()
    await seedDefaultZoneTypes(env.RPG_DB, WORLD)
    const registry = await getZoneTypeRegistry(env.RPG_DB, WORLD)
    expect(registry.get('perimeter')?.glyph).toBe('⚡')
    expect(registry.size).toBe(DEFAULT_ZONE_TYPES.length)
  })

  it('getZoneTypeRegistry exposes a null glyph for broadcast (deliberately unrendered)', async () => {
    await createWorld()
    await seedDefaultZoneTypes(env.RPG_DB, WORLD)
    const registry = await getZoneTypeRegistry(env.RPG_DB, WORLD)
    expect(registry.get('broadcast')?.glyph).toBeNull()
  })
})
