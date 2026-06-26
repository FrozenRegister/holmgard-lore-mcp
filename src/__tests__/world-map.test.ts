// Direct handler tests for world-map (not registered in rpgToolRegistry)
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handleWorldMap } from '../rpg/handlers/world-map'

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
  })
})
