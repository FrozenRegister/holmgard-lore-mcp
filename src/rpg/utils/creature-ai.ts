// Creature AI daily-tick logic (#445, #440 Phase 3 §3.6).
//
// Pure where possible: feralTick / shaperTick / creatureAiTick take a creature
// row + a per-tick world snapshot and return a *description* of what changed
// (new state fields, an optional claim intent, an optional flagged encounter
// event). They never touch D1 — the creature_ai_tick hook in tick-hooks.ts
// applies the returned mutations (UPDATE creature_ai_state, setClaim, and feed
// flaggedEvent into resolveTickConflicts). This keeps the behaviour trees
// deterministic and unit-testable without a database.
//
// Two intentional, documented deviations from the raw §3.6 pseudocode:
//   1. Prey detection is deterministic by range, not a per-tick random roll
//      (random(0..1) < PERCEPTION). A reproducible tick is worth more here than
//      a coin flip the narrator can't replay.
//   2. There is no sub-day clock, so activity-pattern gating uses a single
//      isDaytime boolean on the snapshot; 'crepuscular' is treated as
//      always-active until a dawn/dusk clock exists.

import type { FlaggedEvent } from './claims'

// ── Tunables (the design lists hunger_rate etc. as per-creature fields, but the
// #445 creature_ai_state DDL only stores hunger/creative_drive — the *rates*
// are engine constants) ─────────────────────────────────────────────────────
export const HUNGER_RATE = 10 // hunger gained per active tick
export const REST_CONSERVATION = 5 // hunger shed while resting
export const FEED_RATE = 20 // hunger shed per tick at a kill
export const HUNT_HUNGER_THRESHOLD = 70 // patrol → hunt when prey detected
export const DESPERATION_HUNGER_THRESHOLD = 90 // hunt at doubled range
export const DEFAULT_TERRITORY_RADIUS = 3
export const DEFAULT_PERCEPTION = 0.5
export const DEFAULT_MOVEMENT_SPEED = 1
export const MELEE_RANGE = 1
export const SHAPER_DRIVE_RATE = 10 // creative_drive gained per tick
export const SHAPER_DRIVE_THRESHOLD = 50 // patrol → stalk when driven + prey found
export const SHAPER_CLAIM_DAYS = 3 // how long a tenderize claim holds

// ── Types ────────────────────────────────────────────────────────────────────

export interface CreatureAiState {
  id: string
  world_id: string
  creature_key: string | null
  predator_taxonomy: string
  home_nest_q: number | null
  home_nest_r: number | null
  territory_radius: number | null
  hunger: number
  creative_drive: number
  aggression: number | null
  activity_pattern: string | null
  movement_speed: number | null
  stealth: number | null
  perception: number | null
  current_state: string | null
  current_hex_q: number | null
  current_hex_r: number | null
  target_hex_q: number | null
  target_hex_r: number | null
  atelier_hex_q: number | null
  atelier_hex_r: number | null
  yield_preference: string | null
}

export interface PreySnapshot {
  key: string // character lore key / id — used as claim target and flagged targetKey
  q: number
  r: number
  hp?: number | null // <= 0 (or an explicit dead flag) removes it from target selection
  yieldGrade?: string | null // matched against a Shaper's yield_preference
  claimedBy?: string | null // creature_key currently tenderizing this prey
}

export interface CreatureTickSnapshot {
  isDaytime: boolean
  prey: PreySnapshot[]
  currentTickTime: string // in-game datetime — a claim's `until` is derived from this
}

export interface CreatureTickResult {
  creatureId: string
  taxonomy: string
  changed: boolean // false → hook skips the UPDATE (stub no-ops, unchanged rest)
  moved: boolean
  hunger: number
  creativeDrive: number
  currentState: string
  currentHexQ: number | null
  currentHexR: number | null
  targetHexQ: number | null
  targetHexR: number | null
  claim?: { targetKey: string; until: string } // Shaper tenderize → setClaim intent
  flaggedEvent?: FlaggedEvent // hunt/tenderize reaching melee → narrator encounter
  summary: string
}

// ── Pure geometry / helpers ──────────────────────────────────────────────────

/** Axial-hex distance (converted to cube distance). */
export function hexDistance(q1: number, r1: number, q2: number, r2: number): number {
  return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2
}

