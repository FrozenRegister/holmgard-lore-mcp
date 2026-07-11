// Direct handler tests for biome-manage (#274)
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handleBiomeManage, DEFAULT_BIOMES, seedDefaultBiomes, getBiomeRegistry } from '../rpg/handlers/biome-manage'

describe('handleBiomeManage', () => {
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
    const r = await handleBiomeManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  // register
  it('register requires worldId and name', async () => {
    const r = await handleBiomeManage(db(), { action: 'register' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('register rejects invalid name pattern', async () => {
    await createWorld()
    const r = await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'Bad-Name' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('lowercase')
  })

  it('register returns not found for unknown world', async () => {
    const r = await handleBiomeManage(db(), { action: 'register', worldId: 'no-world', name: 'bog' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('register rejects a glyph that is not exactly 1 character', async () => {
    await createWorld()
    const r = await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog', glyph: 'xx' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('1 character')
  })

  it('register rejects an invalid colorHex', async () => {
    await createWorld()
    const r = await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog', colorHex: 'not-a-color' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('hex color')
  })

  it('register rejects a negative movementCost (Zod schema-level .min(0))', async () => {
    await createWorld()
    const r = await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog', movementCost: -1 })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('register creates a biome with defaults applied', async () => {
    await createWorld()
    const r = await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.glyph).toBe('?')
    expect(body.category).toBe('terrain')
    expect(body.colorHex).toBe('#888888')
    expect(body.movementCost).toBe(1.0)
    expect(body.biomeId).toBeTruthy()
  })

  it('register creates a biome with explicit fields', async () => {
    await createWorld()
    const r = await handleBiomeManage(db(), {
      action: 'register', worldId: WORLD, name: 'limestone_karst', glyph: 'K',
      category: 'terrain', colorHex: '#AABBCC', movementCost: 2.5, description: 'Jagged karst formations',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.glyph).toBe('K')
    expect(body.colorHex).toBe('#AABBCC')
    expect(body.movementCost).toBe(2.5)
  })

  it('register rejects a duplicate name for the same world', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog' })
    const r = await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('already exists')
  })

  // list
  it('list requires worldId', async () => {
    const r = await handleBiomeManage(db(), { action: 'list' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('list returns empty for a world with no biomes', async () => {
    await createWorld()
    const r = await handleBiomeManage(db(), { action: 'list', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBe(0)
    expect(body.biomes).toEqual([])
  })

  it('list returns registered biomes ordered by name', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog' })
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'aurora_field' })
    const r = await handleBiomeManage(db(), { action: 'list', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBe(2)
    expect(body.biomes[0].name).toBe('aurora_field')
  })

  // get
  it('get requires id/biomeId or worldId+name', async () => {
    const r = await handleBiomeManage(db(), { action: 'get' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get returns not found for an unknown id', async () => {
    const r = await handleBiomeManage(db(), { action: 'get', id: 'no-such-biome' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get fetches by id', async () => {
    await createWorld()
    const created = JSON.parse((await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog' })).content[0].text)
    const r = await handleBiomeManage(db(), { action: 'get', id: created.biomeId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.biome.name).toBe('bog')
  })

  it('get fetches by worldId + name', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog' })
    const r = await handleBiomeManage(db(), { action: 'get', worldId: WORLD, name: 'bog' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.biome.name).toBe('bog')
  })

  // update
  it('update requires id or biomeId', async () => {
    const r = await handleBiomeManage(db(), { action: 'update' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update returns not found for an unknown id', async () => {
    const r = await handleBiomeManage(db(), { action: 'update', id: 'no-such-biome', glyph: 'X' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update rejects an invalid glyph', async () => {
    await createWorld()
    const created = JSON.parse((await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog' })).content[0].text)
    const r = await handleBiomeManage(db(), { action: 'update', id: created.biomeId, glyph: 'xx' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update rejects an invalid colorHex', async () => {
    await createWorld()
    const created = JSON.parse((await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog' })).content[0].text)
    const r = await handleBiomeManage(db(), { action: 'update', id: created.biomeId, colorHex: 'nope' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update rejects a negative movementCost (Zod schema-level .min(0))', async () => {
    await createWorld()
    const created = JSON.parse((await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog' })).content[0].text)
    const r = await handleBiomeManage(db(), { action: 'update', id: created.biomeId, movementCost: -5 })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update applies all fields', async () => {
    await createWorld()
    const created = JSON.parse((await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog' })).content[0].text)
    const r = await handleBiomeManage(db(), {
      action: 'update', id: created.biomeId, glyph: 'B', category: 'hazard',
      colorHex: '#112233', movementCost: 4, description: 'Sucking mud',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    const fetched = JSON.parse((await handleBiomeManage(db(), { action: 'get', id: created.biomeId })).content[0].text)
    expect(fetched.biome.glyph).toBe('B')
    expect(fetched.biome.category).toBe('hazard')
    expect(fetched.biome.color_hex).toBe('#112233')
    expect(fetched.biome.movement_cost).toBe(4)
    expect(fetched.biome.description).toBe('Sucking mud')
  })

  // delete
  it('delete requires id or biomeId', async () => {
    const r = await handleBiomeManage(db(), { action: 'delete' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('delete returns not found for an unknown id', async () => {
    const r = await handleBiomeManage(db(), { action: 'delete', id: 'no-such-biome' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('delete removes an unreferenced biome', async () => {
    await createWorld()
    const created = JSON.parse((await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog' })).content[0].text)
    const r = await handleBiomeManage(db(), { action: 'delete', id: created.biomeId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    const fetched = JSON.parse((await handleBiomeManage(db(), { action: 'get', id: created.biomeId })).content[0].text)
    expect(fetched.error).toBe(true)
  })

  it('delete rejects removal of a biome referenced by an existing tile', async () => {
    await createWorld()
    const created = JSON.parse((await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog' })).content[0].text)
    await env.RPG_DB.prepare('INSERT INTO tiles (id, world_id, x, y, biome, elevation, moisture, temperature) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), WORLD, 1, 1, 'bog', 0, 50, 15).run()
    const r = await handleBiomeManage(db(), { action: 'delete', id: created.biomeId })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('referenced by existing tiles')
  })

  // validate
  it('validate requires worldId and name', async () => {
    const r = await handleBiomeManage(db(), { action: 'validate' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('validate returns valid: true for an existing biome', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog' })
    const r = await handleBiomeManage(db(), { action: 'validate', worldId: WORLD, name: 'bog' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.valid).toBe(true)
  })

  it('validate returns valid: false with didYouMean suggestions for a near-miss', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog' })
    const r = await handleBiomeManage(db(), { action: 'validate', worldId: WORLD, name: 'boog' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.valid).toBe(false)
    expect(body.didYouMean).toContain('bog')
  })

  it('validate returns empty didYouMean when nothing is close', async () => {
    await createWorld()
    const r = await handleBiomeManage(db(), { action: 'validate', worldId: WORLD, name: 'zzz' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.valid).toBe(false)
    expect(body.didYouMean).toEqual([])
  })

  // seed_defaults
  it('seed_defaults requires worldId', async () => {
    const r = await handleBiomeManage(db(), { action: 'seed_defaults' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('seed_defaults returns not found for an unknown world', async () => {
    const r = await handleBiomeManage(db(), { action: 'seed_defaults', worldId: 'no-world' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('seed_defaults seeds all defaults for a fresh world', async () => {
    await createWorld()
    const r = await handleBiomeManage(db(), { action: 'seed_defaults', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.seeded).toBe(DEFAULT_BIOMES.length)
    expect(body.totalDefaults).toBe(DEFAULT_BIOMES.length)
  })

  it('seed_defaults is idempotent — re-seeding inserts nothing new', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'seed_defaults', worldId: WORLD })
    const r = await handleBiomeManage(db(), { action: 'seed_defaults', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.seeded).toBe(0)
  })

  it('seed_defaults only seeds missing defaults when some already exist', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'grass', glyph: '.' })
    const r = await handleBiomeManage(db(), { action: 'seed_defaults', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.seeded).toBe(DEFAULT_BIOMES.length - 1)
  })

  // getBiomeRegistry (used by world_map.ts)
  it('getBiomeRegistry returns an empty map for a world with no biomes', async () => {
    await createWorld()
    const registry = await getBiomeRegistry(env.RPG_DB, WORLD)
    expect(registry.size).toBe(0)
  })

  it('getBiomeRegistry returns a name -> glyph map after seeding', async () => {
    await createWorld()
    await seedDefaultBiomes(env.RPG_DB, WORLD)
    const registry = await getBiomeRegistry(env.RPG_DB, WORLD)
    expect(registry.get('forest')?.glyph).toBe('T')
    expect(registry.size).toBe(DEFAULT_BIOMES.length)
  })

  it('getBiomeRegistry also exposes colorHex and movementCost (#277)', async () => {
    await createWorld()
    await seedDefaultBiomes(env.RPG_DB, WORLD)
    const registry = await getBiomeRegistry(env.RPG_DB, WORLD)
    const forest = registry.get('forest')
    expect(forest?.colorHex).toBe('#1A472A')
    expect(forest?.movementCost).toBe(1.5)
  })
})
