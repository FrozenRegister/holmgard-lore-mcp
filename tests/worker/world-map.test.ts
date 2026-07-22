// Direct handler tests for world-map (not registered in rpgToolRegistry)
import { describe } from './support/helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'
import { handleWorldMap } from '@/rpg/handlers/world-map'
import { handleBiomeManage } from '@/rpg/handlers/biome-manage'
import { handleZoneTypeManage } from '@/rpg/handlers/zone-type-manage'
import { handleWaypointManage } from '@/rpg/handlers/waypoint-manage'

describe('handleWorldMap', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)
  const WORLD = 'world-1'

  async function createWorld() {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare('INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(WORLD, 'Test World', 'abc123', 100, 100, now, now).run()
  }

  async function seedZoneTypes() {
    await handleZoneTypeManage(db(), { action: 'seed_defaults', worldId: WORLD })
  }

  it('returns guiding error for unknown action', async () => {
    const r = await handleWorldMap(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  it('overview requires worldId', async () => {
    const r = await handleWorldMap(db(), { action: 'overview' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('overview returns not found for unknown world', async () => {
    const r = await handleWorldMap(db(), { action: 'overview', worldId: 'no-world' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('overview returns world summary', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), { action: 'overview', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.world.name).toBe('Test World')
    expect(body.summary).toBeDefined()
  })

  it('region requires regionId', async () => {
    const r = await handleWorldMap(db(), { action: 'region' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('region returns not found for unknown region', async () => {
    const r = await handleWorldMap(db(), { action: 'region', regionId: 'no-region' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('hexes requires worldId, q, and r', async () => {
    const r = await handleWorldMap(db(), { action: 'hexes', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('hexes returns empty results for no hexes', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), { action: 'hexes', worldId: WORLD, q: 0, r: 0, width: 5, height: 5 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hexes).toBeDefined()
  })

  it('patch requires worldId and hexes array', async () => {
    const r = await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [] })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('patch upserts hexes', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'patch', worldId: WORLD,
      hexes: [{ q: 5, r: 5, biome: 'forest', elevation: 100, moisture: 60, temperature: 10 }]
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hexesUpdated).toBe(1)
  })

  it('patch with multiple hexes', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'patch', worldId: WORLD,
      hexes: [{ q: 1, r: 1, biome: 'grass' }, { q: 2, r: 2, biome: 'water' }]
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hexesUpdated).toBe(2)
  })

  // ── waterDepth (#431) ────────────────────────────────────────────────

  it('patch defaults waterDepth to null when omitted', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 20, r: 20, biome: 'grass' }] })
    const row = await env.RPG_DB.prepare('SELECT water_depth FROM hexes WHERE world_id = ? AND q = ? AND r = ?').bind(WORLD, 20, 20).first() as any
    expect(row.water_depth).toBeNull()
  })

  it('patch stores an explicit waterDepth', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 21, r: 21, biome: 'grass', waterDepth: 0.9 }] })
    const row = await env.RPG_DB.prepare('SELECT water_depth FROM hexes WHERE world_id = ? AND q = ? AND r = ?').bind(WORLD, 21, 21).first() as any
    expect(row.water_depth).toBe(0.9)
  })

  it('patch can update waterDepth back to null on re-patch', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 22, r: 22, biome: 'grass', waterDepth: 1.5 }] })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 22, r: 22, biome: 'grass' }] })
    const row = await env.RPG_DB.prepare('SELECT water_depth FROM hexes WHERE world_id = ? AND q = ? AND r = ?').bind(WORLD, 22, 22).first() as any
    expect(row.water_depth).toBeNull()
  })

  it('preview requires worldId, q, and r', async () => {
    const r = await handleWorldMap(db(), { action: 'preview', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('preview returns ascii art', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 0, r: 0, biome: 'grass' }, { q: 1, r: 0, biome: 'forest' }] })
    const r = await handleWorldMap(db(), { action: 'preview', worldId: WORLD, q: 0, r: 0, width: 3, height: 3 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.ascii).toBeTruthy()
  })

  it('preview renders "?" for a world with zero registered biomes (no hardcoded fallback, #320)', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 0, r: 0, biome: 'forest' }] })
    const r = await handleWorldMap(db(), { action: 'preview', worldId: WORLD, q: 0, r: 0, width: 1, height: 1 })
    const body = JSON.parse(r.content[0].text)
    expect(body.ascii).toBe('?')
  })

  it('preview uses the registered glyph for a custom biome (#274)', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'limestone_karst', glyph: 'K' })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 0, r: 0, biome: 'limestone_karst' }] })
    const r = await handleWorldMap(db(), { action: 'preview', worldId: WORLD, q: 0, r: 0, width: 1, height: 1 })
    const body = JSON.parse(r.content[0].text)
    expect(body.ascii).toBe('K')
  })

  it('preview renders "?" for a cell with no hex at all, regardless of registry state', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'limestone_karst', glyph: 'K' })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 0, r: 0, biome: 'limestone_karst' }] })
    // A cell with no hex at all should render as '?' regardless of registry state
    const r = await handleWorldMap(db(), { action: 'preview', worldId: WORLD, q: 5, r: 5, width: 1, height: 1 })
    const body = JSON.parse(r.content[0].text)
    expect(body.ascii).toBe('?')
  })

  it('patch skips biome validation for a world with no registered biomes (backward compatible)', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'patch', worldId: WORLD,
      hexes: [{ q: 0, r: 0, biome: 'totally_made_up' }]
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hexesUpdated).toBe(1)
  })

  it('patch rejects an unregistered biome once the world has a biome registry (#274)', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'limestone_karst', glyph: 'K' })
    const r = await handleWorldMap(db(), {
      action: 'patch', worldId: WORLD,
      hexes: [{ q: 0, r: 0, biome: 'not_a_real_biome' }]
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('not_a_real_biome')
    expect(body.message).toContain('limestone_karst')
  })

  it('patch accepts a registered biome once the world has a biome registry', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'limestone_karst', glyph: 'K' })
    const r = await handleWorldMap(db(), {
      action: 'patch', worldId: WORLD,
      hexes: [{ q: 0, r: 0, biome: 'limestone_karst' }]
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hexesUpdated).toBe(1)
  })

  it('batch requires worldId and hexes array', async () => {
    const r = await handleWorldMap(db(), { action: 'batch', worldId: WORLD, hexes: [] })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('batch rejects payloads over the 1000-hex ceiling', async () => {
    await createWorld()
    const hexes = Array.from({ length: 1001 }, (_, i) => ({ q: i, r: 0, biome: 'grass' }))
    const r = await handleWorldMap(db(), { action: 'batch', worldId: WORLD, hexes })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('1000')
  })

  it('batch inserts new hexes and reports duration', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'batch', worldId: WORLD,
      hexes: [{ q: 0, r: 0, biome: 'grass' }, { q: 1, r: 0, biome: 'water' }, { q: 2, r: 0, biome: 'forest' }],
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hexesInserted).toBe(3)
    expect(body.hexesUpdated).toBe(0)
    expect(body.errors).toEqual([])
    expect(typeof body.duration_ms).toBe('number')
  })

  it('batch stores explicit waterDepth per hex (#431)', async () => {
    await createWorld()
    await handleWorldMap(db(), {
      action: 'batch', worldId: WORLD,
      hexes: [{ q: 30, r: 30, biome: 'grass', waterDepth: 0.4 }, { q: 31, r: 30, biome: 'grass' }],
    })
    const rows = await env.RPG_DB.prepare('SELECT q, water_depth FROM hexes WHERE world_id = ? AND r = 30 ORDER BY q').bind(WORLD).all() as any
    expect(rows.results[0].water_depth).toBe(0.4)
    expect(rows.results[1].water_depth).toBeNull()
  })

  it('batch reports updates separately from inserts on a mixed payload', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 0, r: 0, biome: 'grass' }] })
    const r = await handleWorldMap(db(), {
      action: 'batch', worldId: WORLD,
      hexes: [{ q: 0, r: 0, biome: 'water' }, { q: 1, r: 0, biome: 'forest' }],
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hexesInserted).toBe(1)
    expect(body.hexesUpdated).toBe(1)
    const fetched = JSON.parse((await handleWorldMap(db(), { action: 'hexes', worldId: WORLD, q: 0, r: 0, width: 1, height: 1 })).content[0].text)
    expect(fetched.hexes[0].biome).toBe('water')
  })

  it('batch skips biome validation for a world with no registered biomes (backward compatible)', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'batch', worldId: WORLD,
      hexes: [{ q: 0, r: 0, biome: 'totally_made_up' }],
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hexesInserted).toBe(1)
    expect(body.errors).toEqual([])
  })

  it('batch flags unknown biomes as per-hex errors but still writes valid hexes once a registry exists (#274)', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'limestone_karst', glyph: 'K' })
    const r = await handleWorldMap(db(), {
      action: 'batch', worldId: WORLD,
      hexes: [{ q: 0, r: 0, biome: 'limestone_karst' }, { q: 1, r: 0, biome: 'not_a_real_biome' }],
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hexesInserted).toBe(1)
    expect(body.errors).toEqual([{ index: 1, q: 1, r: 0, biome: 'not_a_real_biome', error: 'Unknown biome' }])
    const fetched = JSON.parse((await handleWorldMap(db(), { action: 'hexes', worldId: WORLD, q: 1, r: 0, width: 1, height: 1 })).content[0].text)
    expect(fetched.hexes).toEqual([])
  })

  it('batch skips validation entirely when validateBiomes is false, even with a registry present', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'limestone_karst', glyph: 'K' })
    const r = await handleWorldMap(db(), {
      action: 'batch', worldId: WORLD, validateBiomes: false,
      hexes: [{ q: 0, r: 0, biome: 'not_a_real_biome' }],
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hexesInserted).toBe(1)
    expect(body.errors).toEqual([])
  })

  it('batch chunks writes over 100 hexes into multiple db.batch() calls', async () => {
    await createWorld()
    const hexes = Array.from({ length: 250 }, (_, i) => ({ q: i, r: 0, biome: 'grass' }))
    const r = await handleWorldMap(db(), { action: 'batch', worldId: WORLD, hexes })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hexesInserted).toBe(250)
  })

  it('batch returns an error if the D1 write fails', async () => {
    await createWorld()
    const failingDb = {
      RPG_DB: {
        prepare: (env.RPG_DB as any).prepare.bind(env.RPG_DB),
        batch: async () => { throw new Error('simulated D1 failure') },
      },
    } as any
    const r = await handleWorldMap(failingDb, {
      action: 'batch', worldId: WORLD,
      hexes: [{ q: 0, r: 0, biome: 'grass' }],
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('simulated D1 failure')
  })

  it('find_poi requires worldId', async () => {
    const r = await handleWorldMap(db(), { action: 'find_poi' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('find_poi returns landmarks', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), { action: 'find_poi', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.landmarks).toBeDefined()
  })

  it('find_poi filters by type and query', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), { action: 'find_poi', worldId: WORLD, structureType: 'tower', query: 'Mage' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('suggest_poi requires worldId, query, q, r', async () => {
    const r = await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Tower' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('suggest_poi creates a new landmark', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Dark Tower', q: 10, r: 20, structureType: 'tower' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.name).toBe('Dark Tower')
    expect(body.landmarkId).toBeTruthy()
    expect(body.hasZone).toBe(false)
  })

  // ── zones (#276) ──────────────────────────────────────────────────────────

  it('suggest_poi rejects a polygon with fewer than 3 points', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Bad Shape', q: 0, r: 0,
      polygon: [[0, 0], [1, 1]],
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('polygon')
  })

  it('suggest_poi creates a circle zone', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Ratite Nesting Ground', q: 50, r: 50,
      radius: 8, zoneType: 'territory',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hasZone).toBe(true)
  })

  it('suggest_poi creates a polygon zone', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', q: 36, r: 73,
      polygon: [[34, 71], [38, 71], [38, 75], [34, 75]], zoneType: 'territory', predatorRef: 'giant_panther',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hasZone).toBe(true)
  })

  it('suggest_poi creates a ring zone (perimeter)', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Laser-Pylon Perimeter', q: 50, r: 50,
      ringInner: 18, ringOuter: 22, ringPoints: 240, zoneType: 'perimeter',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hasZone).toBe(true)
  })

  it('suggest_poi with zoneType/predatorRef but no shape stores metadata without a queryable zone', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Vague Threat', q: 1, r: 1, zoneType: 'hazard',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hasZone).toBe(false)
    const zones = JSON.parse((await handleWorldMap(db(), { action: 'list_zones', worldId: WORLD })).content[0].text)
    expect(zones.count).toBe(0)
  })

  it('update_poi requires structureId', async () => {
    const r = await handleWorldMap(db(), { action: 'update_poi', name: 'New Name' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update_poi returns not found for an unknown structureId', async () => {
    const r = await handleWorldMap(db(), { action: 'update_poi', structureId: 'no-such-structure', name: 'X' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update_poi rejects a polygon with fewer than 3 points', async () => {
    await createWorld()
    const created = JSON.parse((await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Zone', q: 0, r: 0 })).content[0].text)
    const r = await handleWorldMap(db(), { action: 'update_poi', structureId: created.landmarkId, polygon: [[0, 0]] })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update_poi patches name/type/position without touching zone metadata', async () => {
    await createWorld()
    const created = JSON.parse((await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Old Name', q: 0, r: 0, radius: 5, zoneType: 'territory',
    })).content[0].text)
    const r = await handleWorldMap(db(), { action: 'update_poi', structureId: created.landmarkId, name: 'New Name', q: 10, r: 10 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    const zones = JSON.parse((await handleWorldMap(db(), { action: 'list_zones', worldId: WORLD })).content[0].text)
    expect(zones.count).toBe(1)
    expect(zones.zones[0].zone.circle.radius).toBe(5)
  })

  it('update_poi patches zone_type alone, preserving the existing shape', async () => {
    await createWorld()
    const created = JSON.parse((await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Shifting Zone', q: 0, r: 0, radius: 5, zoneType: 'territory',
    })).content[0].text)
    await handleWorldMap(db(), { action: 'update_poi', structureId: created.landmarkId, zoneType: 'exclusion' })
    const zones = JSON.parse((await handleWorldMap(db(), { action: 'list_zones', worldId: WORLD })).content[0].text)
    expect(zones.zones[0].zoneType).toBe('exclusion')
    expect(zones.zones[0].zone.circle.radius).toBe(5)
  })

  it('update_poi replaces a circle shape with a polygon shape', async () => {
    await createWorld()
    const created = JSON.parse((await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Reshaped Zone', q: 0, r: 0, radius: 5, zoneType: 'territory',
    })).content[0].text)
    await handleWorldMap(db(), { action: 'update_poi', structureId: created.landmarkId, polygon: [[0, 0], [5, 0], [5, 5]] })
    const zones = JSON.parse((await handleWorldMap(db(), { action: 'list_zones', worldId: WORLD })).content[0].text)
    expect(zones.zones[0].zone.type).toBe('polygon')
  })

  it('query_zone requires worldId, q, and r', async () => {
    const r = await handleWorldMap(db(), { action: 'query_zone', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('query_zone returns no zones for a point outside every zone', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', q: 36, r: 73, radius: 4, zoneType: 'territory' })
    const r = await handleWorldMap(db(), { action: 'query_zone', worldId: WORLD, q: 0, r: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.zones).toEqual([])
    expect(body.inPerimeter).toBe(false)
  })

  it('query_zone finds a circle territory containing the point', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', q: 36, r: 73, radius: 4, zoneType: 'territory', predatorRef: 'giant_panther' })
    const r = await handleWorldMap(db(), { action: 'query_zone', worldId: WORLD, q: 37, r: 73 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.zones).toHaveLength(1)
    expect(body.zones[0].name).toBe('Panther Range')
    expect(body.zones[0].zoneType).toBe('territory')
    expect(body.zones[0].distanceToCenter).toBe(1)
  })

  it('query_zone finds a polygon zone containing the point', async () => {
    await createWorld()
    await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Sumpfkarren Depths', q: 42, r: 70,
      polygon: [[40, 68], [44, 68], [44, 72], [40, 72]], zoneType: 'exclusion',
    })
    const r = await handleWorldMap(db(), { action: 'query_zone', worldId: WORLD, q: 41, r: 69 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.zones).toHaveLength(1)
    expect(body.zones[0].zoneType).toBe('exclusion')
  })

  it('query_zone sets inPerimeter true for a point within a ring zone band', async () => {
    await createWorld()
    await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Laser-Pylon Perimeter', q: 50, r: 50,
      ringInner: 18, ringOuter: 22, zoneType: 'perimeter',
    })
    const inside = await handleWorldMap(db(), { action: 'query_zone', worldId: WORLD, q: 70, r: 50 })
    const insideBody = JSON.parse(inside.content[0].text)
    expect(insideBody.inPerimeter).toBe(true)

    const outside = await handleWorldMap(db(), { action: 'query_zone', worldId: WORLD, q: 50, r: 50 })
    const outsideBody = JSON.parse(outside.content[0].text)
    expect(outsideBody.inPerimeter).toBe(false)
  })

  it('query_zone reports multiple overlapping zones', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', q: 36, r: 73, radius: 10, zoneType: 'territory' })
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Broadcast Shadow', q: 36, r: 73, radius: 10, zoneType: 'exclusion' })
    const r = await handleWorldMap(db(), { action: 'query_zone', worldId: WORLD, q: 36, r: 73 })
    const body = JSON.parse(r.content[0].text)
    expect(body.zones).toHaveLength(2)
  })

  // ── zone threat/dominance (#280) ──────────────────────────────────────────

  it('suggest_poi stores threatLevel and dominanceRank on a zone', async () => {
    await createWorld()
    await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', q: 36, r: 73, radius: 10,
      zoneType: 'territory', predatorRef: 'giant_panther', threatLevel: 40, dominanceRank: 5,
    })
    const r = await handleWorldMap(db(), { action: 'query_zone', worldId: WORLD, q: 36, r: 73 })
    const body = JSON.parse(r.content[0].text)
    expect(body.zones[0].threatLevel).toBe(40)
    expect(body.zones[0].dominanceRank).toBe(5)
    expect(body.zones[0].predator).toBe('giant_panther')
  })

  it('query_zone returns null threatLevel/dominanceRank when not set', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Vague Zone', q: 5, r: 5, radius: 2, zoneType: 'territory' })
    const r = await handleWorldMap(db(), { action: 'query_zone', worldId: WORLD, q: 5, r: 5 })
    const body = JSON.parse(r.content[0].text)
    expect(body.zones[0].threatLevel).toBeNull()
    expect(body.zones[0].dominanceRank).toBeNull()
  })

  it('update_poi patches threatLevel/dominanceRank independently of shape and zoneType', async () => {
    await createWorld()
    const created = JSON.parse((await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Leonar Range', q: 20, r: 20, radius: 6, zoneType: 'territory', threatLevel: 20, dominanceRank: 2,
    })).content[0].text)
    await handleWorldMap(db(), { action: 'update_poi', structureId: created.landmarkId, threatLevel: 55 })
    const r = await handleWorldMap(db(), { action: 'query_zone', worldId: WORLD, q: 20, r: 20 })
    const body = JSON.parse(r.content[0].text)
    expect(body.zones[0].threatLevel).toBe(55)
    expect(body.zones[0].dominanceRank).toBe(2)
    expect(body.zones[0].zoneType).toBe('territory')
  })

  it('list_zones includes threatLevel/dominanceRank/predator', async () => {
    await createWorld()
    await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', q: 36, r: 73, radius: 10,
      zoneType: 'territory', predatorRef: 'giant_panther', threatLevel: 40, dominanceRank: 5,
    })
    const r = await handleWorldMap(db(), { action: 'list_zones', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.zones[0].threatLevel).toBe(40)
    expect(body.zones[0].dominanceRank).toBe(5)
    expect(body.zones[0].predator).toBe('giant_panther')
  })

  it('list_zones requires worldId', async () => {
    const r = await handleWorldMap(db(), { action: 'list_zones' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('list_zones returns empty for a world with no zones', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), { action: 'list_zones', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBe(0)
  })

  it('list_zones ignores plain (non-zone) POIs', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Dark Tower', q: 10, r: 20 })
    const r = await handleWorldMap(db(), { action: 'list_zones', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.count).toBe(0)
  })

  it('list_zones filters by zoneType', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', q: 36, r: 73, radius: 4, zoneType: 'territory' })
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Sumpfkarren Depths', q: 42, r: 70, radius: 4, zoneType: 'exclusion' })
    const r = await handleWorldMap(db(), { action: 'list_zones', worldId: WORLD, zoneType: 'exclusion' })
    const body = JSON.parse(r.content[0].text)
    expect(body.count).toBe(1)
    expect(body.zones[0].name).toBe('Sumpfkarren Depths')
  })

  // ── zone-type registry overlay glyphs (#320 follow-up) ──────────────────────

  it('preview overlays a territory zone glyph over the base terrain once zone types are seeded', async () => {
    await createWorld()
    await seedZoneTypes()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 5, r: 5, biome: 'grass' }] })
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', q: 5, r: 5, radius: 2, zoneType: 'territory' })
    const r = await handleWorldMap(db(), { action: 'preview', worldId: WORLD, q: 5, r: 5, width: 1, height: 1 })
    const body = JSON.parse(r.content[0].text)
    expect(body.ascii).toBe('@')
  })

  it('preview overlays a perimeter ring glyph and leaves cells outside the band untouched', async () => {
    await createWorld()
    await seedZoneTypes()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 70, r: 50, biome: 'grass' }, { q: 50, r: 50, biome: 'grass' }] })
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Perimeter', q: 50, r: 50, ringInner: 18, ringOuter: 22, zoneType: 'perimeter' })
    const inBand = await handleWorldMap(db(), { action: 'preview', worldId: WORLD, q: 70, r: 50, width: 1, height: 1 })
    expect(JSON.parse(inBand.content[0].text).ascii).toBe('⚡')
    const outOfBand = await handleWorldMap(db(), { action: 'preview', worldId: WORLD, q: 50, r: 50, width: 1, height: 1 })
    expect(JSON.parse(outOfBand.content[0].text).ascii).not.toBe('⚡')
  })

  it('preview does not overlay a broadcast zone (deliberately unrendered, null glyph)', async () => {
    await createWorld()
    await seedZoneTypes()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 5, r: 5, biome: 'grass' }] })
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Broadcast Shadow', q: 5, r: 5, radius: 2, zoneType: 'broadcast' })
    const r = await handleWorldMap(db(), { action: 'preview', worldId: WORLD, q: 5, r: 5, width: 1, height: 1 })
    expect(JSON.parse(r.content[0].text).ascii).not.toBe('@')
  })

  it('preview renders no zone overlay for a world with zero registered zone types (registry-driven, no hardcoded fallback)', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 5, r: 5, biome: 'grass' }] })
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', q: 5, r: 5, radius: 2, zoneType: 'territory' })
    const r = await handleWorldMap(db(), { action: 'preview', worldId: WORLD, q: 5, r: 5, width: 1, height: 1 })
    const body = JSON.parse(r.content[0].text)
    expect(body.ascii).not.toBe('@')
  })

  it('preview uses a custom registered zone type\'s glyph', async () => {
    await createWorld()
    await handleZoneTypeManage(db(), { action: 'register', worldId: WORLD, name: 'sacred_ground', glyph: 'S' })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 5, r: 5, biome: 'grass' }] })
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Shrine', q: 5, r: 5, radius: 2, zoneType: 'sacred_ground' })
    const r = await handleWorldMap(db(), { action: 'preview', worldId: WORLD, q: 5, r: 5, width: 1, height: 1 })
    const body = JSON.parse(r.content[0].text)
    expect(body.ascii).toBe('S')
  })

  // ── render_svg (#277) ─────────────────────────────────────────────────────

  it('render_svg requires worldId', async () => {
    const r = await handleWorldMap(db(), { action: 'render_svg' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('render_svg returns a well-formed SVG with correct dimensions for an empty world', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 10, renderHeight: 10 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
    expect(body.svg.trim().endsWith('</svg>')).toBe(true)
    expect(body.hexCount).toBe(0)
    expect(body.structureCount).toBe(0)
    expect(body.zoneCount).toBe(0)
  })

  it('render_svg defaults to a 100x100 viewport at (0,0)', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.hexCount).toBe(0)
  })

  it('render_svg uses the registered biome color for a hex', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'limestone_karst', colorHex: '#C8BFB4' })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 0, r: 0, biome: 'limestone_karst' }] })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 1, renderHeight: 1 })
    const body = JSON.parse(r.content[0].text)
    expect(body.hexCount).toBe(1)
    expect(body.svg).toContain('#C8BFB4')
  })

  it('render_svg falls back to a default gray for a world with no registered biomes', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 0, r: 0, biome: 'forest' }] })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 1, renderHeight: 1 })
    const body = JSON.parse(r.content[0].text)
    expect(body.svg).toContain('#888888')
  })

  it('render_svg falls back to a default gray for a biome with no known color', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 0, r: 0, biome: 'totally_unknown_biome' }] })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 1, renderHeight: 1 })
    const body = JSON.parse(r.content[0].text)
    expect(body.svg).toContain('#888888')
  })

  it('render_svg renders a structure marker with an escaped name', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Tower <of> "Doom" & Sons', q: 5, r: 5 })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 10, renderHeight: 10 })
    const body = JSON.parse(r.content[0].text)
    expect(body.structureCount).toBe(1)
    expect(body.svg).toContain('Tower &lt;of&gt; &quot;Doom&quot; &amp; Sons')
    expect(body.svg).not.toContain('<of>')
  })

  it('render_svg omits structure markers when showStructures is false', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Tower', q: 5, r: 5 })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 10, renderHeight: 10, showStructures: false })
    const body = JSON.parse(r.content[0].text)
    expect(body.structureCount).toBe(0)
    expect(body.svg).not.toContain('Tower')
  })

  it('render_svg renders a circle zone overlay and counts it', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', q: 5, r: 5, radius: 3, zoneType: 'territory' })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 10, renderHeight: 10 })
    const body = JSON.parse(r.content[0].text)
    expect(body.zoneCount).toBe(1)
    expect(body.svg).toContain('<circle')
    expect(body.svg).toContain('fill-opacity="0.2"')
  })

  it('render_svg renders a polygon zone overlay', async () => {
    await createWorld()
    await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Sumpfkarren Depths', q: 5, r: 5,
      polygon: [[3, 3], [7, 3], [7, 7], [3, 7]], zoneType: 'exclusion',
    })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 10, renderHeight: 10 })
    const body = JSON.parse(r.content[0].text)
    expect(body.zoneCount).toBe(1)
    expect(body.svg).toContain('<polygon')
  })

  it('render_svg approximates a ring zone as a single dashed circle and skips its redundant center marker', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Perimeter', q: 5, r: 5, ringInner: 2, ringOuter: 4, zoneType: 'perimeter' })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 10, renderHeight: 10 })
    const body = JSON.parse(r.content[0].text)
    expect(body.zoneCount).toBe(1)
    expect(body.structureCount).toBe(0)
    expect(body.svg).toContain('stroke-dasharray="4 4"')
  })

  it('render_svg omits zone overlays when showZones is false (perimeter unaffected)', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', q: 5, r: 5, radius: 3, zoneType: 'territory' })
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Perimeter', q: 5, r: 5, ringInner: 2, ringOuter: 4, zoneType: 'perimeter' })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 10, renderHeight: 10, showZones: false })
    const body = JSON.parse(r.content[0].text)
    expect(body.zoneCount).toBe(1)
  })

  it('render_svg omits the perimeter overlay when showPerimeter is false (territory unaffected)', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', q: 5, r: 5, radius: 3, zoneType: 'territory' })
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Perimeter', q: 5, r: 5, ringInner: 2, ringOuter: 4, zoneType: 'perimeter' })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 10, renderHeight: 10, showPerimeter: false })
    const body = JSON.parse(r.content[0].text)
    expect(body.zoneCount).toBe(1)
  })

  it('render_svg renders highlight markers with custom label and color', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'render_svg', worldId: WORLD, renderWidth: 10, renderHeight: 10,
      highlight: [{ q: 5, r: 5, label: 'Yune', color: '#FF4444' }],
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.svg).toContain('#FF4444')
    expect(body.svg).toContain('Yune')
  })

  it('render_svg renders grid labels when requested', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 20, renderHeight: 20, gridLabels: true })
    const body = JSON.parse(r.content[0].text)
    expect(body.svg).toContain('>0<')
  })

  it('render_svg omits grid labels by default', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 20, renderHeight: 20 })
    const body = JSON.parse(r.content[0].text)
    expect(body.svg).not.toContain('>0<')
  })

  it('render_svg respects a non-default q/r viewport offset', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 50, r: 50, biome: 'grass' }] })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, q: 40, r: 40, renderWidth: 20, renderHeight: 20 })
    const body = JSON.parse(r.content[0].text)
    expect(body.hexCount).toBe(1)
  })

  // ── distance (#430) ────────────────────────────────────────────────

  it('distance requires worldId, from, and to', async () => {
    const r = await handleWorldMap(db(), { action: 'distance', worldId: WORLD, from: { q: 0, r: 0 } })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('distance reports hexDistance and a null km/days on a non-geo-calibrated world', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), { action: 'distance', worldId: WORLD, from: { q: 0, r: 0 }, to: { q: 3, r: 0 } })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hexDistance).toBe(3)
    expect(body.straightLineKm).toBeNull()
    expect(body.estimatedTravelDays).toBeNull()
    expect(body.note).toContain('not geo-calibrated')
  })

  it('distance computes straightLineKm and a terrain-weighted estimatedTravelDays once calibrated', async () => {
    await createWorld()
    await handleWaypointManage(db(), { action: 'calibrate', worldId: WORLD, originLat: 57.6, originLon: 18.3, kmPerHex: 1 })
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'grass_430', movementCost: 1.0 })
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'forest_430', movementCost: 2.0 })
    await handleWorldMap(db(), {
      action: 'patch', worldId: WORLD,
      hexes: [{ q: 1, r: 0, biome: 'grass_430' }, { q: 2, r: 0, biome: 'forest_430' }, { q: 3, r: 0, biome: 'grass_430' }],
    })
    const r = await handleWorldMap(db(), { action: 'distance', worldId: WORLD, from: { q: 0, r: 0 }, to: { q: 3, r: 0 } })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hexDistance).toBe(3)
    expect(body.straightLineKm).toBe(5.2)
    expect(body.terrainBreakdown.grass_430.hexes).toBe(2)
    expect(body.terrainBreakdown.forest_430.hexes).toBe(1)
    expect(body.estimatedTravelDays).toBe(1.39)
    expect(body.note).toBeUndefined()
  })

  it('distance flags an impassable hex on the direct line and returns a null estimatedTravelDays', async () => {
    await createWorld()
    await handleWaypointManage(db(), { action: 'calibrate', worldId: WORLD, originLat: 57.6, originLon: 18.3, kmPerHex: 1 })
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'cliff_430', movementCost: 1.0, modeCosts: { foot: 0 } })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 1, r: 0, biome: 'cliff_430' }] })
    const r = await handleWorldMap(db(), { action: 'distance', worldId: WORLD, from: { q: 0, r: 0 }, to: { q: 2, r: 0 }, mode: 'foot' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.estimatedTravelDays).toBeNull()
    expect(body.warnings.length).toBeGreaterThan(0)
    expect(body.warnings[0]).toContain('cliff_430')
  })

  it('distance respects mode when computing terrain-weighted days', async () => {
    await createWorld()
    await handleWaypointManage(db(), { action: 'calibrate', worldId: WORLD, originLat: 57.6, originLon: 18.3, kmPerHex: 1 })
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'road_430', movementCost: 1.0 })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 1, r: 0, biome: 'road_430' }] })
    const foot = JSON.parse((await handleWorldMap(db(), { action: 'distance', worldId: WORLD, from: { q: 0, r: 0 }, to: { q: 1, r: 0 }, mode: 'foot' })).content[0].text)
    const car = JSON.parse((await handleWorldMap(db(), { action: 'distance', worldId: WORLD, from: { q: 0, r: 0 }, to: { q: 1, r: 0 }, mode: 'car' })).content[0].text)
    expect(car.estimatedTravelDays).toBeLessThan(foot.estimatedTravelDays)
  })

  // ── pathfind (#430) ─────────────────────────────────────────────────

  it('pathfind requires worldId, from, and to', async () => {
    const r = await handleWorldMap(db(), { action: 'pathfind', worldId: WORLD, from: { q: 0, r: 0 } })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('pathfind returns a trivial single-hex path when from equals to', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), { action: 'pathfind', worldId: WORLD, from: { q: 5, r: 5 }, to: { q: 5, r: 5 } })
    const body = JSON.parse(r.content[0].text)
    expect(body.routable).toBe(true)
    expect(body.path).toEqual([{ q: 5, r: 5, biome: null }])
    expect(body.totalHexSteps).toBe(0)
  })

  it('pathfind finds the direct route on an open, unregistered-biome world', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), { action: 'pathfind', worldId: WORLD, from: { q: 0, r: 0 }, to: { q: 2, r: 0 } })
    const body = JSON.parse(r.content[0].text)
    expect(body.routable).toBe(true)
    expect(body.totalHexSteps).toBe(2)
    expect(body.totalKm).toBeNull()
    expect(body.note).toContain('not geo-calibrated')
  })

  it('pathfind computes totalKm/totalDays once calibrated, matching the direct line for an open path', async () => {
    await createWorld()
    await handleWaypointManage(db(), { action: 'calibrate', worldId: WORLD, originLat: 57.6, originLon: 18.3, kmPerHex: 1 })
    const r = await handleWorldMap(db(), { action: 'pathfind', worldId: WORLD, from: { q: 0, r: 0 }, to: { q: 2, r: 0 } })
    const body = JSON.parse(r.content[0].text)
    expect(body.routable).toBe(true)
    expect(body.totalKm).toBe(3.46)
    expect(body.totalDays).toBe(0.69)
  })

  it('pathfind routes around a single impassable hex rather than failing', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'wall_430', movementCost: 1.0, modeCosts: { foot: 0 } })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 1, r: 0, biome: 'wall_430' }] })
    const r = await handleWorldMap(db(), { action: 'pathfind', worldId: WORLD, from: { q: 0, r: 0 }, to: { q: 2, r: 0 }, mode: 'foot' })
    const body = JSON.parse(r.content[0].text)
    expect(body.routable).toBe(true)
    expect(body.path.some((p: { q: number; r: number }) => p.q === 1 && p.r === 0)).toBe(false)
  })

  it('pathfind avoids a specific biome name when requested', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'swamp_430', movementCost: 1.0 })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 1, r: 0, biome: 'swamp_430' }] })
    const r = await handleWorldMap(db(), { action: 'pathfind', worldId: WORLD, from: { q: 0, r: 0 }, to: { q: 2, r: 0 }, avoid: ['swamp_430'] })
    const body = JSON.parse(r.content[0].text)
    expect(body.routable).toBe(true)
    expect(body.path.every((p: { biome: string | null }) => p.biome !== 'swamp_430')).toBe(true)
  })

  it('pathfind avoids a zone_type when requested and flags it as a warning otherwise', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Panther Territory', q: 1, r: 0, radius: 0, zoneType: 'predator_zone' })

    const unavoided = JSON.parse((await handleWorldMap(db(), { action: 'pathfind', worldId: WORLD, from: { q: 0, r: 0 }, to: { q: 2, r: 0 } })).content[0].text)
    expect(unavoided.routable).toBe(true)
    expect(unavoided.warnings.some((w: string) => w.includes('predator_zone'))).toBe(true)

    const avoided = JSON.parse((await handleWorldMap(db(), { action: 'pathfind', worldId: WORLD, from: { q: 0, r: 0 }, to: { q: 2, r: 0 }, avoid: ['predator_zone'] })).content[0].text)
    expect(avoided.routable).toBe(true)
    expect(avoided.path.some((p: { q: number; r: number }) => p.q === 1 && p.r === 0)).toBe(false)
  })
})