/** One greedy step of up to `speed` hexes from (cq,cr) toward (tq,tr). */
export function stepToward(
  cq: number,
  cr: number,
  tq: number,
  tr: number,
  speed: number,
): { q: number; r: number } {
  const dist = hexDistance(cq, cr, tq, tr)
  if (dist === 0 || speed <= 0) return { q: cq, r: cr }
  const t = Math.min(1, speed / dist)
  return { q: Math.round(cq + (tq - cq) * t), r: Math.round(cr + (tr - cr) * t) }
}

/** Whether a creature with this activity pattern acts on a day/night tick. */
export function isActiveTime(pattern: string | null, isDaytime: boolean): boolean {
  if (pattern === 'nocturnal') return !isDaytime
  if (pattern === 'diurnal') return isDaytime
  return true // 'always', 'crepuscular', or unset
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString()
}

function isLive(p: PreySnapshot): boolean {
  return p.hp === undefined || p.hp === null || p.hp > 0
}

/** Nearest live prey within `range` hexes of (cq,cr), or null. */
export function nearestLivePrey(
  cq: number,
  cr: number,
  prey: PreySnapshot[],
  range: number,
): { prey: PreySnapshot; distance: number } | null {
  let best: PreySnapshot | null = null
  let bestDist = Infinity
  for (const p of prey) {
    if (!isLive(p)) continue
    const d = hexDistance(cq, cr, p.q, p.r)
    if (d <= range && d < bestDist) {
      best = p
      bestDist = d
    }
  }
  return best ? { prey: best, distance: bestDist } : null
}

function detectionRange(creature: CreatureAiState): number {
  const radius = creature.territory_radius ?? DEFAULT_TERRITORY_RADIUS
  const perc = creature.perception ?? DEFAULT_PERCEPTION
  return Math.max(1, Math.round(radius * perc))
}

function speedOf(creature: CreatureAiState): number {
  return creature.movement_speed ?? DEFAULT_MOVEMENT_SPEED
}

// Base for a result: carries the creature's existing state unchanged. Each tick
// function mutates the fields it touches, then flips `changed` as needed.
function baseResult(creature: CreatureAiState): CreatureTickResult {
  return {
    creatureId: creature.id,
    taxonomy: creature.predator_taxonomy,
    changed: false,
    moved: false,
    hunger: creature.hunger,
    creativeDrive: creature.creative_drive,
    currentState: creature.current_state ?? 'patrolling',
    currentHexQ: creature.current_hex_q,
    currentHexR: creature.current_hex_r,
    targetHexQ: creature.target_hex_q,
    targetHexR: creature.target_hex_r,
    summary: '',
  }
}

function huntFlaggedEvent(
  creature: CreatureAiState,
  prey: PreySnapshot,
  eventType: string,
  kind: string,
): FlaggedEvent {
  const source = creature.creature_key ?? creature.id
  return {
    id: crypto.randomUUID(),
    eventType,
    priority: 'HIGH',
    targetKey: prey.key,
    sourceEntityKey: source,
    payload: { creatureId: creature.id, kind, hex: { q: prey.q, r: prey.r } },
    // Exactly ONE resource lock (#512 / #444): resolveTickConflicts returns one
    // verdict per lock, so a hunt/tenderize event must target a single prey.
    resourceLocks: [prey.key],
  }
}

// ── Feral (CK3 hunger model) ─────────────────────────────────────────────────

