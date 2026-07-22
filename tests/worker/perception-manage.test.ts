// Direct handler tests for perception-manage (not registered in rpgToolRegistry)
import { describe } from './support/helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach, afterEach, vi } from 'vitest'
import { setupRpgDb } from './support/setup-d1'
import {
  handlePerceptionManage,
  predatorPerceptionModifier,
  yieldStealthModifier,
  stealthOutcomeFromMargin,
} from '@/rpg/handlers/perception-manage'

describe('handlePerceptionManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)

  it('returns guiding error for unknown action', async () => {
    const r = await handlePerceptionManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  it('assess requires observerId and targetId', async () => {
    const r = await handlePerceptionManage(db(), { action: 'assess', observerId: 'obs-1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('assess succeeds with roll meeting dc', async () => {
    const r = await handlePerceptionManage(db(), { action: 'assess', observerId: 'obs-1', targetId: 'room-1', rollValue: 20, dc: 12, perceptionType: 'sight' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.succeeded).toBe(true)
    expect(body.isCrit).toBe(true)
  })

  it('assess fails when roll below dc', async () => {
    const r = await handlePerceptionManage(db(), { action: 'assess', observerId: 'obs-2', targetId: 'room-2', rollValue: 5, dc: 15, perceptionType: 'hearing' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.succeeded).toBe(false)
  })

  it('assess uses random roll when rollValue not provided', async () => {
    const r = await handlePerceptionManage(db(), { action: 'assess', observerId: 'obs-3', targetId: 'room-3', perceptionType: 'investigation' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.roll).toBeGreaterThanOrEqual(1)
  })

  it('assess works with different perception types', async () => {
    for (const type of ['smell', 'arcana', 'insight']) {
      const r = await handlePerceptionManage(db(), { action: 'assess', observerId: 'obs-4', targetId: 'target-1', rollValue: 18, perceptionType: type as any })
      const body = JSON.parse(r.content[0].text)
      expect(body.success).toBe(true)
    }
  })

  it('assess uses unknown perception type fallback', async () => {
    // rollValue=20 with default dc=12 always succeeds
    const r = await handlePerceptionManage(db(), { action: 'assess', observerId: 'obs-5', targetId: 'enc-1', targetKind: 'encounter', rollValue: 20 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('get_history requires observerId', async () => {
    const r = await handlePerceptionManage(db(), { action: 'get_history' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_history returns assessments for observer', async () => {
    await handlePerceptionManage(db(), { action: 'assess', observerId: 'obs-6', targetId: 'room-6', rollValue: 15 })
    const r = await handlePerceptionManage(db(), { action: 'get_history', observerId: 'obs-6' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBeGreaterThanOrEqual(1)
  })

  it('get_latest requires observerId', async () => {
    const r = await handlePerceptionManage(db(), { action: 'get_latest' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_latest returns not found when no assessments', async () => {
    const r = await handlePerceptionManage(db(), { action: 'get_latest', observerId: 'nobody' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_latest returns most recent assessment', async () => {
    await handlePerceptionManage(db(), { action: 'assess', observerId: 'obs-7', targetId: 'room-7', rollValue: 15 })
    const r = await handlePerceptionManage(db(), { action: 'get_latest', observerId: 'obs-7' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.assessment).toBeDefined()
  })

  it('get_latest filters by targetId', async () => {
    await handlePerceptionManage(db(), { action: 'assess', observerId: 'obs-8', targetId: 'target-8', rollValue: 12 })
    const r = await handlePerceptionManage(db(), { action: 'get_latest', observerId: 'obs-8', targetId: 'target-8' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('list_observers requires targetId', async () => {
    const r = await handlePerceptionManage(db(), { action: 'list_observers' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('list_observers returns observers for target', async () => {
    await handlePerceptionManage(db(), { action: 'assess', observerId: 'obs-9', targetId: 'shared-target', rollValue: 10 })
    const r = await handlePerceptionManage(db(), { action: 'list_observers', targetId: 'shared-target' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBeGreaterThanOrEqual(1)
  })

  // ── #284 — predatorPerceptionModifier ───────────────────────────────────

  it('predatorPerceptionModifier: core distance zone adds +5', () => {
    const { total, breakdown } = predatorPerceptionModifier({ distanceZone: 'core', windDirection: 'none', yieldBleeding: false, yieldCookingOrFire: false })
    expect(total).toBe(5)
    expect(breakdown.distanceZone).toBe(5)
  })

  it('predatorPerceptionModifier: edge distance zone subtracts -3', () => {
    const { total } = predatorPerceptionModifier({ distanceZone: 'edge', windDirection: 'none', yieldBleeding: false, yieldCookingOrFire: false })
    expect(total).toBe(-3)
  })

  it('predatorPerceptionModifier: unknown distance zone contributes nothing', () => {
    const { total, breakdown } = predatorPerceptionModifier({ distanceZone: 'unknown', windDirection: 'none', yieldBleeding: false, yieldCookingOrFire: false })
    expect(total).toBe(0)
    expect(breakdown.distanceZone).toBeUndefined()
  })

  it('predatorPerceptionModifier: wind toward adds +4, away subtracts -4, crosswind adds +1', () => {
    expect(predatorPerceptionModifier({ distanceZone: 'unknown', windDirection: 'toward', yieldBleeding: false, yieldCookingOrFire: false }).total).toBe(4)
    expect(predatorPerceptionModifier({ distanceZone: 'unknown', windDirection: 'away', yieldBleeding: false, yieldCookingOrFire: false }).total).toBe(-4)
    expect(predatorPerceptionModifier({ distanceZone: 'unknown', windDirection: 'crosswind', yieldBleeding: false, yieldCookingOrFire: false }).total).toBe(1)
    expect(predatorPerceptionModifier({ distanceZone: 'unknown', windDirection: 'none', yieldBleeding: false, yieldCookingOrFire: false }).total).toBe(0)
  })

  it('predatorPerceptionModifier: yield bleeding adds +6, cooking/fire adds +3, both stack', () => {
    expect(predatorPerceptionModifier({ distanceZone: 'unknown', windDirection: 'none', yieldBleeding: true, yieldCookingOrFire: false }).total).toBe(6)
    expect(predatorPerceptionModifier({ distanceZone: 'unknown', windDirection: 'none', yieldBleeding: false, yieldCookingOrFire: true }).total).toBe(3)
    expect(predatorPerceptionModifier({ distanceZone: 'unknown', windDirection: 'none', yieldBleeding: true, yieldCookingOrFire: true }).total).toBe(9)
  })

  // ── #284 — yieldStealthModifier ─────────────────────────────────────────

  it('yieldStealthModifier: stealth mode modifiers (hiding +2, active +0, passive -5, rushed -8)', () => {
    expect(yieldStealthModifier({ stealthMode: 'hiding', isNight: false, partySize: 1 }).total).toBe(2)
    expect(yieldStealthModifier({ stealthMode: 'active', isNight: false, partySize: 1 }).total).toBe(0)
    expect(yieldStealthModifier({ stealthMode: 'passive', isNight: false, partySize: 1 }).total).toBe(-5)
    expect(yieldStealthModifier({ stealthMode: 'rushed', isNight: false, partySize: 1 }).total).toBe(-8)
  })

  it('yieldStealthModifier: cover type forest-like +3, open-like -3, wet-like +1, unrecognized/none 0', () => {
    expect(yieldStealthModifier({ stealthMode: 'active', coverType: 'dense forest', isNight: false, partySize: 1 }).total).toBe(3)
    expect(yieldStealthModifier({ stealthMode: 'active', coverType: 'open field', isNight: false, partySize: 1 }).total).toBe(-3)
    expect(yieldStealthModifier({ stealthMode: 'active', coverType: 'wet marsh', isNight: false, partySize: 1 }).total).toBe(1)
    expect(yieldStealthModifier({ stealthMode: 'active', coverType: 'rocky outcrop', isNight: false, partySize: 1 }).total).toBe(0)
    expect(yieldStealthModifier({ stealthMode: 'active', isNight: false, partySize: 1 }).total).toBe(0)
  })

  it('yieldStealthModifier: night adds +2, party size subtracts -2 per member beyond 1', () => {
    expect(yieldStealthModifier({ stealthMode: 'active', isNight: true, partySize: 1 }).total).toBe(2)
    expect(yieldStealthModifier({ stealthMode: 'active', isNight: false, partySize: 3 }).total).toBe(-4)
    expect(yieldStealthModifier({ stealthMode: 'active', isNight: true, partySize: 3 }).breakdown.partySize).toBe(-4)
  })

  // ── #284 — stealthOutcomeFromMargin ─────────────────────────────────────

  it('stealthOutcomeFromMargin covers every outcome band', () => {
    expect(stealthOutcomeFromMargin(5)).toEqual({ outcome: 'avoided_entirely', advantage: 'none' })
    expect(stealthOutcomeFromMargin(100)).toEqual({ outcome: 'avoided_entirely', advantage: 'none' })
    expect(stealthOutcomeFromMargin(4)).toEqual({ outcome: 'tense_moment', advantage: 'none' })
    expect(stealthOutcomeFromMargin(1)).toEqual({ outcome: 'tense_moment', advantage: 'none' })
    expect(stealthOutcomeFromMargin(0)).toEqual({ outcome: 'predator_searching', advantage: 'none' })
    expect(stealthOutcomeFromMargin(-1)).toEqual({ outcome: 'yield_spotted', advantage: 'yield' })
    expect(stealthOutcomeFromMargin(-4)).toEqual({ outcome: 'yield_spotted', advantage: 'yield' })
    expect(stealthOutcomeFromMargin(-5)).toEqual({ outcome: 'ambushed', advantage: 'predator' })
    expect(stealthOutcomeFromMargin(-100)).toEqual({ outcome: 'ambushed', advantage: 'predator' })
  })

  // ── #284 — stealth_check action ─────────────────────────────────────────

  it('stealth_check: clean avoidance when yield total clears predator total by 5+', async () => {
    // #210 — dice now come from the crypto-backed executeRoll engine, so we
    // can't mock Math.random to force a specific predatorRoll. Instead we
    // set yieldStealthBonus high enough that any predator roll (1-20) + the
    // predator's modifiers (-3 distance edge + -4 wind away = -7) still
    // leaves a margin >= 5. yieldRoll=20, yieldMod=2 (hiding) + (-3 edge) +
    // (-4 away) = 20+2-7 = 15. Predator max = 20 + (-7) = 13. Margin >= 2.
    // To guarantee margin >= 5, add yieldStealthBonus=10: 20+10+2-7=25 vs
    // 20-7=13 → margin=12.
    const r = await handlePerceptionManage(db(), {
      action: 'stealth_check', rollValue: 20, stealthMode: 'hiding', distanceZone: 'edge', windDirection: 'away',
      yieldStealthBonus: 10,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.yieldRoll).toBe(20)
    expect(body.outcome).toBe('avoided_entirely')
    expect(body.advantage).toBe('none')
    expect(body.yieldModifiers.stealthMode).toBe(2)
    expect(body.predatorModifiers.distanceZone).toBe(-3)
  })

  it('stealth_check: ambushed when predator total clears yield total by 5+', async () => {
    // #210 — dice now come from the crypto-backed executeRoll engine. Set
    // predatorPerceptionBonus high enough that any predator roll (1-20) +
    // modifiers (core +5, toward +4, bleeding +6, cooking +3 = +18) + bonus
    // 10 = 20+18+10=48 vs yieldRoll=1, rushed -8, partySize 3 (-4) = 1-8-4=-11.
    // Margin = -11-48 = -59, well into 'ambushed' territory.
    const r = await handlePerceptionManage(db(), {
      action: 'stealth_check', rollValue: 1, stealthMode: 'rushed', distanceZone: 'core', windDirection: 'toward',
      yieldBleeding: true, yieldCookingOrFire: true, partySize: 3, predatorPerceptionBonus: 10,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.outcome).toBe('ambushed')
    expect(body.advantage).toBe('predator')
  })

  it('stealth_check: uses a random yield roll when rollValue is omitted', async () => {
    const r = await handlePerceptionManage(db(), { action: 'stealth_check' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.yieldRoll).toBeGreaterThanOrEqual(1)
    expect(body.predatorRoll).toBeGreaterThanOrEqual(1)
  })

  // ── #284 — perception_contested action ──────────────────────────────────

  it('perception_contested: detected true when observer total ties or beats actor total', async () => {
    // #210 — dice now come from the crypto-backed executeRoll engine. Set
    // observerModifier high enough that any observer roll (1-20) + 30 >= any
    // actor roll (1-20) + 0. Max actor = 20, min observer = 1+30=31. Margin
    // >= 11, always detected.
    const r = await handlePerceptionManage(db(), { action: 'perception_contested', rollValue: 1, observerModifier: 30, actorModifier: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.detected).toBe(true)
  })

  it('perception_contested: detected false when actor total exceeds observer total', async () => {
    // #210 — dice now come from the crypto-backed executeRoll engine. Set
    // actorModifier high enough that any actor roll (1-20) + 30 > any
    // observer roll (1-20) + 0. Max observer = 20, min actor = 1+30=31.
    // Margin = 20-31 = -11, never detected.
    const r = await handlePerceptionManage(db(), { action: 'perception_contested', rollValue: 20, observerModifier: 0, actorModifier: 30 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.detected).toBe(false)
  })

  it('perception_contested: observerId/targetId default to null when omitted', async () => {
    const r = await handlePerceptionManage(db(), { action: 'perception_contested' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.observerId).toBeNull()
    expect(body.targetId).toBeNull()
  })

  it('perception_contested: passes through observerId/targetId when supplied', async () => {
    const r = await handlePerceptionManage(db(), { action: 'perception_contested', observerId: 'obs-10', targetId: 'target-10' })
    const body = JSON.parse(r.content[0].text)
    expect(body.observerId).toBe('obs-10')
    expect(body.targetId).toBe('target-10')
  })
})
