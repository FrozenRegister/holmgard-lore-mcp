// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/perception-manage.ts
// Uses perception_assessments table (schema: id, seq, prev_seq, event_hash, intent_id,
// observer_id, target_ref_kind, target_ref_id, hazards, applicable_controls, blind_spots,
// disposition, reject_reason, cost_paid, capacity_remaining_after, created_at).

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'
import { executeRoll } from './math-manage'

const ACTIONS = ['assess', 'get_history', 'get_latest', 'list_observers', 'stealth_check', 'perception_contested'] as const
type PerceptionAction = typeof ACTIONS[number]
const ALIASES: Record<string, PerceptionAction> = {
  check: 'assess', perceive: 'assess', observe: 'assess', inspect: 'assess', roll: 'assess',
  history: 'get_history', past: 'get_history',
  latest: 'get_latest', current: 'get_latest', last: 'get_latest',
  observers: 'list_observers', watchers: 'list_observers',
  stealth: 'stealth_check', sneak: 'stealth_check', hide_check: 'stealth_check',
  contested: 'perception_contested', opposed_check: 'perception_contested', spot_check: 'perception_contested',
}

const InputSchema = z.object({
  action: z.string(),
  observerId: z.string().optional(),
  targetId: z.string().optional(),
  targetKind: z.enum(['room', 'encounter', 'scene']).optional().default('room'),
  rollValue: z.number().int().min(1).max(30).optional(),
  dc: z.number().int().min(1).max(30).optional().default(12),
  perceptionType: z.enum(['sight', 'hearing', 'smell', 'arcana', 'investigation', 'insight']).optional().default('sight'),
  limit: z.number().int().min(1).max(50).optional().default(20),
  // #284 — stealth_check
  stealthMode: z.enum(['active', 'passive', 'rushed', 'hiding']).optional().default('active'),
  coverType: z.string().optional(),
  windDirection: z.enum(['toward', 'away', 'crosswind', 'none']).optional().default('none'),
  distanceZone: z.enum(['core', 'edge', 'unknown']).optional().default('unknown'),
  yieldBleeding: z.boolean().optional().default(false),
  yieldCookingOrFire: z.boolean().optional().default(false),
  isNight: z.boolean().optional().default(false),
  partySize: z.number().int().min(1).optional().default(1),
  yieldStealthBonus: z.number().optional().default(0),
  predatorPerceptionBonus: z.number().optional().default(0),
  // #284 — perception_contested
  observerModifier: z.number().optional().default(0),
  actorModifier: z.number().optional().default(0),
})

// ── #284 — Stealth vs. predator-perception opposed check ────────────────────
// Both sides roll 1d20 + a caller-supplied base ability modifier (no creature
// stat-block system exists in this repo, so bonuses are accepted as explicit
// input rather than looked up) + situational modifiers from the tables below
// (transcribed from the issue). Exported so encounter-manage.ts can reuse the
// same math for its own stealth-aware resolve/check integration.

export function predatorPerceptionModifier(a: {
  distanceZone: 'core' | 'edge' | 'unknown'
  windDirection: 'toward' | 'away' | 'crosswind' | 'none'
  yieldBleeding: boolean
  yieldCookingOrFire: boolean
}): { total: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {}
  if (a.distanceZone === 'core') breakdown.distanceZone = 5
  else if (a.distanceZone === 'edge') breakdown.distanceZone = -3

  if (a.windDirection === 'toward') breakdown.wind = 4
  else if (a.windDirection === 'away') breakdown.wind = -4
  else if (a.windDirection === 'crosswind') breakdown.wind = 1

  if (a.yieldBleeding) breakdown.bleeding = 6
  if (a.yieldCookingOrFire) breakdown.cookingOrFire = 3

  const total = Object.values(breakdown).reduce((s, v) => s + v, 0)
  return { total, breakdown }
}

function coverTypeModifier(coverType: string | undefined): number {
  if (!coverType) return 0
  const t = coverType.toLowerCase()
  if (t.includes('forest')) return 3
  if (t.includes('open')) return -3
  if (t.includes('wet')) return 1
  return 0
}

