// Direct handler tests for resource-manage (#286)
import { describe } from './support/helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach, afterEach, vi } from 'vitest'
import { setupRpgDb } from './support/setup-d1'
import {
  handleResourceManage,
  degradeOwnerResources,
  tickAllOwnersDegradation,
} from '@/rpg/handlers/resource-manage'

describe('handleResourceManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const db = () => ({ RPG_DB: env.RPG_DB }) as any
  const WORLD = 'world-1'

  async function createWorld(id = WORLD, width = 100, height = 100) {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(id, 'Test World', 'abc123', width, height, now, now)
      .run()
  }

  async function seedHex(worldId: string, q: number, r: number) {
    await env.RPG_DB.prepare(
      "INSERT INTO hexes (q, r, map_id, terrain, world_id, updated_at) VALUES (?, ?, 'main', 'plains', ?, datetime('now'))",
    )
      .bind(q, r, worldId)
      .run()
  }

  it('returns guiding error for unknown action', async () => {
    const r = await handleResourceManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  // ── crate_drop ───────────────────────────────────────────────────────────

  it('crate_drop requires worldId', async () => {
    const r = await handleResourceManage(db(), { action: 'crate_drop' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('crate_drop errors for unknown world', async () => {
    const r = await handleResourceManage(db(), { action: 'crate_drop', worldId: 'nope' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('crate_drop generates contents respecting day availability and explicit coordinates', async () => {
    await createWorld()
    const r = await handleResourceManage(db(), {
      action: 'crate_drop',
      worldId: WORLD,
      day: 0,
      itemCount: 3,
      q: 10,
      r: 20,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.q).toBe(10)
    expect(body.r).toBe(20)
    expect(body.contents).toHaveLength(3)
    expect(body.day).toBe(0)
  })

  it('crate_drop falls through to the last item in the weighted pool on a near-1 random roll', async () => {
    await createWorld()
    vi.spyOn(Math, 'random').mockReturnValue(0.999999)
    // At day 30, the weapon pool is [Survival Knife, Bear Spray, Improvised
    // Spear] in table order — a near-1 roll exhausts every weight but the
    // last, landing on Improvised Spear via the post-loop fallback.
    const r = await handleResourceManage(db(), {
      action: 'crate_drop',
      worldId: WORLD,
      day: 30,
      itemCount: 1,
      categoryBias: 'weapon',
      q: 1,
      r: 1,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.contents[0].name).toBe('Improvised Spear')
  })

  it('crate_drop biases contents toward a requested category', async () => {
    await createWorld()
    const r = await handleResourceManage(db(), {
      action: 'crate_drop',
      worldId: WORLD,
      day: 30,
      itemCount: 5,
      categoryBias: 'medical',
      q: 1,
      r: 1,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    for (const item of body.contents) expect(item.category).toBe('medical')
  })

  it('crate_drop falls back to the unfiltered pool when the biased category has nothing available yet', async () => {
    await createWorld()
    // "intel" items all have minDay >= 15, so day 0 forces the fallback path.
    const r = await handleResourceManage(db(), {
      action: 'crate_drop',
      worldId: WORLD,
      day: 0,
      itemCount: 1,
      categoryBias: 'intel',
      q: 1,
      r: 1,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.contents).toHaveLength(1)
  })

  it('crate_drop picks a real hex on the map and avoids nearby characters when possible', async () => {
    await createWorld()
    await seedHex(WORLD, 0, 0)
    await seedHex(WORLD, 40, 40)
    const r = await handleResourceManage(db(), {
      action: 'crate_drop',
      worldId: WORLD,
      day: 0,
      avoidPositions: [{ q: 0, r: 0 }],
      minDistance: 3,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    // The only hex clearing minDistance from (0,0) is (40,40).
    expect(body.q).toBe(40)
    expect(body.r).toBe(40)
  })

  it('crate_drop falls back to the first candidate when every hex is within minDistance of an avoided position', async () => {
    await createWorld()
    await seedHex(WORLD, 0, 0)
    await seedHex(WORLD, 1, 1)
    // Every seeded hex is within a huge minDistance of (0,0) — exercises the
    // "no candidate clears the filter" fallback branch.
    const r = await handleResourceManage(db(), {
      action: 'crate_drop',
      worldId: WORLD,
      day: 0,
      avoidPositions: [{ q: 0, r: 0 }],
      minDistance: 100,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(typeof body.q).toBe('number')
    expect(typeof body.r).toBe('number')
  })

  it('crate_drop falls back to the map origin when the world has no hexes yet', async () => {
    await createWorld()
    const r = await handleResourceManage(db(), { action: 'crate_drop', worldId: WORLD, day: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.q).toBe(0)
    expect(body.r).toBe(0)
  })

  // ── consume ──────────────────────────────────────────────────────────────

  it('consume requires ownerType, ownerId, and inventoryId/itemName', async () => {
    const r1 = await handleResourceManage(db(), { action: 'consume' })
    expect(JSON.parse(r1.content[0].text).error).toBe(true)
    const r2 = await handleResourceManage(db(), {
      action: 'consume',
      ownerType: 'character',
      ownerId: 'c1',
    })
    expect(JSON.parse(r2.content[0].text).error).toBe(true)
  })

  it('consume errors when the resource is not found', async () => {
    const r = await handleResourceManage(db(), {
      action: 'consume',
      ownerType: 'character',
      ownerId: 'c1',
      itemName: 'Nothing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  async function seedInventory(
    ownerType: string,
    ownerId: string,
    itemName: string,
    opts: Partial<{
      quantity: number
      category: string
      degradationTimer: number | null
      expiresOnDay: number | null
      day: number
    }> = {},
  ) {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO resource_inventory (id, world_id, owner_type, owner_id, item_name, category, quantity, degradation_timer, expires_on_day, acquired_day, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        id,
        WORLD,
        ownerType,
        ownerId,
        itemName,
        opts.category ?? 'food',
        opts.quantity ?? 1,
        opts.degradationTimer ?? null,
        opts.expiresOnDay ?? null,
        opts.day ?? 0,
        now,
        now,
      )
      .run()
    return id
  }

  it('consume by itemName decrements quantity and returns the catalog effect text', async () => {
    await createWorld()
    await seedInventory('character', 'char-1', 'Field Dressing', {
      quantity: 2,
      category: 'medical',
    })
    const r = await handleResourceManage(db(), {
      action: 'consume',
      ownerType: 'character',
      ownerId: 'char-1',
      itemName: 'Field Dressing',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.remaining).toBe(1)
    expect(body.effect).toContain('bleeding')
  })

  it('consume by inventoryId works and returns null effect for unknown items', async () => {
    await createWorld()
    const id = await seedInventory('character', 'char-1', 'Homebrew Tonic', {
      quantity: 1,
      category: 'custom',
    })
    const r = await handleResourceManage(db(), {
      action: 'consume',
      ownerType: 'character',
      ownerId: 'char-1',
      inventoryId: id,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.remaining).toBe(0)
    expect(body.effect).toBeNull()
  })

  // ── degrade ──────────────────────────────────────────────────────────────

  it('degrade requires ownerType, ownerId, and worldId', async () => {
    const r = await handleResourceManage(db(), {
      action: 'degrade',
      ownerType: 'character',
      ownerId: 'c1',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('degrade spoils an item once its degradation timer runs out', async () => {
    await createWorld()
    await seedInventory('character', 'char-2', 'Standard Ration Pack', {
      quantity: 1,
      category: 'food',
      degradationTimer: 1,
    })
    const r = await handleResourceManage(db(), {
      action: 'degrade',
      ownerType: 'character',
      ownerId: 'char-2',
      worldId: WORLD,
      days: 2,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.spoiled).toEqual(['Standard Ration Pack'])
  })

  it('degrade decrements a still-viable timer without spoiling', async () => {
    await createWorld()
    await seedInventory('character', 'char-3', 'Standard Ration Pack', {
      quantity: 1,
      category: 'food',
      degradationTimer: 5,
    })
    const r = await handleResourceManage(db(), {
      action: 'degrade',
      ownerType: 'character',
      ownerId: 'char-3',
      worldId: WORLD,
      days: 1,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.spoiled).toEqual([])
  })

  it('degrade spoils an item once its expiresOnDay is reached', async () => {
    await createWorld()
    await seedInventory('character', 'char-4', 'Antiseptic Vial', {
      quantity: 1,
      category: 'medical',
      expiresOnDay: 25,
    })
    const r = await handleResourceManage(db(), {
      action: 'degrade',
      ownerType: 'character',
      ownerId: 'char-4',
      worldId: WORLD,
      day: 25,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.spoiled).toEqual(['Antiseptic Vial'])
  })

  it('degrade resets the starvation streak when the owner holds food', async () => {
    await createWorld()
    await seedInventory('character', 'char-5', 'Standard Ration Pack', {
      quantity: 1,
      category: 'food',
    })
    const r = await handleResourceManage(db(), {
      action: 'degrade',
      ownerType: 'character',
      ownerId: 'char-5',
      worldId: WORLD,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.daysWithoutFood).toBe(0)
    expect(body.starvation.note).toBe('Fed.')
  })

  it('degrade increments the starvation streak with no food and reports tiered penalties', async () => {
    await createWorld()
    const r1 = await handleResourceManage(db(), {
      action: 'degrade',
      ownerType: 'character',
      ownerId: 'char-6',
      worldId: WORLD,
    })
    expect(JSON.parse(r1.content[0].text).daysWithoutFood).toBe(1)
    const r2 = await handleResourceManage(db(), {
      action: 'degrade',
      ownerType: 'character',
      ownerId: 'char-6',
      worldId: WORLD,
    })
    const body2 = JSON.parse(r2.content[0].text)
    expect(body2.daysWithoutFood).toBe(2)
    expect(body2.starvation.conPenalty).toBe(-2)
  })

  it('degrade reports the day-4+ death-save tier', async () => {
    await createWorld()
    for (let i = 0; i < 4; i++)
      await handleResourceManage(db(), {
        action: 'degrade',
        ownerType: 'character',
        ownerId: 'char-7',
        worldId: WORLD,
      })
    const r = await handleResourceManage(db(), {
      action: 'degrade',
      ownerType: 'character',
      ownerId: 'char-7',
      worldId: WORLD,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.daysWithoutFood).toBeGreaterThanOrEqual(4)
    expect(body.starvation.deathSaveRequired).toBe(true)
  })

  it('degrade respects an explicit ateToday flag even with no food in inventory', async () => {
    await createWorld()
    await handleResourceManage(db(), {
      action: 'degrade',
      ownerType: 'character',
      ownerId: 'char-8',
      worldId: WORLD,
    })
    const r = await handleResourceManage(db(), {
      action: 'degrade',
      ownerType: 'character',
      ownerId: 'char-8',
      worldId: WORLD,
      ateToday: true,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.daysWithoutFood).toBe(0)
  })

  it('degradeOwnerResources and tickAllOwnersDegradation are directly usable by production-manage', async () => {
    await createWorld()
    await seedInventory('party', 'party-1', 'Standard Ration Pack', {
      quantity: 1,
      category: 'food',
    })
    const direct = await degradeOwnerResources(env.RPG_DB, 'party', 'party-1', WORLD, 1, 1, false)
    expect(direct.ownerId).toBe('party-1')
    const batch = await tickAllOwnersDegradation(env.RPG_DB, WORLD, 2)
    expect(batch.some((r) => r.ownerId === 'party-1')).toBe(true)
  })

  it('tickAllOwnersDegradation returns an empty array when the world has no resource owners', async () => {
    await createWorld()
    const batch = await tickAllOwnersDegradation(env.RPG_DB, WORLD, 1)
    expect(batch).toEqual([])
  })

  // ── improvise / craft ────────────────────────────────────────────────────

  it('improvise/craft require biomeName and itemName', async () => {
    const r = await handleResourceManage(db(), { action: 'craft' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('craft errors for an unknown biome', async () => {
    const r = await handleResourceManage(db(), {
      action: 'craft',
      biomeName: 'lava_moon',
      itemName: 'Splint',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('craft errors for an item not craftable in the given biome', async () => {
    const r = await handleResourceManage(db(), {
      action: 'craft',
      biomeName: 'Pine Forest',
      itemName: 'Cave shelter',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('craft succeeds against its DC and stores the item when owner info is given', async () => {
    await createWorld()
    const r = await handleResourceManage(db(), {
      action: 'craft',
      biomeName: 'pine forest',
      itemName: 'Splint',
      abilityModifier: 20,
      rollValue: 10,
      ownerType: 'character',
      ownerId: 'char-9',
      worldId: WORLD,
      day: 3,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.succeeded).toBe(true)
    expect(body.improvised).toBe(false)
    expect(body.breaksOnUse).toBe(false)

    const state = await handleResourceManage(db(), {
      action: 'get_state',
      ownerType: 'character',
      ownerId: 'char-9',
    })
    const stateBody = JSON.parse(state.content[0].text)
    expect(stateBody.inventory.some((i: { item_name: string }) => i.item_name === 'Splint')).toBe(
      true,
    )
  })

  it('craft fails when the roll is below the DC and does not store anything', async () => {
    const r = await handleResourceManage(db(), {
      action: 'craft',
      biomeName: 'pine forest',
      itemName: 'Splint',
      abilityModifier: -20,
      rollValue: 1,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.succeeded).toBe(false)
  })

  it('improvise applies a break-on-use roll and never bypasses it for craft', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const improviseRes = await handleResourceManage(db(), {
      action: 'improvise',
      biomeName: 'pine forest',
      itemName: 'Improvised spear',
      abilityModifier: 20,
      rollValue: 10,
    })
    const improviseBody = JSON.parse(improviseRes.content[0].text)
    expect(improviseBody.improvised).toBe(true)
    expect(improviseBody.breaksOnUse).toBe(true)

    const craftRes = await handleResourceManage(db(), {
      action: 'craft',
      biomeName: 'pine forest',
      itemName: 'Improvised spear',
      abilityModifier: 20,
      rollValue: 10,
    })
    const craftBody = JSON.parse(craftRes.content[0].text)
    expect(craftBody.breaksOnUse).toBe(false)
  })

  // ── scavenge ─────────────────────────────────────────────────────────────

  it('scavenge requires biomeName', async () => {
    const r = await handleResourceManage(db(), { action: 'scavenge' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('scavenge errors for an unknown biome', async () => {
    const r = await handleResourceManage(db(), { action: 'scavenge', biomeName: 'lava_moon' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('scavenge rolls against a forageable item DC and reports success/failure', async () => {
    const r = await handleResourceManage(db(), {
      action: 'scavenge',
      biomeName: 'meadow',
      abilityModifier: 20,
      rollValue: 15,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(typeof body.itemName).toBe('string')
    expect(body.succeeded).toBe(true)
  })

  it('scavenge stores the found item when owner info is given', async () => {
    await createWorld()
    const r = await handleResourceManage(db(), {
      action: 'scavenge',
      biomeName: 'beach',
      abilityModifier: 20,
      rollValue: 15,
      ownerType: 'party',
      ownerId: 'party-2',
      worldId: WORLD,
      day: 1,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    if (body.succeeded) {
      const state = await handleResourceManage(db(), {
        action: 'get_state',
        ownerType: 'party',
        ownerId: 'party-2',
      })
      const stateBody = JSON.parse(state.content[0].text)
      expect(stateBody.count).toBeGreaterThanOrEqual(1)
    }
  })

  it('scavenge reports failure without storing anything on a low roll', async () => {
    const r = await handleResourceManage(db(), {
      action: 'scavenge',
      biomeName: 'limestone karst',
      abilityModifier: -20,
      rollValue: 1,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.succeeded).toBe(false)
  })

  it('scavenge works for the remaining biomes (coastal_water, bog)', async () => {
    for (const biome of ['coastal_water', 'bog']) {
      const r = await handleResourceManage(db(), {
        action: 'scavenge',
        biomeName: biome,
        abilityModifier: 20,
        rollValue: 15,
      })
      const body = JSON.parse(r.content[0].text)
      expect(body.success).toBe(true)
    }
  })

  // ── get_state ────────────────────────────────────────────────────────────

  it('get_state requires ownerType and ownerId', async () => {
    const r = await handleResourceManage(db(), { action: 'get_state' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_state returns an empty inventory and zero starvation for a fresh owner', async () => {
    const r = await handleResourceManage(db(), {
      action: 'get_state',
      ownerType: 'character',
      ownerId: 'brand-new',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.inventory).toEqual([])
    expect(body.daysWithoutFood).toBe(0)
  })
})
