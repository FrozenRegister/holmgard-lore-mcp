// Tests for scene_manage tool — D1 scene management
import { describe } from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'

describe('scene_manage tool', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    })

    const resClone = res.clone()
    let json: Record<string, any>
    try {
      json = await res.json() as Record<string, any>
    } catch (e) {
      const text = await resClone.text()
      if (text.includes('Internal Server Error') || text.includes('Error:')) {
        return { error: true, message: text }
      }
      throw new Error(`Failed to parse response: ${text}`)
    }

    const text = json.result?.content?.[0]?.text
    if (text) {
      try {
        return JSON.parse(text)
      } catch {
        return { error: true, message: `Failed to parse response text: ${text}` }
      }
    }
    return json
  }

  // Setup helpers
  async function createWorld(worldId: string) {
    const db = env.RPG_DB
    await db.prepare('INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
      worldId,
      `World ${worldId}`,
      'test-seed-123',
      100,
      100,
      new Date().toISOString(),
      new Date().toISOString()
    ).run()
  }

  async function createCharacter(charId: string, name: string, worldId: string, roomId?: string) {
    const db = env.RPG_DB
    const stats = JSON.stringify({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 })
    await db.prepare(
      'INSERT INTO characters (id, name, stats, character_type, world_id, current_room_id, hp, max_hp, ac, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(charId, name, stats, 'npc', worldId, roomId || null, 50, 50, 15, 5, new Date().toISOString(), new Date().toISOString()).run()
  }

  // ── CRUD Tests ──────────────────────────────────────────────────────────────

  it('create inserts a new scene', async () => {
    await createWorld('world:scenes')
    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'create',
      worldId: 'world:scenes',
      title: 'Tavern Meeting',
      whenLabel: 'Evening',
      placeLabel: 'The Broken Wheel',
      narration: 'Adventurers gather at the tavern.'
    })
    expect(r.success).toBe(true)
    expect(r.sceneId).toBeTruthy()
    expect(r.title).toBe('Tavern Meeting')
  })

  it('create with participants', async () => {
    await createWorld('world:scenes')
    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'create',
      worldId: 'world:scenes',
      title: 'Council',
      narration: 'A formal council meeting begins.',
      participants: ['character:lord', 'character:advisor']
    })
    expect(r.success).toBe(true)
    expect(r.participants).toContain('character:lord')
  })

  it('get retrieves scene by ID', async () => {
    await createWorld('world:scenes')
    const created = await callTool('rpg', {
      sub: 'scene',
      action: 'create',
      worldId: 'world:scenes',
      title: 'Test Scene',
      narration: 'A moment of peace.'
    })
    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'get',
      id: created.sceneId
    })
    expect(r.success).toBe(true)
    expect(r.scene.title).toBe('Test Scene')
    expect(r.scene.narration).toBe('A moment of peace.')
  })

  it('list returns all scenes', async () => {
    await createWorld('world:scenes')
    await callTool('rpg', {
      sub: 'scene',
      action: 'create',
      worldId: 'world:scenes',
      title: 'Scene 1',
      narration: 'First scene in list.'
    })
    await callTool('rpg', {
      sub: 'scene',
      action: 'create',
      worldId: 'world:scenes',
      title: 'Scene 2',
      narration: 'Second scene in list.'
    })

    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'list',
      worldId: 'world:scenes'
    })
    expect(r.success).toBe(true)
    expect(r.count).toBeGreaterThanOrEqual(2)
    expect(r.scenes).toBeInstanceOf(Array)
  })

  it('list respects limit parameter', async () => {
    await createWorld('world:scenes')
    for (let i = 0; i < 5; i++) {
      await callTool('rpg', {
        sub: 'scene',
        action: 'create',
        worldId: 'world:scenes',
        title: `Scene ${i}`,
        narration: `Scene ${i} narration.`
      })
    }

    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'list',
      worldId: 'world:scenes',
      limit: 2
    })
    expect(r.success).toBe(true)
    expect(r.count).toBeLessThanOrEqual(2)
  })

  it('update modifies scene properties', async () => {
    await createWorld('world:scenes')
    const created = await callTool('rpg', {
      sub: 'scene',
      action: 'create',
      worldId: 'world:scenes',
      title: 'Original Title',
      narration: 'Original scene.'
    })
    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'update',
      id: created.sceneId,
      title: 'Updated Title'
    })
    expect(r.success).toBe(true)

    const updated = await callTool('rpg', {
      sub: 'scene',
      action: 'get',
      id: created.sceneId
    })
    expect(updated.scene.title).toBe('Updated Title')
  })

  it('delete removes scene', async () => {
    await createWorld('world:scenes')
    const created = await callTool('rpg', {
      sub: 'scene',
      action: 'create',
      worldId: 'world:scenes',
      title: 'Doomed',
      narration: 'A cursed scene.'
    })
    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'delete',
      id: created.sceneId
    })
    expect(r.success).toBe(true)

    const deleted = await callTool('rpg', {
      sub: 'scene',
      action: 'get',
      id: created.sceneId
    })
    expect(deleted.error).toBe(true)
  })

  it('get_latest retrieves most recent scene', async () => {
    await createWorld('world:scenes')
    const scene1 = await callTool('rpg', {
      sub: 'scene',
      action: 'create',
      worldId: 'world:scenes',
      title: 'First Scene',
      narration: 'The first scene.'
    })
    const scene2 = await callTool('rpg', {
      sub: 'scene',
      action: 'create',
      worldId: 'world:scenes',
      title: 'Latest Scene',
      narration: 'The latest scene.'
    })

    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'get_latest',
      worldId: 'world:scenes'
    })
    expect(r.success).toBe(true)
    expect(r.scene.title).toBe('Latest Scene')
    expect(r.scene.id).toBe(scene2.sceneId)
  })

  // ── state_snapshot Tests (#368) ────────────────────────────────────────────

  it('state_snapshot requires worldId', async () => {
    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'state_snapshot',
      locationKey: 'location:tavern'
    })
    expect(r.error).toBe(true)
    expect(r.message).toContain('required')
  })

  it('state_snapshot returns occupants', async () => {
    await createWorld('world:snapshot')
    // Note: without room IDs, characters won't have locations, so occupants will be empty
    // This test just verifies the occupants field is returned
    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'state_snapshot',
      worldId: 'world:snapshot',
      locationKey: 'location:tavern',
      include: ['occupants']
    })
    expect(r.success).toBe(true)
    expect(r.occupants).toBeDefined()
    expect(Array.isArray(r.occupants)).toBe(true)
  })

  it('state_snapshot returns weather', async () => {
    await createWorld('world:snapshot')
    // Set weather
    await callTool('rpg', {
      sub: 'weather',
      action: 'set_forecast',
      worldId: 'world:snapshot',
      day: 0,
      temperatureHigh: 25,
      conditions: 'clear'
    })

    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'state_snapshot',
      worldId: 'world:snapshot',
      locationKey: 'location:outside',
      include: ['weather']
    })
    expect(r.success).toBe(true)
    expect(r.weather).toBeDefined()
    if (r.weather) {
      expect(r.weather.found).toBe(true)
      expect(r.weather.temperature_high).toBe(25)
    }
  })

  it('state_snapshot includes environment from lore when available', async () => {
    await createWorld('world:snapshot')
    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'state_snapshot',
      worldId: 'world:snapshot',
      locationKey: 'location:mystery',
      include: ['environment']
    })
    expect(r.success).toBe(true)
    expect(r.environment).toBeDefined()
  })

  it('state_snapshot includes recent events', async () => {
    await createWorld('world:snapshot')
    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'state_snapshot',
      worldId: 'world:snapshot',
      locationKey: 'location:battleground',
      include: ['events']
    })
    expect(r.success).toBe(true)
    expect(r.recent_events).toBeDefined()
  })

  it('state_snapshot includes reachable locations', async () => {
    await createWorld('world:snapshot')
    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'state_snapshot',
      worldId: 'world:snapshot',
      locationKey: 'location:center',
      include: ['reachable']
    })
    expect(r.success).toBe(true)
    expect(r.reachable_locations).toBeDefined()
  })

  it('state_snapshot includes active threads', async () => {
    await createWorld('world:snapshot')
    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'state_snapshot',
      worldId: 'world:snapshot',
      locationKey: 'location:anywhere',
      include: ['threads']
    })
    expect(r.success).toBe(true)
    expect(r.active_threads).toBeDefined()
  })

  it('state_snapshot includes setups', async () => {
    await createWorld('world:snapshot')
    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'state_snapshot',
      worldId: 'world:snapshot',
      locationKey: 'location:tavern',
      include: ['setups']
    })
    expect(r.success).toBe(true)
    expect(r.open_setups).toBeDefined()
  })

  it('state_snapshot combines multiple sections', async () => {
    await createWorld('world:snapshot')
    await createCharacter('char:eve', 'Eve', 'world:snapshot')

    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'state_snapshot',
      worldId: 'world:snapshot',
      locationKey: 'location:plaza',
      include: ['occupants', 'weather', 'environment', 'events']
    })
    expect(r.success).toBe(true)
    expect(r.occupants).toBeDefined()
    expect(r.weather).toBeDefined()
    expect(r.environment).toBeDefined()
    expect(r.recent_events).toBeDefined()
  })

  it('state_snapshot defaults to common includes when not specified', async () => {
    await createWorld('world:snapshot')
    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'state_snapshot',
      worldId: 'world:snapshot',
      locationKey: 'location:default'
    })
    expect(r.success).toBe(true)
    expect(r.occupants).toBeDefined()
    expect(r.weather).toBeDefined()
    expect(r.environment).toBeDefined()
  })

  it('state_snapshot supports snapshot alias', async () => {
    await createWorld('world:snapshot')
    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'snapshot',
      worldId: 'world:snapshot',
      locationKey: 'location:test'
    })
    expect(r.success).toBe(true)
  })

  it('state_snapshot supports scene_state alias', async () => {
    await createWorld('world:snapshot')
    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'scene_state',
      worldId: 'world:snapshot',
      locationKey: 'location:test'
    })
    expect(r.success).toBe(true)
  })

  it('state_snapshot supports brief alias', async () => {
    await createWorld('world:snapshot')
    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'brief',
      worldId: 'world:snapshot',
      locationKey: 'location:test'
    })
    expect(r.success).toBe(true)
  })

  // ── Alias Tests ──────────────────────────────────────────────────────────────

  it('supports "new_scene" alias for create', async () => {
    await createWorld('world:scenes')
    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'new_scene',
      worldId: 'world:scenes',
      title: 'Fresh Scene',
      narration: 'A moment passes.'
    })
    expect(r.success).toBe(true)
  })

  it('supports "show" alias for get', async () => {
    await createWorld('world:scenes')
    const created = await callTool('rpg', {
      sub: 'scene',
      action: 'create',
      worldId: 'world:scenes',
      title: 'Visible',
      narration: 'Clearly seen.'
    })
    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'show',
      id: created.sceneId
    })
    expect(r.success).toBe(true)
    expect(r.scene.title).toBe('Visible')
  })

  it('supports "latest" alias for get_latest', async () => {
    await createWorld('world:scenes')
    await callTool('rpg', {
      sub: 'scene',
      action: 'create',
      worldId: 'world:scenes',
      title: 'Current',
      narration: 'The current scene.'
    })
    const r = await callTool('rpg', {
      sub: 'scene',
      action: 'latest',
      worldId: 'world:scenes'
    })
    expect(r.success).toBe(true)
  })

  // ── Conflict-Type Routing Tests (#316) ──────────────────────────────────────

  it('get_conflict_type returns null for a scene with no conflict type set', async () => {
    await createWorld('world:conflict')
    const created = await callTool('rpg', { sub: 'scene', action: 'create', worldId: 'world:conflict', title: 'Neutral', narration: 'Nothing tagged yet.' })
    const r = await callTool('rpg', { sub: 'scene', action: 'get_conflict_type', id: created.sceneId })
    expect(r.success).toBe(true)
    expect(r.conflictTypeId).toBeNull()
    expect(r.conflictType).toBeNull()
  })

  it('set_conflict_type tags a scene as physical and get_conflict_type reflects it', async () => {
    await createWorld('world:conflict')
    const created = await callTool('rpg', { sub: 'scene', action: 'create', worldId: 'world:conflict', title: 'Courtyard', narration: 'Predator sighted.' })
    const setRes = await callTool('rpg', { sub: 'scene', action: 'set_conflict_type', id: created.sceneId, conflictTypeId: 'physical' })
    expect(setRes.success).toBe(true)
    expect(setRes.conflictTypeId).toBe('physical')

    const getRes = await callTool('rpg', { sub: 'scene', action: 'get_conflict_type', id: created.sceneId })
    expect(getRes.conflictTypeId).toBe('physical')
    expect(getRes.conflictType.resolver).toBe('combat')
  })

  it('set_conflict_type can clear a scene back to null', async () => {
    await createWorld('world:conflict')
    const created = await callTool('rpg', { sub: 'scene', action: 'create', worldId: 'world:conflict', title: 'Boardroom', narration: 'A vote begins.' })
    await callTool('rpg', { sub: 'scene', action: 'set_conflict_type', id: created.sceneId, conflictTypeId: 'social' })
    const clearRes = await callTool('rpg', { sub: 'scene', action: 'set_conflict_type', id: created.sceneId, conflictTypeId: null })
    expect(clearRes.success).toBe(true)
    expect(clearRes.conflictTypeId).toBeNull()
  })

  it('set_conflict_type rejects an unknown conflict type id', async () => {
    await createWorld('world:conflict')
    const created = await callTool('rpg', { sub: 'scene', action: 'create', worldId: 'world:conflict', title: 'Odd', narration: 'A weird scene.' })
    const r = await callTool('rpg', { sub: 'scene', action: 'set_conflict_type', id: created.sceneId, conflictTypeId: 'nonexistent-type' })
    expect(r.error).toBe(true)
  })

  it('set_conflict_type rejects a nonexistent scene', async () => {
    const r = await callTool('rpg', { sub: 'scene', action: 'set_conflict_type', id: 'nonexistent-scene-id', conflictTypeId: 'physical' })
    expect(r.error).toBe(true)
  })

  it('set_conflict_type requires conflictTypeId', async () => {
    await createWorld('world:conflict')
    const created = await callTool('rpg', { sub: 'scene', action: 'create', worldId: 'world:conflict', title: 'Missing Field', narration: 'No type given.' })
    const r = await callTool('rpg', { sub: 'scene', action: 'set_conflict_type', id: created.sceneId })
    expect(r.error).toBe(true)
  })

  it('get_conflict_type rejects a nonexistent scene', async () => {
    const r = await callTool('rpg', { sub: 'scene', action: 'get_conflict_type', id: 'nonexistent-scene-id' })
    expect(r.error).toBe(true)
  })

  it('set_conflict_type requires id', async () => {
    const r = await callTool('rpg', { sub: 'scene', action: 'set_conflict_type', conflictTypeId: 'physical' })
    expect(r.error).toBe(true)
  })

  it('get_conflict_type requires id', async () => {
    const r = await callTool('rpg', { sub: 'scene', action: 'get_conflict_type' })
    expect(r.error).toBe(true)
  })
})