const STEALTH_MODE_MODIFIERS: Record<'active' | 'passive' | 'rushed' | 'hiding', number> = {
  hiding: 2, active: 0, passive: -5, rushed: -8,
}

export function yieldStealthModifier(a: {
  stealthMode: 'active' | 'passive' | 'rushed' | 'hiding'
  coverType?: string
  isNight: boolean
  partySize: number
}): { total: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = { stealthMode: STEALTH_MODE_MODIFIERS[a.stealthMode] }

  const cover = coverTypeModifier(a.coverType)
  if (cover !== 0) breakdown.coverType = cover

  if (a.isNight) breakdown.night = 2
  if (a.partySize > 1) breakdown.partySize = -2 * (a.partySize - 1)

  const total = Object.values(breakdown).reduce((s, v) => s + v, 0)
  return { total, breakdown }
}

export type StealthOutcome = 'avoided_entirely' | 'tense_moment' | 'predator_searching' | 'yield_spotted' | 'ambushed'
export type StealthAdvantage = 'none' | 'yield' | 'predator'

// margin = yieldTotal - predatorTotal. >=5 clean avoidance; 1-4 a near-miss
// with no advantage either way; 0 a tie (predator knows something is off but
// hasn't pinned it down); negative bands hand advantage to whichever side is
// further ahead.
export function stealthOutcomeFromMargin(margin: number): { outcome: StealthOutcome; advantage: StealthAdvantage } {
  if (margin >= 5) return { outcome: 'avoided_entirely', advantage: 'none' }
  if (margin >= 1) return { outcome: 'tense_moment', advantage: 'none' }
  if (margin === 0) return { outcome: 'predator_searching', advantage: 'none' }
  if (margin >= -4) return { outcome: 'yield_spotted', advantage: 'yield' }
  return { outcome: 'ambushed', advantage: 'predator' }
}

const PERCEPTION_DESCRIPTIONS: Record<string, Record<string, string>> = {
  sight:         { success: 'You spot details others might miss.', failure: 'Nothing unusual catches your eye.', crit: 'Your sharp eyes reveal hidden secrets.' },
  hearing:       { success: 'You hear sounds that others cannot detect.', failure: 'The area seems quiet.', crit: 'You make out every whisper in the vicinity.' },
  investigation: { success: 'A thorough search reveals something of interest.', failure: 'You find nothing unusual.', crit: 'Your methodical search uncovers hidden clues.' },
  insight:       { success: 'You sense something beneath the surface.', failure: 'You cannot glean their true intentions.', crit: 'Their secrets are laid bare to you.' },
  arcana:        { success: 'You sense magical emanations.', failure: 'No obvious magical signatures detected.', crit: 'The weave of magic reveals itself to you in full.' },
  smell:         { success: 'A distinct scent catches your attention.', failure: 'Nothing unusual reaches your nose.', crit: 'Your senses paint a complete olfactory picture.' },
}

