import {
  describe,
  rpc,
  callTool,
  callToolWithApiKey,
  seedKV,
  ADMIN_SECRET,
  parseEncounterTable,
} from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'
import { handleBiomeManage } from '@/rpg/handlers/biome-manage'

describe('legacy bare methods (pre-tools/call)', () => {
  it('list_topics direct method returns keys array', async () => {
    await seedKV('legacy:item1', 'text1')
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'list_topics' }),
    }).then((r) => r.json() as Promise<Record<string, any>>)
    expect(res.result.keys).toContain('legacy:item1')
  })

  it('list_topics direct method requires a valid X-Api-Key', async () => {
    const res = await rpc('list_topics')
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32001)
  })

  it('get_lore direct method retrieves by key param', async () => {
    await seedKV('legacy:thing', 'Legacy content')
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'get_lore',
        params: { key: 'legacy:thing' },
      }),
    }).then((r) => r.json() as Promise<Record<string, any>>)
    expect(res.result.text).toBe('Legacy content')
  })

  it('get_lore direct method requires a valid X-Api-Key', async () => {
    await seedKV('legacy:thing', 'Legacy content')
    const res = await rpc('get_lore', { key: 'legacy:thing' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32001)
  })
})

describe('get_world_biomes direct method (#321)', () => {
  const WORLD = 'world-biomes-1'

  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(WORLD, 'Biome World', 'seed', 100, 100, now, now)
      .run()
  })

  async function post(body: Record<string, unknown>) {
    return SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify(body),
    }).then((r) => r.json() as Promise<Record<string, any>>)
  }

  it('requires a valid X-Api-Key', async () => {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'get_world_biomes',
        params: { worldId: WORLD },
      }),
    }).then((r) => r.json() as Promise<Record<string, any>>)
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32001)
  })

  it('requires worldId', async () => {
    const res = await post({ jsonrpc: '2.0', id: 1, method: 'get_world_biomes', params: {} })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('returns an empty biomes array for a world with none registered', async () => {
    const res = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'get_world_biomes',
      params: { worldId: WORLD },
    })
    expect(res.result.worldId).toBe(WORLD)
    expect(res.result.biomes).toEqual([])
    expect(res.result.count).toBe(0)
  })

  it('returns structured biome rows for a world with registered biomes', async () => {
    await handleBiomeManage({ RPG_DB: env.RPG_DB } as any, {
      action: 'register',
      worldId: WORLD,
      name: 'limestone_karst',
      glyph: 'K',
      colorHex: '#C8BFB4',
      movementCost: 2,
      baseThreat: 10,
      description: 'Jagged karst',
    })
    const res = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'get_world_biomes',
      params: { worldId: WORLD },
    })
    expect(res.result.count).toBe(1)
    const biome = res.result.biomes[0]
    expect(biome.name).toBe('limestone_karst')
    expect(biome.glyph).toBe('K')
    expect(biome.color_hex).toBe('#C8BFB4')
    expect(biome.movement_cost).toBe(2)
    expect(biome.base_threat).toBe(10)
    expect(biome.description).toBe('Jagged karst')
  })

  it('is also reachable via tools/call (rpg{sub:"biome",action:"list"}), same underlying data', async () => {
    await handleBiomeManage({ RPG_DB: env.RPG_DB } as any, {
      action: 'register',
      worldId: WORLD,
      name: 'bog',
    })
    const direct = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'get_world_biomes',
      params: { worldId: WORLD },
    })
    const toolRes = await callTool('rpg', { sub: 'biome', action: 'list', worldId: WORLD })
    const viaTool = JSON.parse(toolRes.result.content[0].text)
    expect(direct.result.biomes).toEqual(viaTool.biomes)
  })
})
