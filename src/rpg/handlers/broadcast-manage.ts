// Broadcast & Production Intervention Layer (#287) —
// rpg({ sub: "broadcast", action: "..." }).
//
// Design decisions made explicitly (not fully specified by the issue —
// documented here and in the PR/changelog rather than guessed silently):
//
// - `audience_pulse` and `trigger_event` are implemented as literal aliases
//   of the same underlying "apply one approval-affecting event to one
//   character" logic. The issue describes them almost identically ("roll
//   audience approval shift based on recent events" vs. "force a broadcast
//   event") and gives no mechanical difference between them, so inventing a
//   distinct "ambient random shift" mechanic for one of them would be
//   guessing content the issue never specified.
// - `resolve_vote` creates-and-resolves a vote in one call when no existing
//   `voteId` is given, rather than requiring a separate "open a vote"
//   action — the issue's own action list has no such action, and per its
//   explicit Non-Goal ("Audience simulation... narrator decides what the
//   audience would vote for; MCP just resolves the outcome") this handler
//   never tallies votes itself. The caller supplies `winningOption`; this
//   handler only computes the mechanical consequence of that option.
// - `production_intervene`'s formula inputs (no-encounter-in-24h, all-Yields-
//   stationary, morale-stability streak) require signals this handler can't
//   derive on its own (no persisted "last encounter" log, no character
//   position/activity tracking) — matching #280/#284's precedent, these are
//   accepted as explicit caller-supplied booleans/numbers rather than
//   invented auto-detection.
// - Intervention type selection (Drone Harassment, Predator Release, etc.)
//   is uniform-random among the 8 listed types — the issue gives narrative
//   trigger conditions for each, not selection weights, so there's no
//   numeric basis to pick unevenly.
// - `mercy_kill` votes never actually mutate a character's HP/state — this
//   handler returns the mechanical decision (`drone_strike`/`spared`) for
//   the caller to apply via character_manage, matching the established
//   restraint of never taking an irreversible action from inside a
//   resolution/mechanics handler.
// - Viewership metrics (total viewers, demographic split, ad revenue) are
//   flavor dressing with a small approval-driven wobble, not a simulated
//   audience — this matches the issue's own Non-Goal ("Audience simulation"
//   is explicitly out of scope).

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['audience_pulse', 'resolve_vote', 'production_intervene', 'celeste_moment', 'get_state', 'trigger_event'] as const
type BroadcastAction = typeof ACTIONS[number]
const ALIASES: Record<string, BroadcastAction> = {
  pulse: 'audience_pulse', approval_shift: 'audience_pulse',
  vote: 'resolve_vote', tally_vote: 'resolve_vote',
  intervene: 'production_intervene', check_intervention: 'production_intervene',
  celeste: 'celeste_moment', narrate: 'celeste_moment',
  state: 'get_state', viewership: 'get_state',
  event: 'trigger_event', force_event: 'trigger_event',
}

const VOTE_TYPES = ['fan_favorite', 'mercy_kill', 'hazard_boost', 'prize_drop_location', 'showdown'] as const

const INTERVENTION_TYPES = [
  'drone_harassment', 'predator_release', 'audio_broadcast', 'fake_prize_drop',
  'perimeter_pulse', 'celeste_spotlight', 'medical_intervention', 'sabotage',
] as const

interface ApprovalEvent {
  delta?: number
  positive?: number
  negative?: number
  note: string
}

// Transcribed from the issue's "Audience Approval" table. Entries with both
// positive/negative are the polarizing events the issue itself flags as
// "vote decides direction" — these require a `direction` param.
const APPROVAL_EVENTS: Record<string, ApprovalEvent> = {
  survived_encounter: { delta: 3, note: 'Basic competency.' },
  killed_predator: { delta: 12, note: 'Rare. Celebrated.' },
  shared_resources: { delta: 8, note: 'Humanity in the wild.' },
  administered_first_aid: { delta: 7, note: 'Competence + compassion.' },
  betrayed_yield: { positive: 5, negative: -10, note: 'Polarizing. Vote decides direction.' },
  cried_on_camera: { delta: 4, note: 'Vulnerability moment.' },
  monologue: { delta: 6, note: 'Backstory content.' },
  killed_yield: { positive: 15, negative: -20, note: 'Most polarizing event. Vote swing.' },
  refused_to_help: { delta: -8, note: 'Cold narrative.' },
  stole_from_corpse: { delta: -3, note: 'Expected, but still ugly.' },
  clever_solution: { delta: 5, note: 'Survivor narrative.' },
  gave_up: { delta: -10, note: 'Quitter narrative.' },
  attempted_suicide: { delta: -25, note: 'Bad television. Production intervenes.' },
  reached_extraction: { delta: 20, note: 'Ultimate success.' },
  left_someone_behind: { positive: 10, negative: -15, note: 'Ruthless winner vs. betrayer.' },
}

