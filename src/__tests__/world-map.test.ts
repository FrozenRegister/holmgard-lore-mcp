// Direct handler tests for world-map (not registered in rpgToolRegistry)
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handleWorldMap } from '../rpg/handlers/world-map'
import { handleBiomeManage } from '../rpg/handlers/biome-manage'

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

  it('tiles requires worldId, x, and y', async () => {
    const r = await handleWorldMap(db(), { action: 'tiles', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('tiles returns empty results for no tiles', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), { action: 'tiles', worldId: WORLD, x: 0, y: 0, width: 5, height: 5 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.tiles).toBeDefined()
  })

  it('patch requires worldId and tiles array', async () => {
    const r = await handleWorldMap(db(), { action: 'patch', worldId: WORLD, tiles: [] })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('patch upserts tiles', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'patch', worldId: WORLD,
      tiles: [{ x: 5, y: 5, biome: 'forest', elevation: 100, moisture: 60, temperature: 10 }]
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.tilesUpdated).toBe(1)
  })

  it('patch with multiple tiles', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'patch', worldId: WORLD,
      tiles: [{ x: 1, y: 1, biome: 'grass' }, { x: 2, y: 2, biome: 'water' }]
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.tilesUpdated).toBe(2)
  })

  it('preview requires worldId, x, and y', async () => {
    const r = await handleWorldMap(db(), { action: 'preview', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('preview returns ascii art', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, tiles: [{ x: 0, y: 0, biome: 'grass' }, { x: 1, y: 0, biome: 'forest' }] })
    const r = await handleWorldMap(db(), { action: 'preview', worldId: WORLD, x: 0, y: 0, width: 3, height: 3 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.ascii).toBeTruthy()
  })

  it('preview falls back to legacy glyphs for a world with no registered biomes', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, tiles: [{ x: 0, y: 0, biome: 'forest' }] })
    const r = await handleWorldMap(db(), { action: 'preview', worldId: WORLD, x: 0, y: 0, width: 1, height: 1 })
    const body = JSON.parse(r.content[0].text)
    expect(body.ascii).toBe('T')
  })

  it('preview uses the registered glyph for a custom biome (#274)', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'limestone_karst', glyph: 'K' })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, tiles: [{ x: 0, y: 0, biome: 'limestone_karst' }] })
    const r = await handleWorldMap(db(), { action: 'preview', worldId: WORLD, x: 0, y: 0, width: 1, height: 1 })
    const body = JSON.parse(r.content[0].text)
    expect(body.ascii).toBe('K')
  })

  it('preview falls back to "?" for a biome unknown to both registry and legacy map', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'limestone_karst', glyph: 'K' })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, tiles: [{ x: 0, y: 0, biome: 'limestone_karst' }] })
    // A cell with no tile at all should render as '?' regardless of registry state
    const r = await handleWorldMap(db(), { action: 'preview', worldId: WORLD, x: 5, y: 5, width: 1, height: 1 })
    const body = JSON.parse(r.content[0].text)
    expect(body.ascii).toBe('?')
  })

  it('patch skips biome validation for a world with no registered biomes (backward compatible)', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'patch', worldId: WORLD,
      tiles: [{ x: 0, y: 0, biome: 'totally_made_up' }]
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.tilesUpdated).toBe(1)
  })

  it('patch rejects an unregistered biome once the world has a biome registry (#274)', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'limestone_karst', glyph: 'K' })
    const r = await handleWorldMap(db(), {
      action: 'patch', worldId: WORLD,
      tiles: [{ x: 0, y: 0, biome: 'not_a_real_biome' }]
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
      tiles: [{ x: 0, y: 0, biome: 'limestone_karst' }]
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.tilesUpdated).toBe(1)
  })

  it('batch requires worldId and tiles array', async () => {
    const r = await handleWorldMap(db(), { action: 'batch', worldId: WORLD, tiles: [] })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('batch rejects payloads over the 1000-tile ceiling', async () => {
    await createWorld()
    const tiles = Array.from({ length: 1001 }, (_, i) => ({ x: i, y: 0, biome: 'grass' }))
    const r = await handleWorldMap(db(), { action: 'batch', worldId: WORLD, tiles })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('1000')
  })

  it('batch inserts new tiles and reports duration', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'batch', worldId: WORLD,
      tiles: [{ x: 0, y: 0, biome: 'grass' }, { x: 1, y: 0, biome: 'water' }, { x: 2, y: 0, biome: 'forest' }],
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.tilesInserted).toBe(3)
    expect(body.tilesUpdated).toBe(0)
    expect(body.errors).toEqual([])
    expect(typeof body.duration_ms).toBe('number')
  })

  it('batch reports updates separately from inserts on a mixed payload', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, tiles: [{ x: 0, y: 0, biome: 'grass' }] })
    const r = await handleWorldMap(db(), {
      action: 'batch', worldId: WORLD,
      tiles: [{ x: 0, y: 0, biome: 'water' }, { x: 1, y: 0, biome: 'forest' }],
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.tilesInserted).toBe(1)
    expect(body.tilesUpdated).toBe(1)
    const fetched = JSON.parse((await handleWorldMap(db(), { action: 'tiles', worldId: WORLD, x: 0, y: 0, width: 1, height: 1 })).content[0].text)
    expect(fetched.tiles[0].biome).toBe('water')
  })

  it('batch skips biome validation for a world with no registered biomes (backward compatible)', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'batch', worldId: WORLD,
      tiles: [{ x: 0, y: 0, biome: 'totally_made_up' }],
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.tilesInserted).toBe(1)
    expect(body.errors).toEqual([])
  })

  it('batch flags unknown biomes as per-tile errors but still writes valid tiles once a registry exists (#274)', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'limestone_karst', glyph: 'K' })
    const r = await handleWorldMap(db(), {
      action: 'batch', worldId: WORLD,
      tiles: [{ x: 0, y: 0, biome: 'limestone_karst' }, { x: 1, y: 0, biome: 'not_a_real_biome' }],
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.tilesInserted).toBe(1)
    expect(body.errors).toEqual([{ index: 1, x: 1, y: 0, biome: 'not_a_real_biome', error: 'Unknown biome' }])
    const fetched = JSON.parse((await handleWorldMap(db(), { action: 'tiles', worldId: WORLD, x: 1, y: 0, width: 1, height: 1 })).content[0].text)
    expect(fetched.tiles).toEqual([])
  })

  it('batch skips validation entirely when validateBiomes is false, even with a registry present', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'limestone_karst', glyph: 'K' })
    const r = await handleWorldMap(db(), {
      action: 'batch', worldId: WORLD, validateBiomes: false,
      tiles: [{ x: 0, y: 0, biome: 'not_a_real_biome' }],
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.tilesInserted).toBe(1)
    expect(body.errors).toEqual([])
  })

  it('batch chunks writes over 100 tiles into multiple db.batch() calls', async () => {
    await createWorld()
    const tiles = Array.from({ length: 250 }, (_, i) => ({ x: i, y: 0, biome: 'grass' }))
    const r = await handleWorldMap(db(), { action: 'batch', worldId: WORLD, tiles })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.tilesInserted).toBe(250)
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
      tiles: [{ x: 0, y: 0, biome: 'grass' }],
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

  it('find_poi returns structures', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), { action: 'find_poi', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.structures).toBeDefined()
  })

  it('find_poi filters by type and query', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), { action: 'find_poi', worldId: WORLD, structureType: 'tower', query: 'Mage' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('suggest_poi requires worldId, query, x, y', async () => {
    const r = await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Tower' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('suggest_poi creates a new structure', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Dark Tower', x: 10, y: 20, structureType: 'tower' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.name).toBe('Dark Tower')
    expect(body.structureId).toBeTruthy()
    expect(body.hasZone).toBe(false)
  })

  // ── zones (#276) ──────────────────────────────────────────────────────────

  it('suggest_poi rejects a polygon with fewer than 3 points', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Bad Shape', x: 0, y: 0,
      polygon: [[0, 0], [1, 1]],
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('polygon')
  })

  it('suggest_poi creates a circle zone', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Ratite Nesting Ground', x: 50, y: 50,
      radius: 8, zoneType: 'territory',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hasZone).toBe(true)
  })

  it('suggest_poi creates a polygon zone', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', x: 36, y: 73,
      polygon: [[34, 71], [38, 71], [38, 75], [34, 75]], zoneType: 'territory', predatorRef: 'giant_panther',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hasZone).toBe(true)
  })

  it('suggest_poi creates a ring zone (perimeter)', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Laser-Pylon Perimeter', x: 50, y: 50,
      ringInner: 18, ringOuter: 22, ringPoints: 240, zoneType: 'perimeter',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hasZone).toBe(true)
  })

  it('suggest_poi with zoneType/predatorRef but no shape stores metadata without a queryable zone', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Vague Threat', x: 1, y: 1, zoneType: 'hazard',
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
    const created = JSON.parse((await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Zone', x: 0, y: 0 })).content[0].text)
    const r = await handleWorldMap(db(), { action: 'update_poi', structureId: created.structureId, polygon: [[0, 0]] })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update_poi patches name/type/position without touching zone metadata', async () => {
    await createWorld()
    const created = JSON.parse((await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Old Name', x: 0, y: 0, radius: 5, zoneType: 'territory',
    })).content[0].text)
    const r = await handleWorldMap(db(), { action: 'update_poi', structureId: created.structureId, name: 'New Name', x: 10, y: 10 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    const zones = JSON.parse((await handleWorldMap(db(), { action: 'list_zones', worldId: WORLD })).content[0].text)
    expect(zones.count).toBe(1)
    expect(zones.zones[0].zone.circle.radius).toBe(5)
  })

  it('update_poi patches zone_type alone, preserving the existing shape', async () => {
    await createWorld()
    const created = JSON.parse((await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Shifting Zone', x: 0, y: 0, radius: 5, zoneType: 'territory',
    })).content[0].text)
    await handleWorldMap(db(), { action: 'update_poi', structureId: created.structureId, zoneType: 'exclusion' })
    const zones = JSON.parse((await handleWorldMap(db(), { action: 'list_zones', worldId: WORLD })).content[0].text)
    expect(zones.zones[0].zoneType).toBe('exclusion')
    expect(zones.zones[0].zone.circle.radius).toBe(5)
  })

  it('update_poi replaces a circle shape with a polygon shape', async () => {
    await createWorld()
    const created = JSON.parse((await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Reshaped Zone', x: 0, y: 0, radius: 5, zoneType: 'territory',
    })).content[0].text)
    await handleWorldMap(db(), { action: 'update_poi', structureId: created.structureId, polygon: [[0, 0], [5, 0], [5, 5]] })
    const zones = JSON.parse((await handleWorldMap(db(), { action: 'list_zones', worldId: WORLD })).content[0].text)
    expect(zones.zones[0].zone.type).toBe('polygon')
  })

  it('query_zone requires worldId, x, and y', async () => {
    const r = await handleWorldMap(db(), { action: 'query_zone', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('query_zone returns no zones for a point outside every zone', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', x: 36, y: 73, radius: 4, zoneType: 'territory' })
    const r = await handleWorldMap(db(), { action: 'query_zone', worldId: WORLD, x: 0, y: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.zones).toEqual([])
    expect(body.inPerimeter).toBe(false)
  })

  it('query_zone finds a circle territory containing the point', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', x: 36, y: 73, radius: 4, zoneType: 'territory', predatorRef: 'giant_panther' })
    const r = await handleWorldMap(db(), { action: 'query_zone', worldId: WORLD, x: 37, y: 73 })
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
      action: 'suggest_poi', worldId: WORLD, query: 'Sumpfkarren Depths', x: 42, y: 70,
      polygon: [[40, 68], [44, 68], [44, 72], [40, 72]], zoneType: 'exclusion',
    })
    const r = await handleWorldMap(db(), { action: 'query_zone', worldId: WORLD, x: 41, y: 69 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.zones).toHaveLength(1)
    expect(body.zones[0].zoneType).toBe('exclusion')
  })

  it('query_zone sets inPerimeter true for a point within a ring zone band', async () => {
    await createWorld()
    await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Laser-Pylon Perimeter', x: 50, y: 50,
      ringInner: 18, ringOuter: 22, zoneType: 'perimeter',
    })
    const inside = await handleWorldMap(db(), { action: 'query_zone', worldId: WORLD, x: 70, y: 50 })
    const insideBody = JSON.parse(inside.content[0].text)
    expect(insideBody.inPerimeter).toBe(true)

    const outside = await handleWorldMap(db(), { action: 'query_zone', worldId: WORLD, x: 50, y: 50 })
    const outsideBody = JSON.parse(outside.content[0].text)
    expect(outsideBody.inPerimeter).toBe(false)
  })

  it('query_zone reports multiple overlapping zones', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', x: 36, y: 73, radius: 10, zoneType: 'territory' })
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Broadcast Shadow', x: 36, y: 73, radius: 10, zoneType: 'exclusion' })
    const r = await handleWorldMap(db(), { action: 'query_zone', worldId: WORLD, x: 36, y: 73 })
    const body = JSON.parse(r.content[0].text)
    expect(body.zones).toHaveLength(2)
  })

  // ── zone threat/dominance (#280) ──────────────────────────────────────────

  it('suggest_poi stores threatLevel and dominanceRank on a zone', async () => {
    await createWorld()
    await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', x: 36, y: 73, radius: 10,
      zoneType: 'territory', predatorRef: 'giant_panther', threatLevel: 40, dominanceRank: 5,
    })
    const r = await handleWorldMap(db(), { action: 'query_zone', worldId: WORLD, x: 36, y: 73 })
    const body = JSON.parse(r.content[0].text)
    expect(body.zones[0].threatLevel).toBe(40)
    expect(body.zones[0].dominanceRank).toBe(5)
    expect(body.zones[0].predator).toBe('giant_panther')
  })

  it('query_zone returns null threatLevel/dominanceRank when not set', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Vague Zone', x: 5, y: 5, radius: 2, zoneType: 'territory' })
    const r = await handleWorldMap(db(), { action: 'query_zone', worldId: WORLD, x: 5, y: 5 })
    const body = JSON.parse(r.content[0].text)
    expect(body.zones[0].threatLevel).toBeNull()
    expect(body.zones[0].dominanceRank).toBeNull()
  })

  it('update_poi patches threatLevel/dominanceRank independently of shape and zoneType', async () => {
    await createWorld()
    const created = JSON.parse((await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Leonar Range', x: 20, y: 20, radius: 6, zoneType: 'territory', threatLevel: 20, dominanceRank: 2,
    })).content[0].text)
    await handleWorldMap(db(), { action: 'update_poi', structureId: created.structureId, threatLevel: 55 })
    const r = await handleWorldMap(db(), { action: 'query_zone', worldId: WORLD, x: 20, y: 20 })
    const body = JSON.parse(r.content[0].text)
    expect(body.zones[0].threatLevel).toBe(55)
    expect(body.zones[0].dominanceRank).toBe(2)
    expect(body.zones[0].zoneType).toBe('territory')
  })

  it('list_zones includes threatLevel/dominanceRank/predator', async () => {
    await createWorld()
    await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', x: 36, y: 73, radius: 10,
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
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Dark Tower', x: 10, y: 20 })
    const r = await handleWorldMap(db(), { action: 'list_zones', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.count).toBe(0)
  })

  it('list_zones filters by zoneType', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', x: 36, y: 73, radius: 4, zoneType: 'territory' })
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Sumpfkarren Depths', x: 42, y: 70, radius: 4, zoneType: 'exclusion' })
    const r = await handleWorldMap(db(), { action: 'list_zones', worldId: WORLD, zoneType: 'exclusion' })
    const body = JSON.parse(r.content[0].text)
    expect(body.count).toBe(1)
    expect(body.zones[0].name).toBe('Sumpfkarren Depths')
  })

  it('preview overlays a territory zone glyph over the base terrain', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, tiles: [{ x: 5, y: 5, biome: 'grass' }] })
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', x: 5, y: 5, radius: 2, zoneType: 'territory' })
    const r = await handleWorldMap(db(), { action: 'preview', worldId: WORLD, x: 5, y: 5, width: 1, height: 1 })
    const body = JSON.parse(r.content[0].text)
    expect(body.ascii).toBe('@')
  })

  it('preview overlays a perimeter ring glyph and leaves cells outside the band untouched', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, tiles: [{ x: 70, y: 50, biome: 'grass' }, { x: 50, y: 50, biome: 'grass' }] })
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Perimeter', x: 50, y: 50, ringInner: 18, ringOuter: 22, zoneType: 'perimeter' })
    const inBand = await handleWorldMap(db(), { action: 'preview', worldId: WORLD, x: 70, y: 50, width: 1, height: 1 })
    expect(JSON.parse(inBand.content[0].text).ascii).toBe('⚡')
    const outOfBand = await handleWorldMap(db(), { action: 'preview', worldId: WORLD, x: 50, y: 50, width: 1, height: 1 })
    expect(JSON.parse(outOfBand.content[0].text).ascii).toBe('.')
  })

  it('preview does not overlay a broadcast zone (deliberately unrendered)', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, tiles: [{ x: 5, y: 5, biome: 'grass' }] })
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Broadcast Shadow', x: 5, y: 5, radius: 2, zoneType: 'broadcast' })
    const r = await handleWorldMap(db(), { action: 'preview', worldId: WORLD, x: 5, y: 5, width: 1, height: 1 })
    expect(JSON.parse(r.content[0].text).ascii).toBe('.')
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
    expect(body.dimensions).toEqual({ width: 100, height: 100 })
    expect(body.tileCount).toBe(0)
    expect(body.structureCount).toBe(0)
    expect(body.zoneCount).toBe(0)
  })

  it('render_svg defaults to a 100x100 viewport at (0,0)', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.dimensions).toEqual({ width: 1000, height: 1000 })
  })

  it('render_svg uses the registered biome color for a tile', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'limestone_karst', colorHex: '#C8BFB4' })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, tiles: [{ x: 0, y: 0, biome: 'limestone_karst' }] })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 1, renderHeight: 1 })
    const body = JSON.parse(r.content[0].text)
    expect(body.tileCount).toBe(1)
    expect(body.svg).toContain('#C8BFB4')
  })

  it('render_svg falls back to legacy colors for a world with no registered biomes', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, tiles: [{ x: 0, y: 0, biome: 'forest' }] })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 1, renderHeight: 1 })
    const body = JSON.parse(r.content[0].text)
    expect(body.svg).toContain('#1A472A')
  })

  it('render_svg falls back to a default gray for a biome with no known color', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, tiles: [{ x: 0, y: 0, biome: 'totally_unknown_biome' }] })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 1, renderHeight: 1 })
    const body = JSON.parse(r.content[0].text)
    expect(body.svg).toContain('#888888')
  })

  it('render_svg renders a structure marker with an escaped name', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Tower <of> "Doom" & Sons', x: 5, y: 5 })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 10, renderHeight: 10 })
    const body = JSON.parse(r.content[0].text)
    expect(body.structureCount).toBe(1)
    expect(body.svg).toContain('Tower &lt;of&gt; &quot;Doom&quot; &amp; Sons')
    expect(body.svg).not.toContain('<of>')
  })

  it('render_svg omits structure markers when showStructures is false', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Tower', x: 5, y: 5 })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 10, renderHeight: 10, showStructures: false })
    const body = JSON.parse(r.content[0].text)
    expect(body.structureCount).toBe(0)
    expect(body.svg).not.toContain('Tower')
  })

  it('render_svg renders a circle zone overlay and counts it', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', x: 5, y: 5, radius: 3, zoneType: 'territory' })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 10, renderHeight: 10 })
    const body = JSON.parse(r.content[0].text)
    expect(body.zoneCount).toBe(1)
    expect(body.svg).toContain('<circle')
    expect(body.svg).toContain('fill-opacity="0.2"')
  })

  it('render_svg renders a polygon zone overlay', async () => {
    await createWorld()
    await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Sumpfkarren Depths', x: 5, y: 5,
      polygon: [[3, 3], [7, 3], [7, 7], [3, 7]], zoneType: 'exclusion',
    })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 10, renderHeight: 10 })
    const body = JSON.parse(r.content[0].text)
    expect(body.zoneCount).toBe(1)
    expect(body.svg).toContain('<polygon')
  })

  it('render_svg approximates a ring zone as a single dashed circle and skips its redundant center marker', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Perimeter', x: 5, y: 5, ringInner: 2, ringOuter: 4, zoneType: 'perimeter' })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 10, renderHeight: 10 })
    const body = JSON.parse(r.content[0].text)
    expect(body.zoneCount).toBe(1)
    expect(body.structureCount).toBe(0)
    expect(body.svg).toContain('stroke-dasharray="4 4"')
  })

  it('render_svg omits zone overlays when showZones is false (perimeter unaffected)', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', x: 5, y: 5, radius: 3, zoneType: 'territory' })
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Perimeter', x: 5, y: 5, ringInner: 2, ringOuter: 4, zoneType: 'perimeter' })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 10, renderHeight: 10, showZones: false })
    const body = JSON.parse(r.content[0].text)
    expect(body.zoneCount).toBe(1)
  })

  it('render_svg omits the perimeter overlay when showPerimeter is false (territory unaffected)', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', x: 5, y: 5, radius: 3, zoneType: 'territory' })
    await handleWorldMap(db(), { action: 'suggest_poi', worldId: WORLD, query: 'Perimeter', x: 5, y: 5, ringInner: 2, ringOuter: 4, zoneType: 'perimeter' })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 10, renderHeight: 10, showPerimeter: false })
    const body = JSON.parse(r.content[0].text)
    expect(body.zoneCount).toBe(1)
  })

  it('render_svg renders highlight markers with custom label and color', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), {
      action: 'render_svg', worldId: WORLD, renderWidth: 10, renderHeight: 10,
      highlight: [{ x: 5, y: 5, label: 'Yune', color: '#FF4444' }],
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.svg).toContain('#FF4444')
    expect(body.svg).toContain('Yune')
  })

  it('render_svg renders grid labels when requested', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 20, renderHeight: 20, gridLabels: true })
    const body = JSON.parse(r.content[0].text)
    expect(body.svg).toContain('<text x="0" y="10"')
  })

  it('render_svg omits grid labels by default', async () => {
    await createWorld()
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, renderWidth: 20, renderHeight: 20 })
    const body = JSON.parse(r.content[0].text)
    expect(body.svg).not.toContain('<text x="0" y="10"')
  })

  it('render_svg respects a non-default x/y viewport offset', async () => {
    await createWorld()
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, tiles: [{ x: 50, y: 50, biome: 'grass' }] })
    const r = await handleWorldMap(db(), { action: 'render_svg', worldId: WORLD, x: 40, y: 40, renderWidth: 20, renderHeight: 20 })
    const body = JSON.parse(r.content[0].text)
    expect(body.tileCount).toBe(1)
  })
})
