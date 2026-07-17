// Direct handler tests for biome-manage (#274)
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handleBiomeManage, DEFAULT_BIOMES, seedDefaultBiomes, getBiomeRegistry, effectiveMovementCost } from '../rpg/handlers/biome-manage'

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
    expect(body.baseThreat).toBe(0)
    expect(body.biomeId).toBeTruthy()
  })

  it('register creates a biome with explicit fields', async () => {
    await createWorld()
    const r = await handleBiomeManage(db(), {
      action: 'register', worldId: WORLD, name: 'limestone_karst', glyph: 'K',
      category: 'terrain', colorHex: '#AABBCC', movementCost: 2.5, baseThreat: 15, description: 'Jagged karst formations',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.glyph).toBe('K')
    expect(body.colorHex).toBe('#AABBCC')
    expect(body.movementCost).toBe(2.5)
    expect(body.baseThreat).toBe(15)
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
      colorHex: '#112233', movementCost: 4, baseThreat: 25, description: 'Sucking mud',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    const fetched = JSON.parse((await handleBiomeManage(db(), { action: 'get', id: created.biomeId })).content[0].text)
    expect(fetched.biome.glyph).toBe('B')
    expect(fetched.biome.category).toBe('hazard')
    expect(fetched.biome.color_hex).toBe('#112233')
    expect(fetched.biome.movement_cost).toBe(4)
    expect(fetched.biome.base_threat).toBe(25)
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

  it('delete rejects removal of a biome referenced by an existing hex', async () => {
    await createWorld()
    const created = JSON.parse((await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'bog' })).content[0].text)
    await env.RPG_DB.prepare('INSERT INTO hexes (q, r, map_id, world_id, biome, elevation, moisture, temperature) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(1, 1, 'main', WORLD, 'bog', 0, 50, 15).run()
    const r = await handleBiomeManage(db(), { action: 'delete', id: created.biomeId })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('referenced by existing hexes')
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

  it('getBiomeRegistry also exposes baseThreat, defaulting to 0 (#280)', async () => {
    await createWorld()
    await seedDefaultBiomes(env.RPG_DB, WORLD)
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'limestone_karst', baseThreat: 20 })
    const registry = await getBiomeRegistry(env.RPG_DB, WORLD)
    expect(registry.get('forest')?.baseThreat).toBe(0)
    expect(registry.get('limestone_karst')?.baseThreat).toBe(20)
  })

  // ── per-mode movement cost overrides (#429) ────────────────────────────

  it('register defaults modeCosts to an empty object', async () => {
    await createWorld()
    const r = await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'grass_429' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.modeCosts).toEqual({})
    const registry = await getBiomeRegistry(env.RPG_DB, WORLD)
    expect(registry.get('grass_429')?.modeCosts).toEqual({})
  })

  it('register stores explicit modeCosts', async () => {
    await createWorld()
    const r = await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'river_429', movementCost: 2.0, modeCosts: { carriage: 0, car: 0, horse: 3.0 } })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.modeCosts).toEqual({ carriage: 0, car: 0, horse: 3.0 })
    const registry = await getBiomeRegistry(env.RPG_DB, WORLD)
    expect(registry.get('river_429')?.modeCosts).toEqual({ carriage: 0, car: 0, horse: 3.0 })
  })

  it('update shallow-merges modeCosts without clobbering pre-existing modes', async () => {
    await createWorld()
    const created = JSON.parse((await handleBiomeManage(db(), {
      action: 'register', worldId: WORLD, name: 'river_429b', modeCosts: { carriage: 0, horse: 3.0 },
    })).content[0].text)
    const r = await handleBiomeManage(db(), { action: 'update', id: created.biomeId, modeCosts: { car: 0 } })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.modeCosts).toEqual({ carriage: 0, horse: 3.0, car: 0 })
    const fetched = JSON.parse((await handleBiomeManage(db(), { action: 'get', id: created.biomeId })).content[0].text)
    expect(JSON.parse(fetched.biome.mode_costs)).toEqual({ carriage: 0, horse: 3.0, car: 0 })
  })

  it('update can overwrite a specific mode while leaving others intact', async () => {
    await createWorld()
    const created = JSON.parse((await handleBiomeManage(db(), {
      action: 'register', worldId: WORLD, name: 'heath_429', modeCosts: { horse: 2.0 },
    })).content[0].text)
    await handleBiomeManage(db(), { action: 'update', id: created.biomeId, modeCosts: { horse: 5.0 } })
    const registry = await getBiomeRegistry(env.RPG_DB, WORLD)
    expect(registry.get('heath_429')?.modeCosts).toEqual({ horse: 5.0 })
  })

  it('effectiveMovementCost falls back to movementCost when the mode has no override', () => {
    const entry = { movementCost: 1.5, modeCosts: { horse: 3.0 } }
    expect(effectiveMovementCost(entry, 'foot')).toBe(1.5)
    expect(effectiveMovementCost(entry, 'horse')).toBe(3.0)
  })

  it('effectiveMovementCost defaults to 1.0 for an undefined biome entry (unregistered biome)', () => {
    expect(effectiveMovementCost(undefined, 'foot')).toBe(1.0)
  })

  it('getBiomeRegistry tolerates a malformed mode_costs value by treating it as empty', async () => {
    await createWorld()
    const now = new Date().toISOString()
    await env.RPG_DB.prepare('INSERT INTO biomes (id, world_id, name, glyph, category, color_hex, movement_cost, base_threat, mode_costs, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind('biome-malformed', WORLD, 'malformed_429', '?', 'terrain', '#888888', 1.0, 0, 'not-json', now, now).run()
    const registry = await getBiomeRegistry(env.RPG_DB, WORLD)
    expect(registry.get('malformed_429')?.modeCosts).toEqual({})
  })
})
