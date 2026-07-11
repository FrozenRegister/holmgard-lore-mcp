// Direct handler tests for broadcast-manage (#287)
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach, afterEach, vi } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handleBroadcastManage, runProductionIntervene, createPendingVote } from '../rpg/handlers/broadcast-manage'

describe('handleBroadcastManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)
  const WORLD = 'world-1'

  async function createWorld(id = WORLD) {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare('INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, 'Test World', 'abc123', 100, 100, now, now).run()
    await env.RPG_DB.prepare('INSERT OR IGNORE INTO world_state (world_id) VALUES (?)').bind(id).run()
  }

  async function createCharacter(id: string, name = 'Yune') {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare("INSERT OR IGNORE INTO characters (id, name, stats, hp, max_hp, ac, level, created_at, updated_at) VALUES (?, ?, '{}', 10, 10, 10, 1, ?, ?)")
      .bind(id, name, now, now).run()
  }

  it('returns guiding error for unknown action', async () => {
    const r = await handleBroadcastManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  // ── audience_pulse / trigger_event ──────────────────────────────────────

  it('audience_pulse requires worldId, characterId, and eventType', async () => {
    const r = await handleBroadcastManage(db(), { action: 'audience_pulse' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('audience_pulse errors on an unknown eventType', async () => {
    await createWorld()
    await createCharacter('char-1')
    const r = await handleBroadcastManage(db(), { action: 'audience_pulse', worldId: WORLD, characterId: 'char-1', eventType: 'nonsense' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('audience_pulse applies a simple delta starting from baseline 50', async () => {
    await createWorld()
    await createCharacter('char-2')
    const r = await handleBroadcastManage(db(), { action: 'audience_pulse', worldId: WORLD, characterId: 'char-2', eventType: 'killed_predator' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.approval).toBe(62)
    expect(body.delta).toBe(12)
  })

  it('audience_pulse requires a direction for polarizing events', async () => {
    await createWorld()
    await createCharacter('char-3')
    const r = await handleBroadcastManage(db(), { action: 'audience_pulse', worldId: WORLD, characterId: 'char-3', eventType: 'betrayed_yield' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('audience_pulse applies the positive or negative branch of a polarizing event', async () => {
    await createWorld()
    await createCharacter('char-4')
    const pos = await handleBroadcastManage(db(), { action: 'audience_pulse', worldId: WORLD, characterId: 'char-4', eventType: 'betrayed_yield', direction: 'positive' })
    expect(JSON.parse(pos.content[0].text).delta).toBe(5)
    const neg = await handleBroadcastManage(db(), { action: 'audience_pulse', worldId: WORLD, characterId: 'char-4', eventType: 'betrayed_yield', direction: 'negative' })
    expect(JSON.parse(neg.content[0].text).delta).toBe(-10)
  })

  it('audience_pulse clamps approval to [0, 100]', async () => {
    await createWorld()
    await createCharacter('char-5')
    await handleBroadcastManage(db(), { action: 'audience_pulse', worldId: WORLD, characterId: 'char-5', eventType: 'reached_extraction' })
    await handleBroadcastManage(db(), { action: 'audience_pulse', worldId: WORLD, characterId: 'char-5', eventType: 'reached_extraction' })
    const r = await handleBroadcastManage(db(), { action: 'audience_pulse', worldId: WORLD, characterId: 'char-5', eventType: 'reached_extraction' })
    const body = JSON.parse(r.content[0].text)
    expect(body.approval).toBe(100)
  })

  it('trigger_event is an alias sharing the exact same logic as audience_pulse', async () => {
    await createWorld()
    await createCharacter('char-6')
    const r = await handleBroadcastManage(db(), { action: 'trigger_event', worldId: WORLD, characterId: 'char-6', eventType: 'gave_up' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.actionType).toBe('trigger_event')
    expect(body.approval).toBe(40)
  })

  // ── resolve_vote ─────────────────────────────────────────────────────────

  it('resolve_vote requires winningOption', async () => {
    const r = await handleBroadcastManage(db(), { action: 'resolve_vote' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('resolve_vote requires worldId and voteType when no voteId is given', async () => {
    const r = await handleBroadcastManage(db(), { action: 'resolve_vote', winningOption: 'yes' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('resolve_vote errors for a nonexistent voteId', async () => {
    const r = await handleBroadcastManage(db(), { action: 'resolve_vote', voteId: 'nope', winningOption: 'yes' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('resolve_vote creates-and-resolves fan_favorite in one call', async () => {
    await createWorld()
    const r = await handleBroadcastManage(db(), { action: 'resolve_vote', worldId: WORLD, voteType: 'fan_favorite', day: 3, winningOption: 'char-1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.voteType).toBe('fan_favorite')
    expect(body.consequence.targetYieldId).toBe('char-1')
    expect(body.consequence.crateBias).toEqual(['food', 'medical'])
  })

  it('resolve_vote resolves an existing pending vote by voteId', async () => {
    await createWorld()
    const voteId = await createPendingVote(env.RPG_DB, WORLD, 'hazard_boost', 5)
    const r = await handleBroadcastManage(db(), { action: 'resolve_vote', voteId, winningOption: 'sector-4' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.voteType).toBe('hazard_boost')
    expect(body.consequence.targetSector).toBe('sector-4')
    expect(body.consequence.encounterModifierBoost).toBe(8)
  })

  it('resolve_vote computes mercy_kill consequences for yes and no', async () => {
    await createWorld()
    const yes = await handleBroadcastManage(db(), { action: 'resolve_vote', worldId: WORLD, voteType: 'mercy_kill', winningOption: 'yes' })
    expect(JSON.parse(yes.content[0].text).consequence.decision).toBe('drone_strike')
    const no = await handleBroadcastManage(db(), { action: 'resolve_vote', worldId: WORLD, voteType: 'mercy_kill', winningOption: 'no' })
    const noBody = JSON.parse(no.content[0].text)
    expect(noBody.consequence.decision).toBe('spared')
    expect(noBody.consequence.medicalSupplyBan).toBe(true)
  })

  it('resolve_vote computes prize_drop_location and showdown consequences', async () => {
    await createWorld()
    const location = await handleBroadcastManage(db(), { action: 'resolve_vote', worldId: WORLD, voteType: 'prize_drop_location', winningOption: '12,34' })
    expect(JSON.parse(location.content[0].text).consequence.coordinatesRevealed).toBe('12,34')

    const showdown = await handleBroadcastManage(db(), { action: 'resolve_vote', worldId: WORLD, voteType: 'showdown', winningOption: 'yield-a, yield-b' })
    expect(JSON.parse(showdown.content[0].text).consequence.pairedYields).toEqual(['yield-a', 'yield-b'])
  })

  // ── production_intervene ─────────────────────────────────────────────────

  it('production_intervene requires worldId', async () => {
    const r = await handleBroadcastManage(db(), { action: 'production_intervene' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('production_intervene rolls against the base threshold and reports no trigger on a high roll', async () => {
    await createWorld()
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const r = await handleBroadcastManage(db(), { action: 'production_intervene', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.threshold).toBe(15)
    expect(body.triggered).toBe(false)
  })

  it('production_intervene applies all signal boosts and caps the threshold at 95', async () => {
    await createWorld()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const r = await handleBroadcastManage(db(), {
      action: 'production_intervene', worldId: WORLD,
      noEncounterIn24h: true, allYieldsStationary: true, moraleStableDays: 5, daysSinceLastIntervention: 100,
      targetCharacterId: 'char-x', details: 'quiet day',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.threshold).toBe(95)
    expect(body.triggered).toBe(true)
    expect(body.interventionType).toBeDefined()
    expect(body.targetCharacterId).toBe('char-x')
  })

  it('runProductionIntervene is directly usable by production-manage and updates world_state.last_intervention_at', async () => {
    await createWorld()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const result = await runProductionIntervene(env.RPG_DB, WORLD, 1, {})
    expect(result.triggered).toBe(true)
    const state = await env.RPG_DB.prepare('SELECT last_intervention_at FROM world_state WHERE world_id = ?').bind(WORLD).first() as { last_intervention_at: string | null }
    expect(state.last_intervention_at).not.toBeNull()
  })

  // ── celeste_moment ───────────────────────────────────────────────────────

  it('celeste_moment requires eventType', async () => {
    const r = await handleBroadcastManage(db(), { action: 'celeste_moment' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('celeste_moment returns a templated broadcast for every known eventType', async () => {
    for (const eventType of ['predator_kill', 'betrayal', 'injury', 'death', 'extraction', 'first_aid']) {
      const r = await handleBroadcastManage(db(), { action: 'celeste_moment', eventType, characterId: 'yune', details: 'a sharpened stick' })
      const body = JSON.parse(r.content[0].text)
      expect(body.success).toBe(true)
      expect(body.broadcastText).toContain('yune')
      expect(typeof body.celesteTone).toBe('string')
    }
  })

  it('celeste_moment falls back to a generic template for an unknown eventType', async () => {
    const r = await handleBroadcastManage(db(), { action: 'celeste_moment', eventType: 'weird_thing' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.celesteTone).toBe('neutral')
    expect(body.characterId).toBeNull()
  })

  // ── get_state ────────────────────────────────────────────────────────────

  it('get_state requires worldId', async () => {
    const r = await handleBroadcastManage(db(), { action: 'get_state' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_state returns approvals, active votes, interventions, and flavor viewership', async () => {
    await createWorld()
    await createCharacter('char-7')
    await handleBroadcastManage(db(), { action: 'audience_pulse', worldId: WORLD, characterId: 'char-7', eventType: 'killed_predator' })
    await createPendingVote(env.RPG_DB, WORLD, 'fan_favorite', 3)
    vi.spyOn(Math, 'random').mockReturnValue(0)
    await runProductionIntervene(env.RPG_DB, WORLD, 1, {})

    const r = await handleBroadcastManage(db(), { action: 'get_state', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.approvals).toHaveLength(1)
    expect(body.activeVotes).toHaveLength(1)
    expect(body.recentInterventions).toHaveLength(1)
    expect(body.viewership.totalViewers).toBeGreaterThan(0)
    expect(body.viewership.productionMood).toBe('satisfied')
  })

  it('get_state reports a restless production mood when average approval is low', async () => {
    await createWorld()
    await createCharacter('char-8')
    await handleBroadcastManage(db(), { action: 'audience_pulse', worldId: WORLD, characterId: 'char-8', eventType: 'attempted_suicide' })
    const r = await handleBroadcastManage(db(), { action: 'get_state', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.viewership.productionMood).toBe('restless')
  })

  it('get_state reports a neutral/default viewership and mood when no approvals exist yet', async () => {
    await createWorld()
    const r = await handleBroadcastManage(db(), { action: 'get_state', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.approvals).toEqual([])
    expect(body.viewership.productionMood).toBe('watchful')
  })
})
