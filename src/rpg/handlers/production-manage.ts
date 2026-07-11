// Production Cycle Framework (#283) — rpg({ sub: "production", action: "..." }).
// The 30-day clock the encounter system (#280) and everything downstream of
// it hangs on: perimeter contraction, hazard escalation, weather, prize
// drops, audience votes, and the extraction window.
//
// Design decisions made explicitly (not fully specified by the issue —
// documented here and in the PR/changelog rather than guessed silently):
//
// - `advance_day` recomputes perimeter radius and hazard level fresh from the
//   day number each call (`radius = 28 - 4*min(5, floor(day/5))`) rather than
//   tracking incremental contraction state — this is simpler and can't drift
//   or double-apply if advance_day is ever called out of order.
// - The per-day aggression-shift/new-predator-type narrative notes in the
//   issue's hazard table are returned as descriptive text only. This handler
//   does NOT rewrite `encounter_types.aggression` automatically — that's a
//   narrator/predator-roster edit via encounter.add_type, not something a
//   daily clock tick should silently mutate.
// - Corpse decomposition (the #283 integration contract's step "tick corpse
//   decomposition → call corpse.decompose") is deliberately NOT wired here.
//   #288 (Corpse Ecology) hasn't shipped yet in this batch — it's next.
//   advance_day's response includes `corpseDecomposition: null` with a note,
//   not a silent no-op, so callers can see this is pending, not broken.
// - production.encounter_modifier (hazard + weather) is computed and stored
//   on world_state but is NOT automatically read by encounter-manage's
//   resolveEncounterCore in this PR — wiring that dependency into an
//   already-shipped handler is out of scope here. A caller who wants it
//   applied fetches production.get_state and passes the modifier along
//   manually. Documented as a follow-up, not a gap introduced silently.
// - Prize drops are deterministic-per-day (the issue says "daily, variable"
//   meaning variable *contents*, not variable *occurrence* — there's no
//   drop-probability number given anywhere in the issue).
// - Audience vote type each 3-day tick is picked uniformly at random among
//   the 5 listed types — the issue doesn't give a rotation or weighting.

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'
import { handleResourceManage, tickAllOwnersDegradation, type DegradeResult } from './resource-manage'
import { runProductionIntervene, createPendingVote, type ProductionInterveneResult } from './broadcast-manage'

const ACTIONS = ['advance_day', 'get_state', 'set_schedule', 'list_events'] as const
type ProductionAction = typeof ACTIONS[number]
const ALIASES: Record<string, ProductionAction> = {
  tick: 'advance_day', next_day: 'advance_day', advance: 'advance_day',
  state: 'get_state', status: 'get_state',
  schedule: 'set_schedule', configure: 'set_schedule',
  events: 'list_events', upcoming: 'list_events',
}

const EVENT_TYPES = ['perimeter_contract', 'prize_drop', 'hazard_escalate', 'audience_vote', 'extraction_open', 'broadcast_event'] as const
const VOTE_TYPES = ['fan_favorite', 'mercy_kill', 'hazard_boost', 'prize_drop_location', 'showdown'] as const

const InputSchema = z.object({
  action: z.string(),
  worldId: z.string().optional(),
  daysToAdvance: z.number().int().min(1).max(30).optional().default(1),
  skipCrateDrop: z.boolean().optional().default(false),
  nearBog: z.boolean().optional().default(false),
  itemCount: z.number().int().min(1).max(10).optional().default(3),
  fromDay: z.number().int().min(0).optional().default(0),
  events: z.array(z.object({
    day: z.number().int().min(0),
    eventType: z.enum(EVENT_TYPES),
    eventData: z.record(z.string(), z.unknown()).optional(),
  })).optional().default([]),
  interventionSignals: z.object({
    noEncounterIn24h: z.boolean().optional(),
    allYieldsStationary: z.boolean().optional(),
    moraleStableDays: z.number().int().min(0).optional(),
    daysSinceLastIntervention: z.number().int().min(0).optional(),
    targetCharacterId: z.string().optional(),
  }).optional().default({}),
})