const CELESTE_TEMPLATES: Record<string, { tone: string; reaction: string; approvalShift: number; trendingPhrase: string; template: (yieldName: string, details: string) => string }> = {
  predator_kill: {
    tone: 'reverent', reaction: 'roaring', approvalShift: 12, trendingPhrase: 'SPEAR GIRL',
    template: (y, d) => `Ladies and gentlemen, you have just witnessed something extraordinary. ${y} has done what no one expected. ${d} We'll have replays. We'll have analysis. But right now, what you need to know is: this is trending. This is real. And it just changed the game.`,
  },
  betrayal: {
    tone: 'scandalized', reaction: 'gasping', approvalShift: -8, trendingPhrase: 'THE KNIFE',
    template: (y, d) => `Oh. Oh, this is the moment we live for. ${y}. ${d} The Accord did not see that coming. Neither, I suspect, did the person standing next to them.`,
  },
  injury: {
    tone: 'concerned', reaction: 'tense', approvalShift: 3, trendingPhrase: 'HOLD ON',
    template: (y, d) => `Stay with us. ${y} is down. ${d} Production is watching closely. We all are.`,
  },
  death: {
    tone: 'somber', reaction: 'silent', approvalShift: -2, trendingPhrase: 'REST NOW',
    template: (y, d) => `We ask for a moment of quiet. ${y} will not be joining us at the extraction point. ${d} The Preserve does not forgive. It never has.`,
  },
  extraction: {
    tone: 'triumphant', reaction: 'roaring', approvalShift: 20, trendingPhrase: 'SHE MADE IT',
    template: (y, d) => `The boat. THE BOAT. ${y} has reached extraction. ${d} Thirty days. Against everything Gotland could throw at them. Let them hear you.`,
  },
  first_aid: {
    tone: 'warm', reaction: 'moved', approvalShift: 7, trendingPhrase: 'STEADY HANDS',
    template: (y, d) => `In a place built to turn strangers into rivals, ${y} just chose otherwise. ${d} Humanity, on live broadcast, to nine hundred million people.`,
  },
}

function pickApprovalTemplate(eventType: string) {
  return CELESTE_TEMPLATES[eventType] ?? {
    tone: 'neutral', reaction: 'watching', approvalShift: 0, trendingPhrase: 'THE PRESERVE',
    template: (y: string, d: string) => `Cameras roll on ${y}. ${d}`,
  }
}

const InputSchema = z.object({
  action: z.string(),
  worldId: z.string().optional(),
  characterId: z.string().optional(),
  // audience_pulse / trigger_event
  eventType: z.string().optional(),
  direction: z.enum(['positive', 'negative']).optional(),
  // resolve_vote
  voteId: z.string().optional(),
  voteType: z.enum(VOTE_TYPES).optional(),
  day: z.number().int().min(0).optional().default(0),
  options: z.array(z.string()).optional().default([]),
  winningOption: z.string().optional(),
  // production_intervene
  noEncounterIn24h: z.boolean().optional().default(false),
  allYieldsStationary: z.boolean().optional().default(false),
  moraleStableDays: z.number().int().min(0).optional().default(0),
  daysSinceLastIntervention: z.number().int().min(0).optional().default(0),
  targetCharacterId: z.string().optional(),
  // celeste_moment
  details: z.string().optional().default(''),
})

type ApprovalEventResult =
  | { error: true; message: string }
  | { error: false; characterId: string; eventType: string; delta: number; approval: number; note: string }