export async function handlePerceptionManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'assess': {
      if (!a.observerId || !a.targetId) return err('"observerId" and "targetId" are required')
      // #210 — Use the shared dice engine instead of ad-hoc Math.random().
      const roll = a.rollValue ?? executeRoll('1d20').total
      const succeeded = roll >= a.dc
      const isCrit = roll === 20
      const descs = PERCEPTION_DESCRIPTIONS[a.perceptionType] ?? PERCEPTION_DESCRIPTIONS.sight
      const description = isCrit ? descs.crit : (succeeded ? descs.success : descs.failure)
      const disposition = succeeded ? 'commit' : 'reject_inert'
      const seqRow = await db.prepare('SELECT MAX(seq) as max_seq FROM perception_assessments WHERE observer_id = ?').bind(a.observerId).first() as { max_seq: number | null }
      const seq = (seqRow?.max_seq ?? 0) + 1
      const id = crypto.randomUUID()
      const hazards = succeeded ? [] : [{ type: 'perception_failure', description: `DC ${a.dc} not met (rolled ${roll})` }]
      await db.prepare('INSERT INTO perception_assessments (id, seq, prev_seq, event_hash, intent_id, observer_id, target_ref_kind, target_ref_id, hazards, applicable_controls, blind_spots, disposition, reject_reason, cost_paid, capacity_remaining_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, seq, seq - 1 || null, crypto.randomUUID(), a.perceptionType, a.observerId, a.targetKind, a.targetId, JSON.stringify(hazards), JSON.stringify([a.perceptionType]), '[]', disposition, succeeded ? null : description, 1, 99, now).run()
      return ok({ success: true, actionType: 'assess', assessmentId: id, observerId: a.observerId, targetId: a.targetId, targetKind: a.targetKind, perceptionType: a.perceptionType, roll, dc: a.dc, succeeded, isCrit, description, disposition })
    }
    case 'get_history': {
      if (!a.observerId) return err('"observerId" is required')
      const { results } = await db.prepare('SELECT * FROM perception_assessments WHERE observer_id = ? ORDER BY seq DESC LIMIT ?').bind(a.observerId, a.limit).all()
      return ok({ success: true, actionType: 'get_history', observerId: a.observerId, assessments: results, count: results.length })
    }
    case 'get_latest': {
      if (!a.observerId) return err('"observerId" is required')
      let query = 'SELECT * FROM perception_assessments WHERE observer_id = ?'
      const binds: unknown[] = [a.observerId]
      if (a.targetId) { query += ' AND target_ref_id = ?'; binds.push(a.targetId) }
      const row = await db.prepare(query + ' ORDER BY seq DESC LIMIT 1').bind(...binds).first()
      if (!row) return err(`No perception assessments found for observer ${a.observerId}`)
      return ok({ success: true, actionType: 'get_latest', assessment: row })
    }
    case 'list_observers': {
      if (!a.targetId) return err('"targetId" is required')
      const { results } = await db.prepare('SELECT DISTINCT observer_id, MAX(seq) as latest_seq, MAX(created_at) as last_checked FROM perception_assessments WHERE target_ref_id = ? GROUP BY observer_id ORDER BY last_checked DESC LIMIT ?').bind(a.targetId, a.limit).all()
      return ok({ success: true, actionType: 'list_observers', targetId: a.targetId, observers: results, count: results.length })
    }
    case 'stealth_check': {
      // #210 — Use the shared dice engine for both sides of the opposed check.
      const yieldRoll = a.rollValue ?? executeRoll('1d20').total
      const predatorRoll = executeRoll('1d20').total
      const yieldMod = yieldStealthModifier({ stealthMode: a.stealthMode, coverType: a.coverType, isNight: a.isNight, partySize: a.partySize })
      const predatorMod = predatorPerceptionModifier({ distanceZone: a.distanceZone, windDirection: a.windDirection, yieldBleeding: a.yieldBleeding, yieldCookingOrFire: a.yieldCookingOrFire })
      const yieldTotal = yieldRoll + a.yieldStealthBonus + yieldMod.total
      const predatorTotal = predatorRoll + a.predatorPerceptionBonus + predatorMod.total
      const margin = yieldTotal - predatorTotal
      const { outcome, advantage } = stealthOutcomeFromMargin(margin)
      return ok({
        success: true, actionType: 'stealth_check',
        yieldRoll, predatorRoll, yieldTotal, predatorTotal, margin, outcome, advantage,
        stealthMode: a.stealthMode, distanceZone: a.distanceZone, windDirection: a.windDirection,
        yieldModifiers: yieldMod.breakdown, predatorModifiers: predatorMod.breakdown,
      })
    }
    case 'perception_contested': {
      // #210 — Use the shared dice engine for both sides of the contested check.
      const observerRoll = executeRoll('1d20').total
      const actorRoll = a.rollValue ?? executeRoll('1d20').total
      const observerTotal = observerRoll + a.observerModifier
      const actorTotal = actorRoll + a.actorModifier
      const margin = observerTotal - actorTotal
      const detected = margin >= 0
      return ok({
        success: true, actionType: 'perception_contested',
        observerId: a.observerId ?? null, targetId: a.targetId ?? null,
        observerRoll, actorRoll, observerTotal, actorTotal, margin, detected,
      })
    }
  }
}
