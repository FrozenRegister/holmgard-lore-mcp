// Direct handler tests for creature-manage (#445, #440 Phase 3) — CRUD over the
// creature_ai_state table, plus a migration smoke check.
import { describe } from './support/helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'
import { handleCreatureManage } from '@/rpg/handlers/creature-manage'

describe('handleCreatureManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB }) as any
  const WORLD = 'world-1'

  async function createWorld(id = WORLD) {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(id, 'Test World', 'abc123', 100, 100, now, now)
      .run()
  }

  const parse = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text)

  it('migration 0044 created the table and its indexes', async () => {
    const { results } = (await env.RPG_DB.prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name LIKE '%creature_ai%'",
    ).all()) as { results: Array<{ name: string }> }
    const names = results.map((r) => r.name)
    expect(names).toContain('creature_ai_state')
    expect(names).toContain('idx_creature_ai_world')
    expect(names).toContain('idx_creature_ai_world_hex')
  })

  it('returns a guiding error for an unknown action', async () => {
    const r = await handleCreatureManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  it('rejects invalid Zod input (bad taxonomy enum)', async () => {
    const r = await handleCreatureManage(db(), {
      action: 'register',
      worldId: WORLD,
      creatureKey: 'creature:x',
      predatorTaxonomy: 'nope',
    })
    expect(parse(r).error).toBe(true)
  })

  // register
  it('register requires worldId and creatureKey', async () => {
    expect(parse(await handleCreatureManage(db(), { action: 'register' })).error).toBe(true)
  })

  it('register rejects an unknown world', async () => {
    const r = await handleCreatureManage(db(), {
      action: 'register',
      worldId: 'ghost',
      creatureKey: 'creature:x',
    })
    expect(parse(r).message).toContain('World not found')
  })

  it('register with defaults', async () => {
    await createWorld()
    const body = parse(
      await handleCreatureManage(db(), {
        action: 'register',
        worldId: WORLD,
        creatureKey: 'creature:panther',
      }),
    )
    expect(body.success).toBe(true)
    expect(body.predatorTaxonomy).toBe('feral')
    expect(body.currentState).toBe('patrolling')
    expect(body.activityPattern).toBe('always')
    expect(body.creatureId).toBeTruthy()
  })

  it('register with explicit fields', async () => {
    await createWorld()
    const body = parse(
      await handleCreatureManage(db(), {
        action: 'register',
        worldId: WORLD,
        creatureKey: 'creature:shaper',
        predatorTaxonomy: 'shaper',
        homeNestQ: 1,
        homeNestR: 2,
        territoryRadius: 6,
        hunger: 20,
        creativeDrive: 30,
        aggression: 0.8,
        activityPattern: 'nocturnal',
        movementSpeed: 3,
        stealth: 0.4,
        perception: 0.6,
        currentState: 'stalking',
        currentHexQ: 5,
        currentHexR: 5,
        targetHexQ: 6,
        targetHexR: 6,
        atelierHexQ: 9,
        atelierHexR: 9,
        yieldPreference: 'grade-a',
      }),
    )
    expect(body.success).toBe(true)
    expect(body.predatorTaxonomy).toBe('shaper')
    expect(body.activityPattern).toBe('nocturnal')
  })

  it('register rejects a duplicate creature key for the same world', async () => {
    await createWorld()
    const args = { action: 'register', worldId: WORLD, creatureKey: 'creature:dup' }
    await handleCreatureManage(db(), args)
    const r = await handleCreatureManage(db(), args)
    expect(parse(r).message).toContain('already registered')
  })

  // list
  it('list requires worldId', async () => {
    expect(parse(await handleCreatureManage(db(), { action: 'list' })).error).toBe(true)
  })

  it('list returns registered creatures', async () => {
    await createWorld()
    await handleCreatureManage(db(), {
      action: 'register',
      worldId: WORLD,
      creatureKey: 'creature:a',
    })
    const body = parse(
      await handleCreatureManage(db(), { action: 'list', worldId: WORLD, limit: 10 }),
    )
    expect(body.count).toBe(1)
    expect(body.creatures[0].creature_key).toBe('creature:a')
  })

  // get
  it('get requires an identifier', async () => {
    expect(parse(await handleCreatureManage(db(), { action: 'get' })).error).toBe(true)
  })

  it('get by id and by worldId+creatureKey', async () => {
    await createWorld()
    const reg = parse(
      await handleCreatureManage(db(), {
        action: 'register',
        worldId: WORLD,
        creatureKey: 'creature:g',
      }),
    )
    const byId = parse(await handleCreatureManage(db(), { action: 'get', id: reg.creatureId }))
    expect(byId.creature.creature_key).toBe('creature:g')
    const byKey = parse(
      await handleCreatureManage(db(), {
        action: 'get',
        worldId: WORLD,
        creatureKey: 'creature:g',
      }),
    )
    expect(byKey.creature.id).toBe(reg.creatureId)
  })

  it('get returns not-found for a missing creature', async () => {
    const r = await handleCreatureManage(db(), { action: 'get', id: 'nope' })
    expect(parse(r).message).toContain('not found')
  })

  // update
  it('update requires an id', async () => {
    expect(parse(await handleCreatureManage(db(), { action: 'update' })).error).toBe(true)
  })

  it('update rejects a missing creature', async () => {
    const r = await handleCreatureManage(db(), { action: 'update', id: 'ghost' })
    expect(parse(r).message).toContain('not found')
  })

  it('update sets every mutable field', async () => {
    await createWorld()
    const reg = parse(
      await handleCreatureManage(db(), {
        action: 'register',
        worldId: WORLD,
        creatureKey: 'creature:u',
      }),
    )
    const upd = parse(
      await handleCreatureManage(db(), {
        action: 'update',
        creatureId: reg.creatureId,
        predatorTaxonomy: 'shaper',
        homeNestQ: 1,
        homeNestR: 1,
        territoryRadius: 7,
        hunger: 55,
        creativeDrive: 44,
        aggression: 0.9,
        activityPattern: 'diurnal',
        movementSpeed: 4,
        stealth: 0.3,
        perception: 0.7,
        currentState: 'tenderizing',
        currentHexQ: 2,
        currentHexR: 3,
        targetHexQ: 4,
        targetHexR: 5,
        atelierHexQ: 8,
        atelierHexR: 8,
        yieldPreference: 'grade-b',
      }),
    )
    expect(upd.success).toBe(true)
    const got = parse(await handleCreatureManage(db(), { action: 'get', id: reg.creatureId }))
    expect(got.creature.predator_taxonomy).toBe('shaper')
    expect(got.creature.hunger).toBe(55)
    expect(got.creature.current_state).toBe('tenderizing')
    expect(got.creature.yield_preference).toBe('grade-b')
  })

  // delete
  it('delete requires an id', async () => {
    expect(parse(await handleCreatureManage(db(), { action: 'delete' })).error).toBe(true)
  })

  it('delete rejects a missing creature', async () => {
    const r = await handleCreatureManage(db(), { action: 'delete', id: 'ghost' })
    expect(parse(r).message).toContain('not found')
  })

  it('delete removes the creature', async () => {
    await createWorld()
    const reg = parse(
      await handleCreatureManage(db(), {
        action: 'register',
        worldId: WORLD,
        creatureKey: 'creature:d',
      }),
    )
    expect(
      parse(await handleCreatureManage(db(), { action: 'delete', id: reg.creatureId })).success,
    ).toBe(true)
    expect(
      parse(await handleCreatureManage(db(), { action: 'get', id: reg.creatureId })).message,
    ).toContain('not found')
  })

  // place
  it('place requires an id', async () => {
    expect(parse(await handleCreatureManage(db(), { action: 'place' })).error).toBe(true)
  })

  it('place requires q and r', async () => {
    const r = await handleCreatureManage(db(), { action: 'place', id: 'x' })
    expect(parse(r).message).toContain('"q" and "r"')
  })

  it('place rejects a missing creature', async () => {
    const r = await handleCreatureManage(db(), { action: 'place', id: 'ghost', q: 1, r: 1 })
    expect(parse(r).message).toContain('not found')
  })

  it('place repositions the creature on the hex map', async () => {
    await createWorld()
    const reg = parse(
      await handleCreatureManage(db(), {
        action: 'register',
        worldId: WORLD,
        creatureKey: 'creature:p',
      }),
    )
    const placed = parse(
      await handleCreatureManage(db(), { action: 'place', id: reg.creatureId, q: 12, r: 7 }),
    )
    expect(placed.success).toBe(true)
    expect(placed.q).toBe(12)
    expect(placed.creatureKey).toBe('creature:p')
    const got = parse(await handleCreatureManage(db(), { action: 'get', id: reg.creatureId }))
    expect(got.creature.current_hex_q).toBe(12)
    expect(got.creature.current_hex_r).toBe(7)
  })
})