export function feralTick(
  creature: CreatureAiState,
  snapshot: CreatureTickSnapshot,
): CreatureTickResult {
  const res = baseResult(creature)
  const cq = creature.current_hex_q
  const cr = creature.current_hex_r
  const hasPos = cq !== null && cr !== null

  // 1–2. Activity gating: an out-of-phase creature rests and conserves.
  if (!isActiveTime(creature.activity_pattern, snapshot.isDaytime)) {
    res.hunger = clamp(res.hunger - REST_CONSERVATION, 0, 100)
    res.currentState = 'resting'
    res.changed = true
    res.summary = `${creature.creature_key ?? creature.id} rests (out of phase); hunger ${res.hunger}.`
    return res
  }

  // A resting creature that is now in-phase wakes to patrol.
  let state = res.currentState === 'resting' ? 'patrolling' : res.currentState

  // 3. Hunger climbs on an active tick (feeding then sheds it below).
  if (state !== 'feeding') res.hunger = clamp(res.hunger + HUNGER_RATE, 0, 100)
  res.changed = true

  const speed = speedOf(creature)
  const range = detectionRange(creature)

  switch (state) {
    case 'fleeing': {
      // No threat source is modelled this phase — a fleeing creature completes
      // its flight and returns to patrolling.
      state = 'patrolling'
      res.moved = true
      res.summary = `${creature.creature_key ?? creature.id} shakes its pursuer and resumes patrol.`
      break
    }
    case 'hunting': {
      const found = hasPos ? nearestLivePrey(cq!, cr!, snapshot.prey, Infinity) : null
      if (!found) {
        // Target dead or escaped: feed if standing on the kill (target) hex,
        // else give up and patrol.
        const atTarget =
          creature.target_hex_q !== null &&
          creature.target_hex_q === cq &&
          creature.target_hex_r === cr
        state = atTarget ? 'feeding' : 'patrolling'
        res.summary = atTarget
          ? `${creature.creature_key ?? creature.id} settles to feed on its kill.`
          : `${creature.creature_key ?? creature.id} loses the trail and patrols.`
      } else {
        const step = stepToward(cq!, cr!, found.prey.q, found.prey.r, speed)
        res.currentHexQ = step.q
        res.currentHexR = step.r
        res.targetHexQ = found.prey.q
        res.targetHexR = found.prey.r
        res.moved = step.q !== cq || step.r !== cr
        const newDist = hexDistance(step.q, step.r, found.prey.q, found.prey.r)
        if (newDist <= MELEE_RANGE) {
          res.flaggedEvent = huntFlaggedEvent(creature, found.prey, 'creature_hunt', 'feral_hunt')
          res.summary = `${creature.creature_key ?? creature.id} closes to melee with ${found.prey.key}.`
        } else {
          res.summary = `${creature.creature_key ?? creature.id} stalks ${found.prey.key}.`
        }
      }
      break
    }
    case 'feeding': {
      res.hunger = clamp(res.hunger - FEED_RATE, 0, 100)
      if (res.hunger <= 0) {
        state = 'patrolling'
        res.summary = `${creature.creature_key ?? creature.id} finishes feeding and patrols.`
      } else {
        res.summary = `${creature.creature_key ?? creature.id} feeds; hunger ${res.hunger}.`
      }
      break
    }
    default: {
      // 'patrolling' (and any unknown feral state) — hunger-gated prey detection.
      state = 'patrolling'
      let detectRange: number
      if (res.hunger > DESPERATION_HUNGER_THRESHOLD) {
        detectRange = range * 2 // desperation widens the search
      } else if (res.hunger > HUNT_HUNGER_THRESHOLD) {
        detectRange = range
      } else {
        detectRange = 0 // sated: only opportunistic prey on the current hex
      }
      const found = hasPos ? nearestLivePrey(cq!, cr!, snapshot.prey, detectRange) : null
      if (found) {
        state = 'hunting'
        res.targetHexQ = found.prey.q
        res.targetHexR = found.prey.r
        res.summary = `${creature.creature_key ?? creature.id} catches a scent and begins hunting ${found.prey.key}.`
      } else {
        res.summary = `${creature.creature_key ?? creature.id} patrols its territory.`
      }
      break
    }
  }

  res.currentState = state
  return res
}

// ── Shaper (creative-drive / tenderizing / atelier) ──────────────────────────

function selectShaperPrey(
  creature: CreatureAiState,
  cq: number,
  cr: number,
  prey: PreySnapshot[],
  range: number,
): { prey: PreySnapshot; distance: number } | null {
  const inRange = prey.filter((p) => isLive(p) && hexDistance(cq, cr, p.q, p.r) <= range)
  let pool = inRange
  if (creature.yield_preference) {
    const preferred = inRange.filter((p) => p.yieldGrade === creature.yield_preference)
    if (preferred.length > 0) pool = preferred
  }
  let best: PreySnapshot | null = null
  let bestDist = Infinity
  for (const p of pool) {
    const d = hexDistance(cq, cr, p.q, p.r)
    if (d < bestDist) {
      best = p
      bestDist = d
    }
  }
  return best ? { prey: best, distance: bestDist } : null
}

