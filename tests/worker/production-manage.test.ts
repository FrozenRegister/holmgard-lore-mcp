// Direct handler tests for production-manage (#283)
import { describe } from './support/helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach, afterEach, vi } from 'vitest'
import { setupRpgDb } from './support/setup-d1'
import { handleProductionManage } from '@/rpg/handlers/production-manage'

describe('handleProductionManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })
  afterEach(() => {
    vi.restoreAllMocks()
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

  it('returns guiding error for unknown action', async () => {
    const r = await handleProductionManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  // ── advance_day ──────────────────────────────────────────────────────────

  it('advance_day requires worldId', async () => {
    const r = await handleProductionManage(db(), { action: 'advance_day' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('advance_day errors for an unknown world', async () => {
    const r = await handleProductionManage(db(), { action: 'advance_day', worldId: 'nope' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('advance_day initializes world_state on day 1 (standard hazard, radius 28)', async () => {
    await createWorld()
    const r = await handleProductionManage(db(), { action: 'advance_day', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.day).toBe(1)
    expect(body.hazardLevel).toBe('standard')
    expect(body.perimeterRadius).toBe(28)
    expect(body.extractionWindow).toBe('closed')
    expect(['storm', 'rain', 'overcast', 'clear']).toContain(body.weather)
    expect(body.crateDrop.success).toBe(true)
    expect(body.corpseDecomposition).toEqual([])
  })

  it('advance_day ticks corpse decomposition for every non-recovered corpse with a death_at in the world (#288 integration)', async () => {
    await createWorld()
    const now = new Date().toISOString()
    const oldDeath = new Date(Date.now() - 30 * 3_600_000).toISOString() // 30h ago -> bloat stage
    await env.RPG_DB.prepare(
      `INSERT INTO corpses (id, character_id, character_name, character_type, world_id, state, state_updated_at, harvestable_resources, created_at, updated_at, death_at, decomposition_stage) VALUES (?, ?, ?, 'pc', ?, 'fresh', ?, '[]', ?, ?, ?, 'fresh')`,
    )
      .bind('corpse-1', 'char-dead', 'Fallen Yield', WORLD, now, now, now, oldDeath)
      .run()
    const r = await handleProductionManage(db(), { action: 'advance_day', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.corpseDecomposition).toHaveLength(1)
    expect(body.corpseDecomposition[0].corpseId).toBe('corpse-1')
    expect(body.corpseDecomposition[0].newStage).toBe('bloat')
  })

  it('advance_day advances an existing world_state row across multiple calls', async () => {
    await createWorld()
    await handleProductionManage(db(), { action: 'advance_day', worldId: WORLD })
    const r = await handleProductionManage(db(), { action: 'advance_day', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.day).toBe(2)
  })

  it('advance_day supports advancing multiple days at once', async () => {
    await createWorld()
    // Force a "clear" weather roll (16-20 on 1d20) so encounterModifier is
    // deterministic: weather can otherwise swing it negative (storm/rain),
    // which is correct behavior but would make this assertion flaky.
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    const r = await handleProductionManage(db(), {
      action: 'advance_day',
      worldId: WORLD,
      daysToAdvance: 7,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.day).toBe(7)
    expect(body.hazardLevel).toBe('elevated')
    expect(body.weather).toBe('clear')
    expect(body.encounterModifier).toBe(6)
  })

  it('advance_day computes every hazard band across the 30-day arc', async () => {
    await createWorld()
    const expectations: Array<[number, string]> = [
      [6, 'standard'],
      [13, 'elevated'],
      [20, 'high'],
      [27, 'severe'],
      [30, 'critical'],
    ]
    for (const [day, level] of expectations) {
      await env.RPG_DB.prepare('DELETE FROM world_state WHERE world_id = ?').bind(WORLD).run()
      const r = await handleProductionManage(db(), {
        action: 'advance_day',
        worldId: WORLD,
        daysToAdvance: day,
      })
      expect(JSON.parse(r.content[0].text).hazardLevel).toBe(level)
    }
  })

  it('advance_day computes perimeter contraction down to the day-25 floor of 8 and holds there', async () => {
    await createWorld()
    const r25 = await handleProductionManage(db(), {
      action: 'advance_day',
      worldId: WORLD,
      daysToAdvance: 25,
    })
    expect(JSON.parse(r25.content[0].text).perimeterRadius).toBe(8)
    const r30 = await handleProductionManage(db(), {
      action: 'advance_day',
      worldId: WORLD,
      daysToAdvance: 5,
    })
    expect(JSON.parse(r30.content[0].text).perimeterRadius).toBe(8)
  })

  it('advance_day opens the extraction window on day 28-30 and closes it permanently after day 30', async () => {
    await createWorld()
    const r28 = await handleProductionManage(db(), {
      action: 'advance_day',
      worldId: WORLD,
      daysToAdvance: 28,
    })
    expect(JSON.parse(r28.content[0].text).extractionWindow).toBe('open')
    const r31 = await handleProductionManage(db(), {
      action: 'advance_day',
      worldId: WORLD,
      daysToAdvance: 3,
    })
    expect(JSON.parse(r31.content[0].text).extractionWindow).toBe('closed_final')
  })

  it('advance_day can skip the crate drop', async () => {
    await createWorld()
    const r = await handleProductionManage(db(), {
      action: 'advance_day',
      worldId: WORLD,
      skipCrateDrop: true,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.crateDrop).toBeNull()
  })

  it('advance_day rolls every weather band deterministically (storm/rain/overcast/clear)', async () => {
    await createWorld()
    const bands: Array<[number, string, number]> = [
      [0.1, 'storm', -8],
      [0.3, 'rain', -5],
      [0.6, 'overcast', 0],
      [0.9, 'clear', 3],
    ]
    for (const [rand, weather, modifier] of bands) {
      vi.spyOn(Math, 'random').mockReturnValue(rand)
      const r = await handleProductionManage(db(), { action: 'advance_day', worldId: WORLD })
      const body = JSON.parse(r.content[0].text)
      expect(body.weather).toBe(weather)
      // encounterModifier also includes the hazard-band contribution, which
      // is 0 on these early days (day <= 6), so it equals the weather delta.
      expect(body.encounterModifier).toBe(modifier)
    }
  })

  it('advance_day rolls fog with the nearBog-boosted chance', async () => {
    await createWorld()
    vi.spyOn(Math, 'random').mockReturnValue(0.2)
    const r = await handleProductionManage(db(), {
      action: 'advance_day',
      worldId: WORLD,
      nearBog: true,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.fog).toBe(true)
  })

  it('advance_day opens a pending audience vote every 3rd day', async () => {
    await createWorld()
    const r = await handleProductionManage(db(), {
      action: 'advance_day',
      worldId: WORLD,
      daysToAdvance: 3,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.pendingVoteId).not.toBeNull()
  })

  it('advance_day does not open a vote on a non-multiple-of-3 day', async () => {
    await createWorld()
    const r = await handleProductionManage(db(), {
      action: 'advance_day',
      worldId: WORLD,
      daysToAdvance: 2,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.pendingVoteId).toBeNull()
  })

  it('advance_day ticks resource degradation for every owner holding resources in the world', async () => {
    await createWorld()
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO resource_inventory (id, world_id, owner_type, owner_id, item_name, category, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
    )
      .bind(
        crypto.randomUUID(),
        WORLD,
        'character',
        'char-1',
        'Standard Ration Pack',
        'food',
        now,
        now,
      )
      .run()
    const r = await handleProductionManage(db(), { action: 'advance_day', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(
      body.resourceDegradation.some((res: { ownerId: string }) => res.ownerId === 'char-1'),
    ).toBe(true)
  })

  it('advance_day passes through interventionSignals to production_intervene', async () => {
    await createWorld()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const r = await handleProductionManage(db(), {
      action: 'advance_day',
      worldId: WORLD,
      interventionSignals: {
        noEncounterIn24h: true,
        allYieldsStationary: true,
        moraleStableDays: 5,
      },
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.intervention.triggered).toBe(true)
    expect(body.intervention.threshold).toBe(35)
  })

  it('advance_day marks matching scheduled production_calendar events as triggered', async () => {
    await createWorld()
    await handleProductionManage(db(), {
      action: 'set_schedule',
      worldId: WORLD,
      events: [{ day: 1, eventType: 'broadcast_event', eventData: { note: 'special' } }],
    })
    const r = await handleProductionManage(db(), { action: 'advance_day', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.triggeredScheduledEvents).toHaveLength(1)
    expect(body.triggeredScheduledEvents[0].event_type).toBe('broadcast_event')
  })

  // ── get_state ────────────────────────────────────────────────────────────

  it('get_state requires worldId', async () => {
    const r = await handleProductionManage(db(), { action: 'get_state' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_state errors when advance_day has never been called for this world', async () => {
    await createWorld()
    const r = await handleProductionManage(db(), { action: 'get_state', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_state reflects the current clock, active prizes, and upcoming scheduled events', async () => {
    await createWorld()
    await handleProductionManage(db(), { action: 'advance_day', worldId: WORLD })
    await handleProductionManage(db(), {
      action: 'set_schedule',
      worldId: WORLD,
      events: [{ day: 10, eventType: 'broadcast_event' }],
    })
    const r = await handleProductionManage(db(), { action: 'get_state', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.day).toBe(1)
    expect(body.activePrizes.length).toBeGreaterThanOrEqual(1)
    expect(body.upcomingEvents).toHaveLength(1)
  })

  // ── set_schedule ─────────────────────────────────────────────────────────

  it('set_schedule requires worldId', async () => {
    const r = await handleProductionManage(db(), {
      action: 'set_schedule',
      events: [{ day: 1, eventType: 'broadcast_event' }],
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('set_schedule requires a non-empty events array', async () => {
    await createWorld()
    const r = await handleProductionManage(db(), {
      action: 'set_schedule',
      worldId: WORLD,
      events: [],
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('set_schedule inserts and can update an existing (world, day, eventType) row', async () => {
    await createWorld()
    await handleProductionManage(db(), {
      action: 'set_schedule',
      worldId: WORLD,
      events: [{ day: 5, eventType: 'broadcast_event', eventData: { a: 1 } }],
    })
    const r = await handleProductionManage(db(), {
      action: 'set_schedule',
      worldId: WORLD,
      events: [{ day: 5, eventType: 'broadcast_event', eventData: { a: 2 } }],
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.scheduled).toBe(1)
    const list = await handleProductionManage(db(), { action: 'list_events', worldId: WORLD })
    const listBody = JSON.parse(list.content[0].text)
    expect(listBody.count).toBe(1)
    expect(JSON.parse(listBody.events[0].event_data).a).toBe(2)
  })

  // ── list_events ──────────────────────────────────────────────────────────

  it('list_events requires worldId', async () => {
    const r = await handleProductionManage(db(), { action: 'list_events' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('list_events filters by fromDay', async () => {
    await createWorld()
    await handleProductionManage(db(), {
      action: 'set_schedule',
      worldId: WORLD,
      events: [
        { day: 2, eventType: 'broadcast_event' },
        { day: 10, eventType: 'broadcast_event' },
      ],
    })
    const r = await handleProductionManage(db(), {
      action: 'list_events',
      worldId: WORLD,
      fromDay: 5,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.count).toBe(1)
    expect(body.events[0].day).toBe(10)
  })
})