async function applyApprovalEvent(db: D1Database, worldId: string, characterId: string, eventType: string, direction: 'positive' | 'negative' | undefined, now: string): Promise<ApprovalEventResult> {
  const event = APPROVAL_EVENTS[eventType]
  if (!event) return { error: true, message: `Unknown eventType: ${eventType}` }
  let delta: number
  if (event.delta !== undefined) {
    delta = event.delta
  } else {
    if (!direction) return { error: true, message: `eventType "${eventType}" is polarizing and requires a "direction" ("positive" or "negative")` }
    delta = direction === 'positive' ? event.positive! : event.negative!
  }

  const existing = await db.prepare('SELECT approval FROM broadcast_approval WHERE character_id = ?').bind(characterId).first() as { approval: number } | null
  const newApproval = Math.max(0, Math.min(100, (existing?.approval ?? 50) + delta))
  await db.prepare('INSERT INTO broadcast_approval (character_id, world_id, approval, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(character_id) DO UPDATE SET approval = excluded.approval, updated_at = excluded.updated_at')
    .bind(characterId, worldId, newApproval, now).run()

  return { error: false, characterId, eventType, delta, approval: newApproval, note: event.note }
}

export interface ProductionInterveneResult {
  triggered: boolean
  roll: number
  threshold: number
  interventionId?: string
  interventionType?: string
  targetCharacterId?: string | null
}