export function shaperTick(
  creature: CreatureAiState,
  snapshot: CreatureTickSnapshot,
): CreatureTickResult {
  const res = baseResult(creature)
  const cq = creature.current_hex_q
  const cr = creature.current_hex_r
  const hasPos = cq !== null && cr !== null

  // The Shaper is creative-driven, not day/night bound — no activity gating.
  res.creativeDrive = clamp(res.creativeDrive + SHAPER_DRIVE_RATE, 0, 100)
  res.changed = true

  const speed = speedOf(creature)
  const range = detectionRange(creature)
  let state = res.currentState

  switch (state) {
    case 'stalking': {
      const found = hasPos ? selectShaperPrey(creature, cq!, cr!, snapshot.prey, range * 2) : null
      if (!found) {
        state = 'patrolling'
        res.summary = `${creature.creature_key ?? creature.id} loses its subject and resumes patrol.`
        break
      }
      const step = stepToward(cq!, cr!, found.prey.q, found.prey.r, speed)
      res.currentHexQ = step.q
      res.currentHexR = step.r
      res.targetHexQ = found.prey.q
      res.targetHexR = found.prey.r
      res.moved = step.q !== cq || step.r !== cr
      const newDist = hexDistance(step.q, step.r, found.prey.q, found.prey.r)
      if (newDist <= MELEE_RANGE) {
        state = 'tenderizing'
        res.claim = {
          targetKey: found.prey.key,
          until: addDays(snapshot.currentTickTime, SHAPER_CLAIM_DAYS),
        }
        res.flaggedEvent = huntFlaggedEvent(
          creature,
          found.prey,
          'creature_tenderize',
          'shaper_tenderize',
        )
        res.summary = `${creature.creature_key ?? creature.id} seizes ${found.prey.key} and begins tenderizing.`
      } else {
        res.summary = `${creature.creature_key ?? creature.id} stalks ${found.prey.key}.`
      }
      break
    }
    case 'tenderizing': {
      // Continue working the prey this Shaper already claimed, dragging it
      // toward the atelier. If the claim is gone (prey removed / claim lost),
      // fall back to patrolling.
      const source = creature.creature_key ?? creature.id
      const mine = hasPos
        ? nearestLivePrey(
            cq!,
            cr!,
            snapshot.prey.filter((p) => p.claimedBy === source),
            Infinity,
          )
        : null
      if (!mine) {
        state = 'patrolling'
        res.summary = `${creature.creature_key ?? creature.id}'s subject is gone; it returns to patrol.`
        break
      }
      // Refresh the claim each tick the project continues.
      res.claim = {
        targetKey: mine.prey.key,
        until: addDays(snapshot.currentTickTime, SHAPER_CLAIM_DAYS),
      }
      if (creature.atelier_hex_q !== null && creature.atelier_hex_r !== null && hasPos) {
        const step = stepToward(cq!, cr!, creature.atelier_hex_q, creature.atelier_hex_r, speed)
        res.currentHexQ = step.q
        res.currentHexR = step.r
        res.targetHexQ = creature.atelier_hex_q
        res.targetHexR = creature.atelier_hex_r
        res.moved = step.q !== cq || step.r !== cr
        res.summary = res.moved
          ? `${creature.creature_key ?? creature.id} hauls ${mine.prey.key} toward its atelier.`
          : `${creature.creature_key ?? creature.id} works ${mine.prey.key} at its atelier.`
      } else {
        res.summary = `${creature.creature_key ?? creature.id} tenderizes ${mine.prey.key} in place.`
      }
      break
    }
    default: {
      // 'patrolling' (and any unknown Shaper state).
      state = 'patrolling'
      if (res.creativeDrive > SHAPER_DRIVE_THRESHOLD) {
        const found = hasPos ? selectShaperPrey(creature, cq!, cr!, snapshot.prey, range) : null
        if (found) {
          state = 'stalking'
          res.targetHexQ = found.prey.q
          res.targetHexR = found.prey.r
          res.summary = `${creature.creature_key ?? creature.id} is inspired and begins stalking ${found.prey.key}.`
        } else {
          res.summary = `${creature.creature_key ?? creature.id} paces, creative drive building.`
        }
      } else {
        res.summary = `${creature.creature_key ?? creature.id} paces, creative drive building.`
      }
      break
    }
  }

  res.currentState = state
  return res
}

// ── No-op stubs (deferred to a later phase) ──────────────────────────────────

function stubTick(creature: CreatureAiState, kind: string): CreatureTickResult {
  const res = baseResult(creature)
  res.summary = `${kind} AI for ${creature.creature_key ?? creature.id} is not yet implemented (no-op).`
  return res
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

export function creatureAiTick(
  creature: CreatureAiState,
  snapshot: CreatureTickSnapshot,
): CreatureTickResult {
  switch (creature.predator_taxonomy) {
    case 'feral':
      return feralTick(creature, snapshot)
    case 'shaper':
      return shaperTick(creature, snapshot)
    case 'parasitic':
      return stubTick(creature, 'parasitic')
    case 'environmental':
      return stubTick(creature, 'environmental')
    default:
      // Unknown taxonomy: treat as an inert no-op rather than guessing a
      // behaviour tree.
      return stubTick(creature, `unknown taxonomy "${creature.predator_taxonomy}"`)
  }
}