function computeHazard(day: number): { level: string; modifier: number; note: string } {
  if (day <= 6) return { level: 'standard', modifier: 0, note: 'Standard biome threat levels.' }
  if (day <= 13) return { level: 'elevated', modifier: 3, note: '+3% to all encounter thresholds.' }
  if (day <= 20) return { level: 'high', modifier: 6, note: '+6%. Predators become more aggressive (curious -> hunting -> territorial -> starving).' }
  if (day <= 27) return { level: 'severe', modifier: 10, note: '+10%. New predator type introduced. Perimeter patrols active.' }
  return { level: 'critical', modifier: 15, note: '+15%. Tarrasque activity increases, extraction window open.' }
}

function computePerimeterRadius(day: number): number {
  const contractions = Math.min(5, Math.floor(day / 5))
  return 28 - 4 * contractions
}

function computeExtractionWindow(day: number): string {
  if (day > 30) return 'closed_final'
  if (day >= 28) return 'open'
  return 'closed'
}

function rollWeather(nearBog: boolean): { weather: string; encounterModifier: number; movementModifier: number; fog: boolean } {
  const roll = Math.floor(Math.random() * 20) + 1
  let weather: string, encounterModifier: number, movementModifier: number
  if (roll <= 5) { weather = 'storm'; encounterModifier = -8; movementModifier = -2 }
  else if (roll <= 10) { weather = 'rain'; encounterModifier = -5; movementModifier = -1 }
  else if (roll <= 15) { weather = 'overcast'; encounterModifier = 0; movementModifier = 0 }
  else { weather = 'clear'; encounterModifier = 3; movementModifier = 0 }
  const fogChance = nearBog ? 0.25 : 0.15
  const fog = Math.random() < fogChance
  return { weather, encounterModifier, movementModifier, fog }
}

