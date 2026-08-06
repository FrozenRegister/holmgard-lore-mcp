// #433 — terrain→biome vocabulary bridge helper
import { describe } from './support/helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'
import { resolveBiomeForHex, resolveBiomeForTerrain } from '@/lib/resolve-biome'

describe('resolveBiomeForTerrain / resolveBiomeForHex', () => {
  const WORLD = 'world-1'

  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(WORLD, 'Test World', 'abc123', 100, 100, now, now)
      .run()
  })

  async function insertHex(q: number, r: number, terrain: string | null, biome: string | null) {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      `INSERT INTO hexes (q, r, map_id, terrain, label, data, world_id, biome, updated_at)
       VALUES (?, ?, 'main', ?, NULL, NULL, ?, ?, ?)`,
    )
      .bind(q, r, terrain, WORLD, biome, now)
      .run()
  }

  it('resolveBiomeForTerrain returns null when no hex has bridged that terrain', async () => {
    const result = await resolveBiomeForTerrain(env.RPG_DB, WORLD, 'Woods')
    expect(result).toBeNull()
  })

  it('resolveBiomeForTerrain finds the biome assigned to a sibling hex with the same terrain', async () => {
    await insertHex(1, 1, 'Woods', 'forest')
    await insertHex(2, 2, 'Woods', null)
    const result = await resolveBiomeForTerrain(env.RPG_DB, WORLD, 'Woods')
    expect(result).toBe('forest')
  })

  it('resolveBiomeForTerrain is case-insensitive on terrain', async () => {
    await insertHex(1, 1, 'woods', 'forest')
    const result = await resolveBiomeForTerrain(env.RPG_DB, WORLD, 'Woods')
    expect(result).toBe('forest')
  })

  it('resolveBiomeForTerrain is deterministic: picks the most common biome, ties broken alphabetically', async () => {
    await insertHex(1, 1, 'Woods', 'taiga')
    await insertHex(2, 2, 'Woods', 'forest')
    await insertHex(3, 3, 'Woods', 'forest')
    const result = await resolveBiomeForTerrain(env.RPG_DB, WORLD, 'Woods')
    expect(result).toBe('forest')
  })

  it('resolveBiomeForTerrain breaks ties alphabetically when counts are equal', async () => {
    await insertHex(1, 1, 'Woods', 'taiga')
    await insertHex(2, 2, 'Woods', 'forest')
    const result = await resolveBiomeForTerrain(env.RPG_DB, WORLD, 'Woods')
    expect(result).toBe('forest')
  })

  it('resolveBiomeForTerrain scopes by world_id', async () => {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind('world-2', 'Other World', 'xyz', 100, 100, now, now)
      .run()
    await env.RPG_DB.prepare(
      `INSERT INTO hexes (q, r, map_id, terrain, label, data, world_id, biome, updated_at)
       VALUES (1, 1, 'main', 'Woods', NULL, NULL, 'world-2', 'forest', ?)`,
    )
      .bind(now)
      .run()
    const result = await resolveBiomeForTerrain(env.RPG_DB, WORLD, 'Woods')
    expect(result).toBeNull()
  })

  it('resolveBiomeForHex returns direct biome when the hex already has one set', async () => {
    await insertHex(5, 5, 'Woods', 'taiga')
    const result = await resolveBiomeForHex(env.RPG_DB, WORLD, 5, 5)
    expect(result).toEqual({ biome: 'taiga', source: 'direct' })
  })

  it('resolveBiomeForHex bridges via terrain when the hex has no biome set', async () => {
    await insertHex(1, 1, 'Woods', 'forest')
    await insertHex(5, 5, 'Woods', null)
    const result = await resolveBiomeForHex(env.RPG_DB, WORLD, 5, 5)
    expect(result).toEqual({ biome: 'forest', source: 'terrain_bridge' })
  })

  it('resolveBiomeForHex returns none when hex has neither biome nor a bridgeable terrain', async () => {
    await insertHex(5, 5, null, null)
    const result = await resolveBiomeForHex(env.RPG_DB, WORLD, 5, 5)
    expect(result).toEqual({ biome: null, source: 'none' })
  })

  it('resolveBiomeForHex returns none when hex has terrain but no sibling bridges it', async () => {
    await insertHex(5, 5, 'Woods', null)
    const result = await resolveBiomeForHex(env.RPG_DB, WORLD, 5, 5)
    expect(result).toEqual({ biome: null, source: 'none' })
  })

  it('resolveBiomeForHex returns none when the hex does not exist', async () => {
    const result = await resolveBiomeForHex(env.RPG_DB, WORLD, 99, 99)
    expect(result).toEqual({ biome: null, source: 'none' })
  })
})
