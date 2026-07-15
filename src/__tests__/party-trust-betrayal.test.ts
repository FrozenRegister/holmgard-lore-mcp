// Direct handler tests for party-manage's #285 additions (trust_shift,
// resolve_conflict, betrayal_check, morale_roll, watch_rotation, and the
// enriched get/form/get_state aliases). Pre-existing party CRUD actions
// already have integration coverage in rpg-tools.test.ts.
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach, afterEach, vi } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handlePartyManage } from '../rpg/handlers/party-manage'

describe('handlePartyManage — Party Trust & Betrayal (#285)', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)

  async function createParty(name = 'The Preserve Cohort') {
    const r = await handlePartyManage(db(), { action: 'create', name })
    return JSON.parse(r.content[0].text).partyId as string
  }

  it('form aliases to create', async () => {
    const r = await handlePartyManage(db(), { action: 'form', name: 'Formed Party' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.actionType).toBe('create')
  })

  it('get_state aliases to get and enriches the response with trust/cohesion/watchOrder', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'get_state', partyId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.actionType).toBe('get')
    expect(body.trust).toEqual([])
    expect(body.cohesion).toBe('stable')
    expect(body.watchOrder).toEqual([])
  })

  // ── trust_shift ──────────────────────────────────────────────────────────

  it('trust_shift requires partyId, fromCharacterId, and towardCharacterId', async () => {
    const r = await handlePartyManage(db(), { action: 'trust_shift' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('trust_shift requires delta or eventType', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'trust_shift', partyId, fromCharacterId: 'a', towardCharacterId: 'b' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('trust_shift errors on an unknown eventType', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'trust_shift', partyId, fromCharacterId: 'a', towardCharacterId: 'b', eventType: 'nonsense' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('trust_shift applies a named event delta, starting from the default baseline of 50', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'trust_shift', partyId, fromCharacterId: 'a', towardCharacterId: 'b', eventType: 'saved_from_predator' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.trustScore).toBe(65)
    expect(body.note).toContain('predator')
  })

  it('trust_shift applies an explicit delta and clamps to [0, 100]', async () => {
    const partyId = await createParty()
    await handlePartyManage(db(), { action: 'trust_shift', partyId, fromCharacterId: 'a', towardCharacterId: 'b', delta: 1000 })
    const r = await handlePartyManage(db(), { action: 'trust_shift', partyId, fromCharacterId: 'a', towardCharacterId: 'b', delta: 5 })
    const body = JSON.parse(r.content[0].text)
    expect(body.trustScore).toBe(100)
    expect(body.note).toBeNull()
  })

  it('trust_shift clamps a large negative delta to 0', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'trust_shift', partyId, fromCharacterId: 'a', towardCharacterId: 'b', eventType: 'left_behind' })
    const body = JSON.parse(r.content[0].text)
    expect(body.trustScore).toBe(0)
  })

  // ── resolve_conflict ─────────────────────────────────────────────────────

  it('resolve_conflict requires partyId, characterAId, and characterBId', async () => {
    const r = await handlePartyManage(db(), { action: 'resolve_conflict' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('resolve_conflict defaults to baseline trust (50/50) for a pair with no history', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'resolve_conflict', partyId, characterAId: 'a', characterBId: 'b' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.avgTrust).toBe(50)
  })

  it('resolve_conflict picks the high-trust band (>=60) deterministically — always grudging_truce, no randomness', async () => {
    const partyId = await createParty()
    await handlePartyManage(db(), { action: 'trust_shift', partyId, fromCharacterId: 'a', towardCharacterId: 'b', delta: 20 })
    await handlePartyManage(db(), { action: 'trust_shift', partyId, fromCharacterId: 'b', towardCharacterId: 'a', delta: 20 })
    const r = await handlePartyManage(db(), { action: 'resolve_conflict', partyId, characterAId: 'a', characterBId: 'b' })
    const body = JSON.parse(r.content[0].text)
    expect(body.avgTrust).toBe(70)
    expect(body.outcome).toBe('grudging_truce')
  })

  it('resolve_conflict mid band (40-59): both random branches (stolen_resources / grudging_truce)', async () => {
    const partyId = await createParty()
    await handlePartyManage(db(), { action: 'trust_shift', partyId, fromCharacterId: 'a', towardCharacterId: 'b', delta: -5 })
    await handlePartyManage(db(), { action: 'trust_shift', partyId, fromCharacterId: 'b', towardCharacterId: 'a', delta: -5 })

    vi.spyOn(Math, 'random').mockReturnValue(0)
    const low = await handlePartyManage(db(), { action: 'resolve_conflict', partyId, characterAId: 'a', characterBId: 'b' })
    const lowBody = JSON.parse(low.content[0].text)
    expect(lowBody.avgTrust).toBe(45)
    expect(lowBody.outcome).toBe('stolen_resources')

    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    const high = await handlePartyManage(db(), { action: 'resolve_conflict', partyId, characterAId: 'a', characterBId: 'b' })
    expect(JSON.parse(high.content[0].text).outcome).toBe('grudging_truce')
  })

  it('resolve_conflict mid-low band (20-39): both random branches (fight / stolen_resources)', async () => {
    const partyId = await createParty()
    await handlePartyManage(db(), { action: 'trust_shift', partyId, fromCharacterId: 'a', towardCharacterId: 'b', delta: -20 })
    await handlePartyManage(db(), { action: 'trust_shift', partyId, fromCharacterId: 'b', towardCharacterId: 'a', delta: -20 })

    vi.spyOn(Math, 'random').mockReturnValue(0)
    const low = await handlePartyManage(db(), { action: 'resolve_conflict', partyId, characterAId: 'a', characterBId: 'b' })
    const lowBody = JSON.parse(low.content[0].text)
    expect(lowBody.avgTrust).toBe(30)
    expect(lowBody.outcome).toBe('fight')

    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    const high = await handlePartyManage(db(), { action: 'resolve_conflict', partyId, characterAId: 'a', characterBId: 'b' })
    expect(JSON.parse(high.content[0].text).outcome).toBe('stolen_resources')
  })

  it('resolve_conflict low band (<20): both random branches (exile / fight)', async () => {
    const partyId = await createParty()
    await handlePartyManage(db(), { action: 'trust_shift', partyId, fromCharacterId: 'a', towardCharacterId: 'b', delta: -45 })
    await handlePartyManage(db(), { action: 'trust_shift', partyId, fromCharacterId: 'b', towardCharacterId: 'a', delta: -45 })

    vi.spyOn(Math, 'random').mockReturnValue(0)
    const low = await handlePartyManage(db(), { action: 'resolve_conflict', partyId, characterAId: 'a', characterBId: 'b' })
    const lowBody = JSON.parse(low.content[0].text)
    expect(lowBody.avgTrust).toBe(5)
    expect(lowBody.outcome).toBe('exile')

    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    const high = await handlePartyManage(db(), { action: 'resolve_conflict', partyId, characterAId: 'a', characterBId: 'b' })
    expect(JSON.parse(high.content[0].text).outcome).toBe('fight')
  })

  // ── betrayal_check ───────────────────────────────────────────────────────

  it('betrayal_check requires partyId', async () => {
    const r = await handlePartyManage(db(), { action: 'betrayal_check' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('betrayal_check reports loyal/not-likely for a party with no trust history at all', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'betrayal_check', partyId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.betrayalLikely).toBe(false)
    expect(body.classification).toBe('loyal')
  })

  it('betrayal_check finds the lowest-trust pair and reports likely at baseline multipliers when trust is very low', async () => {
    const partyId = await createParty()
    await handlePartyManage(db(), { action: 'trust_shift', partyId, fromCharacterId: 'adebayo', towardCharacterId: 'yune', delta: -50 })
    const r = await handlePartyManage(db(), { action: 'betrayal_check', partyId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.likelyActor).toBe('adebayo')
    expect(body.likelyTarget).toBe('yune')
    expect(body.likelihood).toBe(100)
    expect(body.betrayalLikely).toBe(true)
    expect(body.classification).toBe('likely')
  })

  it('betrayal_check applies desperation multipliers and reports the dominant motivation', async () => {
    const partyId = await createParty()
    await handlePartyManage(db(), { action: 'trust_shift', partyId, fromCharacterId: 'adebayo', towardCharacterId: 'yune', delta: -30 })
    const r = await handlePartyManage(db(), {
      action: 'betrayal_check', partyId, resourceDesperation: 1.5, injuryDesperation: 1, audiencePressure: 1, extractionPressure: 1,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.motivation).toBe('resource_desperation')
    expect(body.likelihood).toBeCloseTo(80 * 1.5, 5)
  })

  it('betrayal_check reports a non-resource dominant motivation when another multiplier is highest', async () => {
    const partyId = await createParty()
    await handlePartyManage(db(), { action: 'trust_shift', partyId, fromCharacterId: 'adebayo', towardCharacterId: 'yune', delta: -30 })
    const r = await handlePartyManage(db(), {
      action: 'betrayal_check', partyId, resourceDesperation: 1, injuryDesperation: 1, audiencePressure: 1.5, extractionPressure: 1,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.motivation).toBe('audience_pressure')
  })

  it('betrayal_check reports the "possible" classification band', async () => {
    const partyId = await createParty()
    await handlePartyManage(db(), { action: 'trust_shift', partyId, fromCharacterId: 'a', towardCharacterId: 'b', delta: -8 })
    const r = await handlePartyManage(db(), { action: 'betrayal_check', partyId })
    const body = JSON.parse(r.content[0].text)
    expect(body.likelihood).toBe(58)
    expect(body.classification).toBe('possible')
  })

  it('betrayal_check reports the "unlikely" classification band', async () => {
    const partyId = await createParty()
    await handlePartyManage(db(), { action: 'trust_shift', partyId, fromCharacterId: 'a', towardCharacterId: 'b', delta: 20 })
    const r = await handlePartyManage(db(), { action: 'betrayal_check', partyId })
    const body = JSON.parse(r.content[0].text)
    expect(body.likelihood).toBe(30)
    expect(body.classification).toBe('unlikely')
  })

  // ── morale_roll ──────────────────────────────────────────────────────────

  it('morale_roll requires partyId', async () => {
    const r = await handlePartyManage(db(), { action: 'morale_roll' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('morale_roll errors for a nonexistent party', async () => {
    const r = await handlePartyManage(db(), { action: 'morale_roll', partyId: 'nope', customDelta: 5 })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('morale_roll requires customDelta or stressorType', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'morale_roll', partyId })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('morale_roll errors on an unknown stressorType', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'morale_roll', partyId, stressorType: 'nonsense' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('morale_roll applies a named stressor and reports the new cohesion tier', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'morale_roll', partyId, stressorType: 'yield_death' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    // Default party morale is 62 (migration default); -5 -> 57, which falls
    // in the 40-59 "strained" band (-1 roll modifier), not "stable".
    expect(body.morale).toBe(57)
    expect(body.cohesion).toBe('strained')
    expect(body.rollModifier).toBe(-1)
    expect(body.dissolved).toBe(false)
  })

  it('morale_roll applies an explicit customDelta and clamps to [0, 100]', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'morale_roll', partyId, customDelta: 1000 })
    const body = JSON.parse(r.content[0].text)
    expect(body.morale).toBe(100)
    expect(body.cohesion).toBe('high')
    expect(body.rollModifier).toBe(1)
  })

  it('morale_roll reports strained/breaking/collapse tiers and dissolved:true under 20', async () => {
    const partyId = await createParty()
    const strained = await handlePartyManage(db(), { action: 'morale_roll', partyId, customDelta: -10 }) // 62 -> 52 (strained)
    expect(JSON.parse(strained.content[0].text).cohesion).toBe('strained')

    const breaking = await handlePartyManage(db(), { action: 'morale_roll', partyId, customDelta: -15 }) // 52 -> 37 (breaking)
    const breakingBody = JSON.parse(breaking.content[0].text)
    expect(breakingBody.cohesion).toBe('breaking')
    expect(breakingBody.dissolved).toBe(false)

    const collapse = await handlePartyManage(db(), { action: 'morale_roll', partyId, customDelta: -20 }) // 37 -> 17 (collapse)
    const collapseBody = JSON.parse(collapse.content[0].text)
    expect(collapseBody.cohesion).toBe('collapse')
    expect(collapseBody.dissolved).toBe(true)
  })

  // ── watch_rotation ───────────────────────────────────────────────────────

  it('watch_rotation requires partyId', async () => {
    const r = await handlePartyManage(db(), { action: 'watch_rotation', watchers: [{ characterId: 'a' }] })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('watch_rotation requires a non-empty watchers array', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'watch_rotation', partyId, watchers: [] })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('watch_rotation errors for a nonexistent party', async () => {
    const r = await handlePartyManage(db(), { action: 'watch_rotation', partyId: 'nope', watchers: [{ characterId: 'a' }] })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('watch_rotation reports a pass, a fail, and a critical-failure (asleep) result, and sets current_watch', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), {
      action: 'watch_rotation', partyId,
      watchers: [
        { characterId: 'watcher-pass', conModifier: 10, rollValue: 5 },
        { characterId: 'watcher-fail', conModifier: 0, rollValue: 5 },
        { characterId: 'watcher-asleep', conModifier: 10, rollValue: 1 },
      ],
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.watchOrder).toEqual(['watcher-pass', 'watcher-fail', 'watcher-asleep'])
    expect(body.results[0].passed).toBe(true)
    expect(body.results[1].passed).toBe(false)
    expect(body.results[1].criticalFail).toBe(false)
    expect(body.results[2].criticalFail).toBe(true)
    expect(body.results[2].effect).toContain('asleep')

    const state = await handlePartyManage(db(), { action: 'get_state', partyId })
    const stateBody = JSON.parse(state.content[0].text)
    expect(stateBody.party.current_watch).toBe('watcher-pass')
    expect(stateBody.watchOrder).toEqual(['watcher-pass', 'watcher-fail', 'watcher-asleep'])
  })

  it('watch_rotation uses a random roll when rollValue is omitted', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'watch_rotation', partyId, watchers: [{ characterId: 'watcher-random' }] })
    const body = JSON.parse(r.content[0].text)
    expect(body.results[0].roll).toBeGreaterThanOrEqual(1)
  })

  // ── cohesion_check ──────────────────────────────────────────────────────

  it('cohesion_check requires partyId', async () => {
    const r = await handlePartyManage(db(), { action: 'cohesion_check' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('cohesion_check errors for a nonexistent party', async () => {
    const r = await handlePartyManage(db(), { action: 'cohesion_check', partyId: 'nope' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('cohesion_check returns fracture tier (roll <= 4)', async () => {
    const partyId = await createParty()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const r = await handlePartyManage(db(), { action: 'cohesion_check', partyId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.total).toBeLessThanOrEqual(4)
    expect(body.tier).toBe('fracture')
    expect(body.outcome).toBeTruthy()
    expect(['betrayal', 'abandonment', 'violence', 'mutual']).toContain(body.fractureType)
  })

  it('cohesion_check returns strain tier (5-8)', async () => {
    const partyId = await createParty()
    vi.spyOn(Math, 'random').mockReturnValue(0.3)
    const r = await handlePartyManage(db(), { action: 'cohesion_check', partyId })
    const body = JSON.parse(r.content[0].text)
    expect(body.tier).toBe('strain')
    expect(body.total).toBeGreaterThanOrEqual(5)
    expect(body.total).toBeLessThanOrEqual(8)
  })

  it('cohesion_check returns stable tier (9-12)', async () => {
    const partyId = await createParty()
    vi.spyOn(Math, 'random').mockReturnValue(0.55)
    const r = await handlePartyManage(db(), { action: 'cohesion_check', partyId })
    const body = JSON.parse(r.content[0].text)
    expect(body.tier).toBe('stable')
    expect(body.total).toBeGreaterThanOrEqual(9)
    expect(body.total).toBeLessThanOrEqual(12)
  })

  it('cohesion_check returns strong tier (13-16)', async () => {
    const partyId = await createParty()
    vi.spyOn(Math, 'random').mockReturnValue(0.75)
    const r = await handlePartyManage(db(), { action: 'cohesion_check', partyId })
    const body = JSON.parse(r.content[0].text)
    expect(body.tier).toBe('strong')
    expect(body.total).toBeGreaterThanOrEqual(13)
    expect(body.total).toBeLessThanOrEqual(16)
  })

  it('cohesion_check returns deepened tier (roll > 16)', async () => {
    const partyId = await createParty()
    vi.spyOn(Math, 'random').mockReturnValue(1)
    const r = await handlePartyManage(db(), { action: 'cohesion_check', partyId })
    const body = JSON.parse(r.content[0].text)
    expect(body.tier).toBe('deepened')
    expect(body.total).toBeGreaterThan(16)
  })

  it('cohesion_check applies stress and cooperation modifiers', async () => {
    const partyId = await createParty()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const r = await handlePartyManage(db(), { action: 'cohesion_check', partyId, stressModifier: -5, cooperationModifier: 3 })
    const body = JSON.parse(r.content[0].text)
    expect(body.total).toBe(body.roll - 5 + 3)
  })

  it('cohesion_check updates party cohesion_score', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'cohesion_check', partyId })
    const body = JSON.parse(r.content[0].text)
    expect(body.cohesionScore).toBeGreaterThanOrEqual(0)
    expect(body.cohesionScore).toBeLessThanOrEqual(100)
  })

  it('cohesion_check weighted fracture outcomes: betrayal ~40%', async () => {
    const partyId = await createParty()
    let betrayalCount = 0
    for (let i = 0; i < 100; i++) {
      vi.spyOn(Math, 'random').mockReturnValueOnce(i / 1000) // Force fracture
      vi.spyOn(Math, 'random').mockReturnValueOnce(i / 100 + 0.001) // Outcome random
      const r = await handlePartyManage(db(), { action: 'cohesion_check', partyId })
      const body = JSON.parse(r.content[0].text)
      if (body.fractureType === 'betrayal') betrayalCount++
    }
    expect(betrayalCount).toBeGreaterThan(20)
    expect(betrayalCount).toBeLessThan(60)
  })

  // ── group_break ─────────────────────────────────────────────────────────

  it('group_break requires partyId', async () => {
    const r = await handlePartyManage(db(), { action: 'group_break' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('group_break errors for a nonexistent party', async () => {
    const r = await handlePartyManage(db(), { action: 'group_break', partyId: 'nope' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('group_break requires method enum', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'group_break', partyId, method: 'invalid' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('group_break sets party status to broken', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'group_break', partyId, method: 'mutual' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.status).toBe('broken')
  })

  it('group_break with method:abandonment records outcome', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'group_break', partyId, method: 'abandonment' })
    const body = JSON.parse(r.content[0].text)
    expect(body.method).toBe('abandonment')
    expect(body.outcome).toContain('left')
  })

  it('group_break with method:betrayal records outcome', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'group_break', partyId, method: 'betrayal' })
    const body = JSON.parse(r.content[0].text)
    expect(body.method).toBe('betrayal')
    expect(body.outcome).toContain('betray')
  })

  it('group_break with method:death records outcome', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'group_break', partyId, method: 'death' })
    const body = JSON.parse(r.content[0].text)
    expect(body.method).toBe('death')
    expect(body.outcome).toContain('death')
  })

  it('group_break with method:mutual records outcome', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'group_break', partyId, method: 'mutual' })
    const body = JSON.parse(r.content[0].text)
    expect(body.method).toBe('mutual')
    expect(body.outcome).toContain('mutual')
  })

  it('group_break deletes party_members', async () => {
    const partyId = await createParty()
    // Verify party exists
    const state = await handlePartyManage(db(), { action: 'get', partyId })
    expect(JSON.parse(state.content[0].text).success).toBe(true)
    // Break the party
    const r = await handlePartyManage(db(), { action: 'group_break', partyId, method: 'mutual' })
    expect(JSON.parse(r.content[0].text).success).toBe(true)
    // Verify members are removed (memberCount should be 0)
    expect(JSON.parse(r.content[0].text).memberCount).toBe(0)
  })

  // ── cohesion_shift ──────────────────────────────────────────────────────

  it('cohesion_shift requires partyId and eventType', async () => {
    const r = await handlePartyManage(db(), { action: 'cohesion_shift' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('cohesion_shift errors for a nonexistent party', async () => {
    const r = await handlePartyManage(db(), { action: 'cohesion_shift', partyId: 'nope', eventType: 'shared_kill' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('cohesion_shift errors on an unknown eventType', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'cohesion_shift', partyId, eventType: 'nonsense' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('cohesion_shift shared_kill applies +8', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'cohesion_shift', partyId, eventType: 'shared_kill' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.cohesionScore).toBe(58)
  })

  it('cohesion_shift saved_member applies +12', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'cohesion_shift', partyId, eventType: 'saved_member' })
    const body = JSON.parse(r.content[0].text)
    expect(body.cohesionScore).toBe(62)
  })

  it('cohesion_shift supply_theft_discovered applies -12 and clamps', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'cohesion_shift', partyId, eventType: 'supply_theft_discovered' })
    const body = JSON.parse(r.content[0].text)
    expect(body.cohesionScore).toBe(38)
  })

  it('cohesion_shift starvation applies -4', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'cohesion_shift', partyId, eventType: 'starvation' })
    const body = JSON.parse(r.content[0].text)
    expect(body.cohesionScore).toBe(46)
  })

  it('cohesion_shift partner_injured applies -6', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'cohesion_shift', partyId, eventType: 'partner_injured' })
    const body = JSON.parse(r.content[0].text)
    expect(body.cohesionScore).toBe(44)
  })

  it('cohesion_shift moral_disagreement applies -8', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'cohesion_shift', partyId, eventType: 'moral_disagreement' })
    const body = JSON.parse(r.content[0].text)
    expect(body.cohesionScore).toBe(42)
  })

  it('cohesion_shift voluntary_share applies +5', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'cohesion_shift', partyId, eventType: 'voluntary_share' })
    const body = JSON.parse(r.content[0].text)
    expect(body.cohesionScore).toBe(55)
  })

  it('cohesion_shift joint_discovery applies +5', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'cohesion_shift', partyId, eventType: 'joint_discovery' })
    const body = JSON.parse(r.content[0].text)
    expect(body.cohesionScore).toBe(55)
  })

  it('cohesion_shift successful_trade applies +4', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'cohesion_shift', partyId, eventType: 'successful_trade' })
    const body = JSON.parse(r.content[0].text)
    expect(body.cohesionScore).toBe(54)
  })

  it('cohesion_shift audience_interference applies -5', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'cohesion_shift', partyId, eventType: 'audience_interference' })
    const body = JSON.parse(r.content[0].text)
    expect(body.cohesionScore).toBe(45)
  })

  it('cohesion_shift predator_attack applies -6', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'cohesion_shift', partyId, eventType: 'predator_attack' })
    const body = JSON.parse(r.content[0].text)
    expect(body.cohesionScore).toBe(44)
  })

  it('cohesion_shift clamps cohesion_score to [0, 100]', async () => {
    const partyId = await createParty()
    // Apply multiple positive shifts to hit ceiling
    for (let i = 0; i < 10; i++) {
      await handlePartyManage(db(), { action: 'cohesion_shift', partyId, eventType: 'saved_member' })
    }
    const r = await handlePartyManage(db(), { action: 'cohesion_shift', partyId, eventType: 'saved_member' })
    const body = JSON.parse(r.content[0].text)
    expect(body.cohesionScore).toBe(100)
  })

  it('cohesion_shift returns event note', async () => {
    const partyId = await createParty()
    const r = await handlePartyManage(db(), { action: 'cohesion_shift', partyId, eventType: 'shared_kill' })
    const body = JSON.parse(r.content[0].text)
    expect(body.eventNote).toBeTruthy()
  })
})