export async function handleProductionManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'advance_day': {
      if (!a.worldId) return err('"worldId" is required')
      const world = await db.prepare('SELECT width, height FROM worlds WHERE id = ?').bind(a.worldId).first() as { width: number; height: number } | null
      if (!world) return err(`World not found: ${a.worldId}`)

      const stateRow = await db.prepare('SELECT * FROM world_state WHERE world_id = ?').bind(a.worldId).first() as Record<string, unknown> | null
      const currentDay = (stateRow?.production_day as number) ?? 0
      const day = currentDay + a.daysToAdvance

      const hazard = computeHazard(day)
      const perimeterRadius = computePerimeterRadius(day)
      const extractionWindow = computeExtractionWindow(day)
      const weatherRoll = rollWeather(a.nearBog)
      const encounterModifier = hazard.modifier + weatherRoll.encounterModifier

      if (stateRow) {
        await db.prepare('UPDATE world_state SET production_day = ?, perimeter_radius = ?, weather = ?, hazard_level = ?, encounter_modifier = ?, extraction_window = ?, last_advanced_at = ? WHERE world_id = ?')
          .bind(day, perimeterRadius, weatherRoll.weather, hazard.level, encounterModifier, extractionWindow, now, a.worldId).run()
      } else {
        await db.prepare('INSERT INTO world_state (world_id, production_day, perimeter_radius, weather, hazard_level, encounter_modifier, extraction_window, last_advanced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(a.worldId, day, perimeterRadius, weatherRoll.weather, hazard.level, encounterModifier, extractionWindow, now).run()
      }

      // Scheduled production_calendar events for this day (narrator-authored
      // custom events, e.g. 'broadcast_event') — mark triggered, alongside
      // the built-in periodic mechanics computed above.
      const { results: scheduled } = await db.prepare('SELECT * FROM production_calendar WHERE world_id = ? AND day = ? AND triggered = 0').bind(a.worldId, day).all()
      if (scheduled.length > 0) {
        await db.prepare('UPDATE production_calendar SET triggered = 1, triggered_at = ? WHERE world_id = ? AND day = ? AND triggered = 0').bind(now, a.worldId, day).run()
      }

      let crateDrop: Record<string, unknown> | null = null
      if (!a.skipCrateDrop) {
        const crateRes = await handleResourceManage(env, { action: 'crate_drop', worldId: a.worldId, day, itemCount: a.itemCount })
        crateDrop = JSON.parse(crateRes.content[0].text)
      }

      const resourceDegradation: DegradeResult[] = await tickAllOwnersDegradation(db, a.worldId, day)

      let pendingVoteId: string | null = null
      // day is always >= 1 here (currentDay starts at 0, daysToAdvance has a
      // schema-enforced minimum of 1), so no separate day > 0 guard is needed.
      if (day % 3 === 0) {
        const voteType = VOTE_TYPES[Math.floor(Math.random() * VOTE_TYPES.length)]
        pendingVoteId = await createPendingVote(db, a.worldId, voteType, day)
      }

      const intervention: ProductionInterveneResult = await runProductionIntervene(db, a.worldId, day, a.interventionSignals)

      const { results: upcomingEvents } = await db.prepare('SELECT day, event_type, event_data FROM production_calendar WHERE world_id = ? AND day > ? AND triggered = 0 ORDER BY day LIMIT 10').bind(a.worldId, day).all()

      return ok({
        success: true, actionType: 'advance_day', worldId: a.worldId, day,
        perimeterRadius, hazardLevel: hazard.level, hazardNote: hazard.note, encounterModifier,
        weather: weatherRoll.weather, fog: weatherRoll.fog, movementModifier: weatherRoll.movementModifier,
        extractionWindow, crateDrop, resourceDegradation, pendingVoteId, intervention,
        corpseDecomposition: null, corpseDecompositionNote: 'Deferred — #288 (Corpse Ecology) has not shipped yet.',
        triggeredScheduledEvents: scheduled, upcomingEvents,
      })
    }
    case 'get_state': {
      if (!a.worldId) return err('"worldId" is required')
      const stateRow = await db.prepare('SELECT * FROM world_state WHERE world_id = ?').bind(a.worldId).first() as Record<string, unknown> | null
      if (!stateRow) return err(`No production state for world ${a.worldId} — call advance_day at least once`)
      const { results: activePrizes } = await db.prepare('SELECT * FROM crate_drops WHERE world_id = ? AND claimed = 0 ORDER BY day DESC').bind(a.worldId).all()
      const { results: upcomingEvents } = await db.prepare('SELECT day, event_type, event_data FROM production_calendar WHERE world_id = ? AND day > ? AND triggered = 0 ORDER BY day LIMIT 10').bind(a.worldId, stateRow.production_day).all()
      return ok({
        success: true, actionType: 'get_state', worldId: a.worldId,
        day: stateRow.production_day, perimeterRadius: stateRow.perimeter_radius, weather: stateRow.weather,
        hazardLevel: stateRow.hazard_level, encounterModifier: stateRow.encounter_modifier,
        extractionWindow: stateRow.extraction_window, productionMood: stateRow.production_mood,
        activePrizes, upcomingEvents,
      })
    }
    case 'set_schedule': {
      if (!a.worldId) return err('"worldId" is required')
      if (a.events.length === 0) return err('"events" must be a non-empty array')
      for (const event of a.events) {
        const id = crypto.randomUUID()
        await db.prepare('INSERT INTO production_calendar (id, world_id, day, event_type, event_data, triggered, resolved) VALUES (?, ?, ?, ?, ?, 0, 0) ON CONFLICT(world_id, day, event_type) DO UPDATE SET event_data = excluded.event_data')
          .bind(id, a.worldId, event.day, event.eventType, event.eventData ? JSON.stringify(event.eventData) : null).run()
      }
      return ok({ success: true, actionType: 'set_schedule', worldId: a.worldId, scheduled: a.events.length })
    }
    case 'list_events': {
      if (!a.worldId) return err('"worldId" is required')
      const { results } = await db.prepare('SELECT * FROM production_calendar WHERE world_id = ? AND day >= ? ORDER BY day').bind(a.worldId, a.fromDay).all()
      return ok({ success: true, actionType: 'list_events', worldId: a.worldId, events: results, count: results.length })
    }
  }
}