// Core intervention-check logic, shared by the `production_intervene` action
// and production-manage.ts's advance_day (#283 integration contract step 6 —
// "Check for production intervention → call broadcast.production_intervene").
export async function runProductionIntervene(
  db: D1Database, worldId: string, day: number,
  signals: { noEncounterIn24h?: boolean; allYieldsStationary?: boolean; moraleStableDays?: number; daysSinceLastIntervention?: number; targetCharacterId?: string; details?: string } = {},
): Promise<ProductionInterveneResult> {
  const now = new Date().toISOString()
  let threshold = 15
  if (signals.noEncounterIn24h) threshold += 5
  if (signals.allYieldsStationary) threshold += 5
  if ((signals.moraleStableDays ?? 0) >= 3) threshold += 10
  threshold += 5 * (signals.daysSinceLastIntervention ?? 0)
  threshold = Math.min(95, threshold)

  const roll = Math.floor(Math.random() * 100) + 1
  const triggered = roll <= threshold
  if (!triggered) return { triggered: false, roll, threshold }

  const interventionType = INTERVENTION_TYPES[Math.floor(Math.random() * INTERVENTION_TYPES.length)]
  const id = crypto.randomUUID()
  await db.prepare('INSERT INTO broadcast_interventions (id, world_id, day, intervention_type, target_character_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, worldId, day, interventionType, signals.targetCharacterId ?? null, signals.details || null, now).run()
  await db.prepare('UPDATE world_state SET last_intervention_at = ? WHERE world_id = ?').bind(now, worldId).run()

  return { triggered: true, roll, threshold, interventionId: id, interventionType, targetCharacterId: signals.targetCharacterId ?? null }
}

// Creates (but does not resolve) a pending vote — used by production-manage's
// advance_day on its every-3-days audience-vote tick. Resolution requires a
// narrator-supplied winningOption (see file header), which isn't available
// during an automatic daily tick, so this only opens the vote.
export async function createPendingVote(db: D1Database, worldId: string, voteType: typeof VOTE_TYPES[number], day: number): Promise<string> {
  const now = new Date().toISOString()
  const voteId = crypto.randomUUID()
  await db.prepare('INSERT INTO broadcast_votes (id, world_id, vote_type, day, options, resolved, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
    .bind(voteId, worldId, voteType, day, JSON.stringify([]), now).run()
  return voteId
}

// voteType is typed to the closed VOTE_TYPES union (not `string`) so this
// switch is exhaustive over every value the schema/DB can ever hand it —
// a `default` fallback here would be permanently dead code, since every
// caller's voteType is either Zod-validated at the API boundary or read
// back from a row this same validation originally wrote.
function resolveVoteConsequence(voteType: typeof VOTE_TYPES[number], winningOption: string): Record<string, unknown> {
  switch (voteType) {
    case 'fan_favorite':
      return { targetYieldId: winningOption, crateBias: ['food', 'medical'], note: 'Targeted crate with luxury items + medical supplies.' }
    case 'mercy_kill': {
      const yes = winningOption.toLowerCase() === 'yes'
      return yes
        ? { decision: 'drone_strike', note: 'Yield is euthanized by Production drone.' }
        : { decision: 'spared', medicalSupplyBan: true, note: 'Yield continues, but Production stops dropping medical supplies near them.' }
    }
    case 'hazard_boost':
      return { targetSector: winningOption, encounterModifierBoost: 8, durationHours: 48 }
    case 'prize_drop_location':
      return { coordinatesRevealed: winningOption, note: 'Forced convergence — all Yields know the location.' }
    case 'showdown':
      return { pairedYields: winningOption.split(',').map(s => s.trim()).filter(Boolean), note: 'Both receive identical intel leading to the same coordinates, timed to arrive simultaneously.' }
  }
}

export async function handleBroadcastManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'audience_pulse':
    case 'trigger_event': {
      if (!a.worldId || !a.characterId || !a.eventType) return err('"worldId", "characterId", and "eventType" are required')
      const result = await applyApprovalEvent(db, a.worldId, a.characterId, a.eventType, a.direction, now)
      if (result.error) return err(result.message)
      return ok({ success: true, actionType: match.matched, ...result, error: undefined })
    }
    case 'resolve_vote': {
      if (!a.winningOption) return err('"winningOption" is required')
      let voteId = a.voteId
      let voteType = a.voteType
      if (voteId) {
        const existing = await db.prepare('SELECT * FROM broadcast_votes WHERE id = ?').bind(voteId).first() as Record<string, unknown> | null
        if (!existing) return err(`Vote not found: ${voteId}`)
        voteType = existing.vote_type as typeof voteType
      } else {
        if (!a.worldId || !voteType) return err('"worldId" and "voteType" are required when "voteId" is not given')
        voteId = crypto.randomUUID()
        await db.prepare('INSERT INTO broadcast_votes (id, world_id, vote_type, day, options, resolved, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
          .bind(voteId, a.worldId, voteType, a.day, JSON.stringify(a.options), now).run()
      }
      const consequence = resolveVoteConsequence(voteType!, a.winningOption)
      await db.prepare('UPDATE broadcast_votes SET result = ?, resolved = 1, resolved_at = ? WHERE id = ?')
        .bind(JSON.stringify({ winningOption: a.winningOption, consequence }), now, voteId).run()
      return ok({ success: true, actionType: 'resolve_vote', voteId, voteType, winningOption: a.winningOption, consequence })
    }
    case 'production_intervene': {
      if (!a.worldId) return err('"worldId" is required')
      const result = await runProductionIntervene(db, a.worldId, a.day, {
        noEncounterIn24h: a.noEncounterIn24h, allYieldsStationary: a.allYieldsStationary,
        moraleStableDays: a.moraleStableDays, daysSinceLastIntervention: a.daysSinceLastIntervention,
        targetCharacterId: a.targetCharacterId, details: a.details,
      })
      return ok({ success: true, actionType: 'production_intervene', ...result })
    }
    case 'celeste_moment': {
      if (!a.eventType) return err('"eventType" is required')
      const tmpl = pickApprovalTemplate(a.eventType)
      const yieldName = a.characterId ?? 'the Yield'
      const broadcastText = tmpl.template(yieldName, a.details)
      return ok({
        success: true, actionType: 'celeste_moment', eventType: a.eventType, characterId: a.characterId ?? null,
        celesteTone: tmpl.tone, audienceReaction: tmpl.reaction, approvalShift: tmpl.approvalShift,
        trendingPhrase: tmpl.trendingPhrase, broadcastText,
      })
    }
    case 'get_state': {
      if (!a.worldId) return err('"worldId" is required')
      const { results: approvals } = await db.prepare('SELECT character_id, approval, updated_at FROM broadcast_approval WHERE world_id = ? ORDER BY approval DESC').bind(a.worldId).all()
      const { results: votes } = await db.prepare('SELECT * FROM broadcast_votes WHERE world_id = ? AND resolved = 0 ORDER BY day').bind(a.worldId).all()
      const { results: interventions } = await db.prepare('SELECT * FROM broadcast_interventions WHERE world_id = ? ORDER BY day DESC LIMIT 10').bind(a.worldId).all()

      const avgApproval = approvals.length > 0
        ? approvals.reduce((s, r) => s + ((r as { approval: number }).approval), 0) / approvals.length
        : 50
      const trendingYields = (approvals as Array<{ character_id: string; approval: number }>).slice(0, 3).map(r => r.character_id)
      const totalViewers = Math.round(800_000_000 + avgApproval * 1_000_000)

      return ok({
        success: true, actionType: 'get_state', worldId: a.worldId,
        approvals, activeVotes: votes, recentInterventions: interventions,
        viewership: {
          totalViewers,
          peakConcurrent: Math.round(totalViewers * 1.1),
          demographicSplit: { AccordGeneral: '62%', SovereignElite: '18%', International: '15%', BlackMarket: '5%' },
          trendingYields,
          productionMood: avgApproval >= 60 ? 'satisfied' : avgApproval >= 35 ? 'watchful' : 'restless',
        },
      })
    }
  }
}
