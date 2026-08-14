// Tick Driver: Hook runner + Phase 1 hooks for time.advance (#442).
//
// What's actually implemented (this comment previously overclaimed several of
// these — see #475/#512): topological hook ordering, a D1-backed world-level
// lock, dry_run rejection for mutating hooks, per-hook failure isolation with
// audit logging, and the log_only feature flag. NOT implemented: per-day
// batching (a call always runs hooks exactly once regardless of the
// startDate–endDate gap) and true shadow-state diff/rollback across multiple
// hooks in one tick — a thrown hook stops the remaining hooks in that tick but
// does not undo whatever earlier hooks in the same call already wrote.
//
// Cross-hook rollback via a D1 transaction (#502's last checkbox) was
// evaluated and is not achievable with D1's current API, not merely
// unimplemented: D1Database exposes only prepare()/batch()/exec(), no
// interactive BEGIN/COMMIT/ROLLBACK, and batch() requires every statement
// bound and known upfront — it can't express "read this row, branch on the
// result, then maybe write" across multiple hooks the way each hook here
// does (weather → resource → encounter/health → dissolution, each importing
// its own handler module). Closing this out as an accepted platform
// limitation rather than papering over it with fake rollback bookkeeping.
// If Phase 3 (#445) creature-AI hooks need real atomicity, the honest options
// are: (a) restructure hooks to gather all writes as prepared statements
// first and commit them in one batch() at the end (loses per-hook branching
// on a prior hook's just-written state), or (b) each mutating hook records a
// compensating action so a later failure can be manually/semi-automatically
// unwound — real design work, not a wrapper to add.

import type { AppBindings } from '../../types'
import { resolveEncounterCore, type EncounterResolveResult } from './encounter-manage'

// ── Hook Categories ──────────────────────────────────────────────────────────

export type HookCategory = 'resolved' | 'flagged'

export interface HookResult {
  category: HookCategory
  data: unknown
  narrator_summary?: string
}

// Import claims system for conflict resolution
import {
  resolveTickConflicts,
  setClaim,
  clearDeadPredatorClaims,
  type FlaggedEvent,
} from '../utils/claims'
import {
  creatureAiTick,
  computeDayPhase,
  type CreatureAiState,
  type PreySnapshot,
  type CreatureTickSnapshot,
} from '../utils/creature-ai'
import { dissolutionStageCheck } from '../utils/dissolution'
import { tickAllOwnersDegradation } from './resource-manage'

export interface WorldSnapshot {
  date: string
  // #629 — general-purpose day-counter (world_state.world_day), advanced by
  // time-manage.ts's `advance` action alongside current_date. Distinct from
  // production-manage.ts's production_day (a separate, opt-in minigame
  // subsystem counter). Lets day-based sub-hooks (resource_consume,
  // weather_update) call day: number APIs (tickAllOwnersDegradation,
  // weather_log lookups) without inventing their own epoch.
  day: number
  // #534 — sub-day clock (world_state.hour, 0-23). Defaults to 12 (noon) when
  // unset, matching the migration's default so existing/unset worlds keep
  // today's always-daytime creature behavior instead of silently flipping to
  // night the moment this snapshot starts being read.
  hour: number
  // #671 — sub-hour clock (world_state.minute, 0-59). Defaults to 0 when
  // unset, matching the migration's default.
  minute: number
  // #671 — monotonic elapsed-minutes counter (world_state.sim_minutes), the
  // source of truth `day`/`hour`/`minute` are all now derived from in
  // time-manage.ts. Read here in case a future hook needs the raw counter
  // rather than the derived day/hour/minute split.
  simMinutes: number
  // #671 — what fraction of a full day this tick's elapsed time represents
  // (elapsedMinutes / 1440), e.g. 0.125 for a 3-hour advance. Day-cadence
  // hooks (resource_consume) scale their per-day rate by this instead of
  // assuming every call represents exactly one full day. Defaults to 1 (a
  // full day) when the caller doesn't pass elapsedMinutes to runTickDriver —
  // preserves prior behavior for direct callers (tests, or a future caller)
  // that don't thread the value through.
  elapsedDayFraction: number
  parties: Map<string, any>
  characters: Map<string, any>
  encounters: Map<string, any>
  weather?: any
}

// ── Hook Interface ───────────────────────────────────────────────────────────

export interface HookConfig {
  enabled: boolean
  log_only?: boolean
  batch_mode?: boolean
  // Marks a hook as performing real, unconditional writes (e.g. #445's
  // creature_ai_tick calling setClaim() / moving creatures on the map).
  // dry_run rejects any tick selecting a mutating hook outright (#512) —
  // without this, a hook that writes directly to D1 inside execute() would
  // already have committed by the time the dry_run check ran.
  mutates?: boolean
  // #644 — marks a hook whose execute() represents a single day's
  // point-in-time check or roll (weather lookup, encounter probability,
  // creature AI step) rather than a continuous rate/state-diff. Unlike
  // resource_consume/health_degradation (which scale correctly for any
  // elapsed time via WorldSnapshot.elapsedDayFraction — see #671), a
  // point-event hook doesn't have a "rate" to scale: rolling one encounter
  // check for a 10-day advance isn't equivalent to rolling ten. When true,
  // runTickDriver calls execute() once per elapsed calendar day instead of
  // once per call, then merges the results via the hook's mergeDaily.
  perDayLoop?: boolean
}

export interface HookRunner {
  name: string
  config: HookConfig
  dependsOn: string[]
  batchMode: boolean
  execute: (
    env: AppBindings,
    worldId: string,
    date: string,
    snapshot: WorldSnapshot,
  ) => Promise<HookResult>
  // #644 — required when config.perDayLoop is true, unused otherwise. Merges
  // one HookResult per elapsed calendar day into the single HookResult the
  // rest of the driver (resolved/flagged arrays, conflict resolution,
  // hook_failures) expects one of, per hook, per call.
  mergeDaily?: (dailyResults: HookResult[]) => HookResult
}

// ── World-Level Lock (Concurrency Control) ──────────────────────────────────
//
// D1-backed, not in-memory (#512). /mcp has two independent request paths to
// the same tools/call handlers: the Streamable HTTP transport (routed through
// the HolmgardMCP Durable Object, single-threaded per instance) and a separate
// "legacy hand-rolled JSON-RPC" handler (app.post('/mcp') in src/index.ts)
// that dispatches the identical handlers directly from whatever Worker isolate
// received the request — never touching the DO. An in-memory Map is only a
// real mutex for the first path; every test in this repo (and plausibly most
// real callers) uses the second, where a module-level Map gives zero
// cross-isolate protection. A D1 row is authoritative regardless of which
// isolate or transport handles the request.

export async function acquireWorldLock(
  db: D1Database,
  worldId: string,
  holderId: string = 'tick-driver',
): Promise<boolean> {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 30000).toISOString() // 30s TTL

  // Atomic conditional UPSERT — same pattern as setClaim's collision check
  // (#444): the UPDATE branch only applies (and only then does meta.changes
  // report a row touched) when the existing lock has already expired, so two
  // concurrent callers can't both acquire the same world's lock.
  const result = await db
    .prepare(
      `INSERT INTO world_locks (world_id, holder_id, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(world_id) DO UPDATE SET holder_id = excluded.holder_id, expires_at = excluded.expires_at
       WHERE world_locks.expires_at <= ?`,
    )
    .bind(worldId, holderId, expiresAt, now.toISOString())
    .run()

  return (result.meta?.changes ?? 0) > 0
}

export async function releaseWorldLock(
  db: D1Database,
  worldId: string,
  holderId?: string,
): Promise<void> {
  // Holder-scoped when known (runTickDriver always passes its own lockId):
  // an unconditional delete would let an abnormally slow caller release a
  // lock that a different caller has since legitimately re-acquired after
  // the first caller's own TTL expired, silently ending that second caller's
  // protection while it still believes it holds the lock.
  if (holderId !== undefined) {
    await db
      .prepare('DELETE FROM world_locks WHERE world_id = ? AND holder_id = ?')
      .bind(worldId, holderId)
      .run()
  } else {
    await db.prepare('DELETE FROM world_locks WHERE world_id = ?').bind(worldId).run()
  }
}

// ── Shadow State System ───────────────────────────────────────────────────────

// #671 — elapsedMinutes defaults to 1440 (a full day), so a caller that
// doesn't pass it (a direct test call, or a future call site not yet
// threading it through) gets elapsedDayFraction: 1 — the same "one call =
// one full day" assumption day-cadence hooks made before this parameter
// existed, rather than silently scaling to zero.
export async function snapshotWorldState(
  db: D1Database,
  worldId: string,
  elapsedMinutes: number = 1440,
): Promise<WorldSnapshot> {
  const ws = (await db
    .prepare('SELECT * FROM world_state WHERE world_id = ?')
    .bind(worldId)
    .first()) as Record<string, any> | null

  const dateStr = ws?.current_date ?? new Date().toISOString().split('T')[0]
  return {
    date: dateStr,
    day: (ws?.world_day as number | undefined) ?? 0,
    hour: (ws?.hour as number | undefined) ?? 12,
    minute: (ws?.minute as number | undefined) ?? 0,
    simMinutes: (ws?.sim_minutes as number | undefined) ?? 0,
    elapsedDayFraction: elapsedMinutes / 1440,
    parties: new Map(),
    characters: new Map(),
    encounters: new Map(),
    weather: ws?.weather as any,
  }
}

// ── Phase 1 Hooks ─────────────────────────────────────────────────────────────

// weather_update — resolved hook (#629). weather-manage.ts is deliberately a
// narrator-authored cache, not an auto-generating oracle (see its module
// header) — on a cache miss this hook reports the gap rather than inventing
// weather, exactly like weather-manage.ts's own get_forecast action does.
const weatherUpdateHook: HookRunner = {
  name: 'weather_update',
  // #644 — point-in-time cache lookup keyed purely on `snapshot.day`; a
  // 10-day advance should surface all 10 days' forecasts, not just the
  // final one, so this loops once per elapsed calendar day.
  config: { enabled: true, batch_mode: true, perDayLoop: true },
  dependsOn: [],
  batchMode: true,
  execute: async (
    env: AppBindings,
    worldId: string,
    date: string,
    snapshot: WorldSnapshot,
  ): Promise<HookResult> => {
    const db = env.RPG_DB!
    const day = snapshot.day
    const row = (await db
      .prepare('SELECT * FROM weather_log WHERE world_id = ? AND day = ?')
      .bind(worldId, day)
      .first()) as Record<string, unknown> | null

    if (row) {
      return {
        category: 'resolved',
        data: {
          action: 'weather_update',
          worldId,
          date,
          day,
          found: true,
          conditions: row.conditions,
          temperature_high: row.temperature_high,
          temperature_low: row.temperature_low,
        },
        narrator_summary: `Weather for day ${day}: ${row.conditions ?? 'unrecorded'}.`,
      }
    }

    return {
      category: 'resolved',
      data: { action: 'weather_update', worldId, date, day, found: false },
      narrator_summary: `No weather recorded for day ${day} — narrator should fill it via rpg{sub:"weather", action:"set_forecast"}.`,
    }
  },
  mergeDaily: (daily) => {
    const foundCount = daily.filter((r) => (r.data as { found?: boolean }).found).length
    return {
      category: 'resolved',
      data: {
        action: 'weather_update',
        days: daily.length,
        found_count: foundCount,
        daily: daily.map((r) => r.data),
      },
      narrator_summary: `Weather across ${daily.length} day(s): ${daily
        .map((r) => r.narrator_summary)
        .filter(Boolean)
        .join(' ')}`,
    }
  },
}

// resource_consume — resolved hook, batch mode (#629)
const resourceConsumeHook: HookRunner = {
  name: 'resource_consume',
  config: { enabled: true, batch_mode: true },
  dependsOn: ['weather_update'],
  batchMode: true,
  execute: async (
    env: AppBindings,
    worldId: string,
    date: string,
    snapshot: WorldSnapshot,
  ): Promise<HookResult> => {
    const db = env.RPG_DB!
    // #671 — scale the per-day consumption rate by how much of a day this
    // call actually represents, instead of always charging a full day's
    // ration for e.g. a 3-hour advance.
    const results = await tickAllOwnersDegradation(
      db,
      worldId,
      snapshot.day,
      snapshot.elapsedDayFraction,
    )
    const spoiledCount = results.filter((r) => r.spoiled.length > 0).length

    return {
      category: 'resolved',
      data: {
        action: 'resource_consume',
        worldId,
        date,
        day: snapshot.day,
        day_fraction: snapshot.elapsedDayFraction,
        results,
      },
      narrator_summary: `${results.length} owner(s) ticked (${snapshot.elapsedDayFraction.toFixed(2)}× day rate), ${spoiledCount} with spoilage.`,
    }
  },
}

// encounter_check — flagged hook
const encounterCheckHook: HookRunner = {
  name: 'encounter_check',
  // #644 — rolls one encounter-probability check per elapsed calendar day
  // instead of once per call: a 10-day advance gets ten independent rolls,
  // not one (parties don't move during time.advance itself, so each day's
  // roll targets the same hex — that's the intended semantics, not a bug).
  config: { enabled: true, batch_mode: false, perDayLoop: true },
  dependsOn: ['weather_update'],
  batchMode: false,
  execute: async (
    env: AppBindings,
    worldId: string,
    date: string,
    _snapshot: WorldSnapshot, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<HookResult> => {
    const db = env.RPG_DB!

    // Query for active, positioned parties
    const partiesResult = await db
      .prepare(
        `SELECT id, current_hex_q AS q, current_hex_r AS r
         FROM parties
         WHERE world_id = ? AND status = 'active' AND current_hex_q IS NOT NULL AND current_hex_r IS NOT NULL`,
      )
      .bind(worldId)
      .all()

    const parties = (partiesResult.results as Array<{ id: string; q: number; r: number }>).map(
      (row) => ({ partyId: row.id, q: row.q, r: row.r }),
    )

    // If no positioned active parties, return early with empty result
    if (parties.length === 0) {
      return {
        category: 'flagged',
        data: {
          action: 'encounter_check',
          worldId,
          date,
          parties_checked: 0,
          triggered: [],
        },
        narrator_summary: 'No positioned active parties to check.',
      }
    }

    // Check encounters for all parties in parallel
    const results = await Promise.all(
      parties.map((party) =>
        resolveEncounterCore(db, {
          worldId,
          q: party.q,
          r: party.r,
          lightweight: true,
        }),
      ),
    )

    // Collect parties where an encounter was triggered
    const triggered: Array<EncounterResolveResult & { partyId: string }> = []
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.encounter) {
        triggered.push({
          ...result,
          partyId: parties[i].partyId,
        })
      }
    }

    const triggeredCount = triggered.length
    return {
      category: 'flagged',
      data: {
        action: 'encounter_check',
        worldId,
        date,
        parties_checked: parties.length,
        triggered,
      },
      narrator_summary: `${parties.length} party(ies) checked, ${triggeredCount} encounter(s) eligible.`,
    }
  },
  mergeDaily: (daily) => {
    const triggeredTotal = daily.reduce(
      (sum, r) => sum + ((r.data as { triggered?: unknown[] }).triggered?.length ?? 0),
      0,
    )
    // `daily` is always non-empty here (mergeDaily only runs when
    // iterations > 1) and encounter_check's execute() always returns a
    // defined parties_checked, so no `?.`/`?? 0` fallback is reachable.
    const partiesChecked = (daily[daily.length - 1].data as { parties_checked: number })
      .parties_checked
    return {
      category: 'flagged',
      data: {
        action: 'encounter_check',
        days: daily.length,
        parties_checked: partiesChecked,
        triggered_total: triggeredTotal,
        daily: daily.map((r) => r.data),
      },
      narrator_summary: `Encounter checks across ${daily.length} day(s): ${partiesChecked} party(ies) checked per day, ${triggeredTotal} encounter(s) eligible total.`,
    }
  },
}

// ── Wound escalation formula (#631) ─────────────────────────────────────────
//
// Design decision (see #631): a standalone severity-tier escalation model,
// deliberately not sharing computeInfectionStage() from encounter-manage.ts
// (that function models a different concept — fever/sepsis onset for the
// `encounter.check_infection` action — and stays untouched). This hook only
// steps an injury's severity tier up the longer it stays untreated. Out of
// scope per the #631 decision: numeric HP loss from bleeding_rate, and any
// write to characters.death_mode/dissolution_stage — sepsis-adjacent effects
// stay purely descriptive here, the same as encounter-manage.ts's existing
// flavor text. The hook is read-only: it *reports* which untreated injuries
// would step up a tier: it never writes the escalated severity back to
// character_injuries.severity, so the same injury is re-evaluated from its
// original severity on every call (idempotent, no persisted escalation
// state/history needed).
//
// #671 — character_injuries.created_at is still a real wall-clock timestamp,
// but encounter-manage.ts now also stamps created_at_sim_minutes (in-game
// sim time, same clock as world_state.sim_minutes) at injury-creation time.
// This hook diffs against that column when present, matching the
// in-game-time rule claims.ts already enforces for claimed_at/claimed_until
// (#444). Injuries created before this column existed have
// created_at_sim_minutes = NULL; for those legacy rows the hook falls back
// to the old wall-clock diff (Date.now() - created_at) rather than
// fabricating a sim-time value that was never recorded.

const WOUND_SEVERITY_TIERS = ['minor', 'moderate', 'severe', 'critical'] as const
type WoundSeverityTier = (typeof WOUND_SEVERITY_TIERS)[number]

// Hours untreated (since injury creation) at which an injury reaches at
// least this tier. Index-aligned with WOUND_SEVERITY_TIERS.
const WOUND_ESCALATION_HOURS: Record<WoundSeverityTier, number> = {
  minor: 0,
  moderate: 24,
  severe: 48,
  critical: 72,
}

function computeWoundEscalation(
  currentSeverity: string,
  hoursUntreated: number,
): { severity: WoundSeverityTier; escalated: boolean; tiersAdvanced: number } {
  const currentIndex = WOUND_SEVERITY_TIERS.indexOf(currentSeverity as WoundSeverityTier)
  const startIndex = currentIndex === -1 ? 0 : currentIndex

  let timeIndex = 0
  for (let i = WOUND_SEVERITY_TIERS.length - 1; i >= 0; i--) {
    if (hoursUntreated >= WOUND_ESCALATION_HOURS[WOUND_SEVERITY_TIERS[i]]) {
      timeIndex = i
      break
    }
  }

  // Never downgrade: an injury created at a higher tier than time alone
  // would justify (e.g. a "severe" injury only 1 hour old) stays at its
  // original tier.
  const finalIndex = Math.max(startIndex, timeIndex)
  return {
    severity: WOUND_SEVERITY_TIERS[finalIndex],
    escalated: finalIndex > startIndex,
    tiersAdvanced: finalIndex - startIndex,
  }
}

// health_degradation — resolved hook
const healthDegradationHook: HookRunner = {
  name: 'health_degradation',
  config: { enabled: true, batch_mode: false },
  dependsOn: ['resource_consume'],
  batchMode: false,
  execute: async (
    env: AppBindings,
    worldId: string,
    date: string,
    snapshot: WorldSnapshot,
  ): Promise<HookResult> => {
    const db = env.RPG_DB!

    const injuriesResult = await db
      .prepare(
        `SELECT id, character_id, severity, created_at, created_at_sim_minutes
         FROM character_injuries
         WHERE world_id = ? AND treated = 0`,
      )
      .bind(worldId)
      .all()

    const injuries = injuriesResult.results as unknown as Array<{
      id: string
      character_id: string | null
      severity: string
      created_at: string
      created_at_sim_minutes: number | null
    }>

    const now = Date.now()
    const worsened: Array<{
      injuryId: string
      characterId: string | null
      previousSeverity: string
      severity: WoundSeverityTier
      hoursUntreated: number
      tiersAdvanced: number
    }> = []

    for (const injury of injuries) {
      // #671 — prefer sim-time when the injury has a sim-time stamp; fall
      // back to the old wall-clock diff for injuries created before that
      // column existed (created_at_sim_minutes is NULL for those rows).
      const hoursUntreated =
        injury.created_at_sim_minutes !== null
          ? Math.max(0, (snapshot.simMinutes - injury.created_at_sim_minutes) / 60)
          : Math.max(0, (now - new Date(injury.created_at).getTime()) / 3600000)
      const escalation = computeWoundEscalation(injury.severity, hoursUntreated)
      if (escalation.escalated) {
        worsened.push({
          injuryId: injury.id,
          characterId: injury.character_id,
          previousSeverity: injury.severity,
          severity: escalation.severity,
          hoursUntreated: Math.round(hoursUntreated),
          tiersAdvanced: escalation.tiersAdvanced,
        })
      }
    }

    return {
      category: 'resolved',
      data: {
        action: 'health_degradation',
        worldId,
        date,
        injuries_checked: injuries.length,
        worsened,
      },
      narrator_summary:
        worsened.length > 0
          ? `Character health degraded: ${worsened.length} untreated wound(s) worsened.`
          : 'Character health checked: no untreated wounds worsened.',
    }
  },
}

// dissolution_flag — flagged hook
const dissolutionFlagHook: HookRunner = {
  name: 'dissolution_flag',
  config: { enabled: true, batch_mode: false },
  dependsOn: ['health_degradation', 'encounter_check'],
  batchMode: false,
  execute: async (
    env: AppBindings,
    worldId: string,
    date: string,
    _snapshot: WorldSnapshot, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<HookResult> => {
    const db = env.RPG_DB!

    // Query for characters in this world with death_mode = 'staged'
    const result = await db
      .prepare(
        `SELECT id, death_mode, dissolution_stage, dissolution_stages
         FROM characters
         WHERE world_id = ? AND death_mode = 'staged'`,
      )
      .bind(worldId)
      .all()

    const rows = result.results as unknown as Array<{
      id: string
      death_mode: string | null
      dissolution_stage: number | null
      dissolution_stages: number | null
    }>

    const stagedCharacters: Array<{
      id: string
      stage: number | null
      total_stages: number | null
    }> = []

    // Check each row and collect staged characters
    for (const row of rows) {
      const check = dissolutionStageCheck(row)
      if (check.is_staged) {
        stagedCharacters.push({
          id: row.id,
          stage: check.stage,
          total_stages: check.total_stages,
        })
      }
    }

    // Build narrator summary
    const narratorSummary =
      stagedCharacters.length > 0
        ? `${stagedCharacters.length} character(s) in active dissolution stage(s) flagged for review.`
        : 'No characters in active dissolution stages.'

    return {
      category: 'flagged',
      data: {
        action: 'dissolution_flag',
        worldId,
        date,
        staged_characters: stagedCharacters,
      },
      narrator_summary: narratorSummary,
    }
  },
}

// creature_ai_tick — flagged hook (#445, #440 Phase 3 §3.6)
//
// Reads creature_ai_state for the world, branches each creature on
// predator_taxonomy (feral / Shaper / stub), applies the returned mutations
// (movement, hunger/creative_drive, claims), and flags any hunt/tenderize that
// reaches melee as an encounter for the narrator to resolve. `mutates: true`
// (#512) so dry_run rejects previewing it — the hook writes to D1 unconditionally.
const creatureAiTickHook: HookRunner = {
  name: 'creature_ai_tick',
  // #644 — each execute() call is one AI-tick's worth of movement/hunger
  // (creatureAiTick's own step logic, not scaled by elapsed time), and it
  // re-reads creature/prey state fresh from D1 every call rather than
  // caching it — so looping this hook N times for an N-day advance correctly
  // lets day 2's movement build on day 1's just-written position, with no
  // extra state-threading needed here.
  config: { enabled: true, batch_mode: false, mutates: true, perDayLoop: true },
  dependsOn: ['resource_consume'],
  batchMode: false,
  execute: async (
    env: AppBindings,
    worldId: string,
    date: string,
    snapshot: WorldSnapshot,
  ): Promise<HookResult> => {
    const db = env.RPG_DB!

    // Reconcile claims left dangling by removed predators before anything moves.
    const deathClearing = await clearDeadPredatorClaims(env, db, worldId)

    // Batch-load creatures for this world and every positioned prey character
    // in parallel (KV/D1 batch-read rule — no sequential awaits).
    //
    // #533 — prey is scoped by characters.world_id (added in migration 0009
    // for character.list/search, #268), not just hex-position presence. Two
    // worlds with overlapping hex coordinates used to make a creature in
    // world A "detect" and hunt a character positioned in world B; a
    // character with no world_id set (pre-#268 legacy rows, or created
    // without one) is simply not eligible prey in any world rather than
    // eligible prey in every world.
    const [creatureRes, preyRes] = await Promise.all([
      db.prepare('SELECT * FROM creature_ai_state WHERE world_id = ?').bind(worldId).all(),
      db
        .prepare(
          `SELECT id, current_hex_q AS q, current_hex_r AS r, hp, claimed_by
           FROM characters
           WHERE world_id = ? AND current_hex_q IS NOT NULL AND current_hex_r IS NOT NULL`,
        )
        .bind(worldId)
        .all(),
    ])

    const creatures = creatureRes.results as unknown as CreatureAiState[]
    const prey: PreySnapshot[] = (
      preyRes.results as Array<{
        id: string
        q: number
        r: number
        hp: number | null
        claimed_by: string | null
      }>
    ).map((row) => ({
      key: row.id,
      q: row.q,
      r: row.r,
      hp: row.hp,
      // Characters carry no yield-grade column yet, so a Shaper's yield
      // preference currently falls back to nearest-prey selection.
      yieldGrade: null,
      claimedBy: row.claimed_by,
    }))

    // #534 — real day/night phase from world_state.hour instead of a hardcoded daytime default.
    const creatureSnapshot: CreatureTickSnapshot = {
      phase: computeDayPhase(snapshot.hour),
      prey,
      currentTickTime: date,
    }

    const events: FlaggedEvent[] = []
    let creaturesMoved = 0
    let huntsInitiated = 0
    const now = new Date().toISOString()

    for (const creature of creatures) {
      const result = creatureAiTick(creature, creatureSnapshot)
      if (result.changed) {
        await db
          .prepare(
            `UPDATE creature_ai_state
             SET hunger = ?, creative_drive = ?, current_state = ?,
                 current_hex_q = ?, current_hex_r = ?, target_hex_q = ?, target_hex_r = ?,
                 updated_at = ?
             WHERE id = ?`,
          )
          .bind(
            result.hunger,
            result.creativeDrive,
            result.currentState,
            result.currentHexQ,
            result.currentHexR,
            result.targetHexQ,
            result.targetHexR,
            now,
            creature.id,
          )
          .run()
      }
      if (result.moved) creaturesMoved++
      if (result.claim) {
        try {
          await setClaim(
            env,
            db,
            result.claim.targetKey,
            creature.creature_key ?? creature.id,
            result.claim.until,
            date,
          )
        } catch {
          // Prey vanished between snapshot and write, or claim was contested —
          // skip; next tick re-evaluates. Never let one claim break the tick.
        }
      }
      if (result.flaggedEvent) {
        events.push(result.flaggedEvent)
        huntsInitiated++
      }
    }

    return {
      category: 'flagged',
      data: {
        action: 'creature_ai_tick',
        worldId,
        date,
        events,
        creatures_evaluated: creatures.length,
        creatures_moved: creaturesMoved,
        hunts_initiated: huntsInitiated,
        claims_cleared: deathClearing.cleared.length,
      },
      narrator_summary: `Creature AI: ${creatures.length} creature(s), ${creaturesMoved} moved, ${huntsInitiated} hunt(s) flagged, ${deathClearing.cleared.length} stale claim(s) cleared.`,
    }
  },
  mergeDaily: (daily) => {
    const events = daily.flatMap(
      (r) => ((r.data as { events?: FlaggedEvent[] }).events ?? []) as FlaggedEvent[],
    )
    const sum = (field: string) =>
      daily.reduce((total, r) => total + ((r.data as Record<string, number>)[field] ?? 0), 0)
    // Same reasoning as encounter_check's mergeDaily above: daily is always
    // non-empty here, and creature_ai_tick's execute() always returns a
    // defined creatures_evaluated.
    const creaturesEvaluated = (daily[daily.length - 1].data as { creatures_evaluated: number })
      .creatures_evaluated
    const creaturesMoved = sum('creatures_moved')
    const huntsInitiated = sum('hunts_initiated')
    const claimsCleared = sum('claims_cleared')
    return {
      category: 'flagged',
      data: {
        action: 'creature_ai_tick',
        days: daily.length,
        events,
        creatures_evaluated: creaturesEvaluated,
        creatures_moved: creaturesMoved,
        hunts_initiated: huntsInitiated,
        claims_cleared: claimsCleared,
        daily: daily.map((r) => r.data),
      },
      narrator_summary: `Creature AI across ${daily.length} day(s): ${creaturesEvaluated} creature(s), ${creaturesMoved} moved, ${huntsInitiated} hunt(s) flagged, ${claimsCleared} stale claim(s) cleared.`,
    }
  },
}

// ── Hook Registry & Topological Sort ──────────────────────────────────────────

export const HOOK_REGISTRY = new Map<string, HookRunner>([
  ['weather_update', weatherUpdateHook],
  ['resource_consume', resourceConsumeHook],
  ['encounter_check', encounterCheckHook],
  ['health_degradation', healthDegradationHook],
  ['dissolution_flag', dissolutionFlagHook],
  ['creature_ai_tick', creatureAiTickHook],
])

function topologicalSort(hookNames: string[]): string[] {
  const sorted: string[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(name: string) {
    if (visited.has(name)) return
    if (visiting.has(name)) throw new Error(`Circular dependency detected: ${name}`)

    visiting.add(name)
    const hook = HOOK_REGISTRY.get(name)
    if (hook) {
      for (const dep of hook.dependsOn) {
        if (hookNames.includes(dep)) visit(dep)
      }
    }
    visiting.delete(name)
    visited.add(name)
    sorted.push(name)
  }

  for (const name of hookNames) {
    visit(name)
  }
  return sorted
}

// ── Tick Driver Main Entry Point ───────────────────────────────────────────────

export interface TickDriverInput {
  hooks?: string[]
  dry_run?: boolean
  // #671 — real elapsed minutes this time.advance call represents, computed
  // by time-manage.ts regardless of the `by` unit used. Threaded into the
  // world snapshot as elapsedDayFraction so day-cadence hooks can scale
  // their per-day rate instead of assuming every call is a full day.
  elapsedMinutes?: number
  // #644 — number of calendar-day boundaries this call crossed
  // (newWorldDay - oldWorldDay from time-manage.ts, always >= 0). Drives how
  // many times a perDayLoop hook's execute() runs — floor(elapsedMinutes /
  // 1440) would double-count against elapsedMinutes for a partial-day
  // remainder, so this is threaded through separately rather than derived
  // from elapsedMinutes here. Defaults to 1 when omitted (a direct caller
  // that doesn't pass it gets today's single-fire-per-call behavior).
  daysElapsed?: number
}

export interface TickDriverOutput {
  success: boolean
  resolved: HookResult[]
  flagged: HookResult[]
  narrator_summary?: string
  mutations?: Record<string, unknown>
  conflict_resolutions?: Array<{
    status: 'resolved' | 'modified' | 'deferred'
    eventType: string
    targetKey: string
    sourceEntityKey: string
    narrativeContext?: string
  }>
  hook_failures?: Array<{ hook: string; error: string }>
}

/**
 * Best-effort audit entry for a hook failure, via the same timeline_events
 * table continuity_manage's append_event uses (#512) — no new schema needed.
 * Never throws: a logging failure must not mask the real tick error it's
 * trying to record.
 */
async function logTickFailureEvent(
  db: D1Database,
  worldId: string,
  hookName: string,
  errorMessage: string,
  tickTimestamp: string,
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO timeline_events (id, world_id, thread_id, event_at, verb, entity_id, object_entity, location_id, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        worldId,
        'main',
        tickTimestamp,
        'tick_hook_failure',
        null,
        hookName,
        null,
        errorMessage,
        new Date().toISOString(),
      )
      .run()
  } catch {
    // Best-effort — see doc comment above.
  }
}

export async function runTickDriver(
  env: AppBindings,
  db: D1Database,
  worldId: string,
  startDate: string,
  endDate: string,
  input: TickDriverInput = {},
): Promise<TickDriverOutput> {
  const { hooks = [], dry_run = false, elapsedMinutes, daysElapsed } = input
  // #644 — how many times a perDayLoop hook's execute() runs this call.
  // Always at least 1: a sub-day advance that crosses no day boundary still
  // gets exactly one check, same as before this feature existed.
  const iterations = Math.max(1, daysElapsed ?? 1)

  // Backward compat: no hooks → no changes, return success
  if (hooks.length === 0) {
    return { success: true, resolved: [], flagged: [] }
  }

  // Reject dry_run combined with a mutating hook (#512) before doing any
  // work — a hook marked `mutates: true` writes directly to D1 inside its own
  // execute(), so letting it run under dry_run would silently commit real
  // writes during what's supposed to be a preview call.
  if (dry_run) {
    const mutatingHooks = hooks.filter((name) => HOOK_REGISTRY.get(name)?.config.mutates)
    if (mutatingHooks.length > 0) {
      return {
        success: false,
        resolved: [],
        flagged: [],
        narrator_summary: `dry_run is not supported with mutating hook(s): ${mutatingHooks.join(', ')}`,
      }
    }
  }

  // Acquire world-level lock
  const lockId = `tick-driver-${Date.now()}`
  const lockAcquired = await acquireWorldLock(db, worldId, lockId)
  if (!lockAcquired) {
    return { success: false, resolved: [], flagged: [] }
  }

  try {
    // Topologically sort hooks
    let sortedHooks: string[]
    try {
      sortedHooks = topologicalSort(hooks)
    } catch (e) {
      return {
        success: false,
        resolved: [],
        flagged: [],
        narrator_summary: `Hook sort failed: ${(e as Error).message}`,
      }
    }

    // Snapshot world state
    const snapshot = await snapshotWorldState(db, worldId, elapsedMinutes)

    // Run hooks against snapshot
    const resolved: HookResult[] = []
    const flagged: HookResult[] = []
    const summaries: string[] = []
    const conflictResolutions: Array<{
      status: 'resolved' | 'modified' | 'deferred'
      eventType: string
      targetKey: string
      sourceEntityKey: string
      narrativeContext?: string
    }> = []

    // Collect flagged events for conflict resolution
    const flaggedEvents: FlaggedEvent[] = []

    for (const hookName of sortedHooks) {
      const hook = HOOK_REGISTRY.get(hookName)
      if (!hook) continue
      if (!hook.config.enabled) continue

      try {
        let result: HookResult
        if (hook.config.perDayLoop && iterations > 1) {
          // #644 — one execute() per elapsed calendar day, each against a
          // snapshot whose `day` is that iteration's absolute day number
          // (snapshot.day is the final/post-advance day; iteration i of
          // `iterations` maps to snapshot.day - iterations + i, so the last
          // iteration always lands on the same day a single-fire call
          // would have used). Everything else on the snapshot (hour,
          // simMinutes, elapsedDayFraction) is shared across iterations —
          // only weather_update actually reads `day`; encounter_check and
          // creature_ai_tick re-derive their own state from D1 each call.
          const baseDay = snapshot.day - iterations
          const daily: HookResult[] = []
          for (let i = 1; i <= iterations; i++) {
            const iterSnapshot: WorldSnapshot = { ...snapshot, day: baseDay + i }
            daily.push(await hook.execute(env, worldId, startDate, iterSnapshot))
          }
          result = hook.mergeDaily!(daily)
        } else {
          result = await hook.execute(env, worldId, startDate, snapshot)
        }
        if (hook.config.log_only) {
          // Log what would happen, but don't mutate
          console.log(`[tick-driver-log-only] ${hookName}: ${JSON.stringify(result)}`)
        }
        if (result.category === 'resolved') resolved.push(result)
        if (result.category === 'flagged') {
          flagged.push(result)

          // Extract flagged events for conflict resolution
          if (result.data && typeof result.data === 'object' && 'events' in result.data) {
            const events = (result.data as { events: FlaggedEvent[] }).events
            flaggedEvents.push(...events)
          }
        }
        if (result.narrator_summary) summaries.push(result.narrator_summary)
      } catch (e) {
        // Hook failure → stop processing remaining hooks (later hooks may
        // depend on this one's output) but preserve resolved/flagged from
        // hooks that already succeeded earlier in this same tick, instead of
        // discarding them (#512) — they already ran, and for a mutating hook,
        // already wrote.
        const errorMessage = (e as Error).message
        await logTickFailureEvent(db, worldId, hookName, errorMessage, startDate)
        return {
          success: false,
          resolved,
          flagged,
          // Keep the narrator_summary from hooks that already succeeded
          // earlier in this tick (same reasoning as resolved/flagged above)
          // instead of replacing it outright with just the failure.
          narrator_summary: [...summaries, `Hook ${hookName} failed: ${errorMessage}`].join(' '),
          hook_failures: [{ hook: hookName, error: errorMessage }],
        }
      }
    }

    // Resolve conflicts between flagged events
    if (flaggedEvents.length > 0) {
      const resolutionResults = await resolveTickConflicts(flaggedEvents, startDate, env, db)

      // Process resolution results
      for (const resolution of resolutionResults) {
        conflictResolutions.push({
          status: resolution.status,
          eventType: resolution.event.eventType,
          targetKey: resolution.event.targetKey,
          sourceEntityKey: resolution.event.sourceEntityKey,
          narrativeContext:
            resolution.status === 'modified' ? resolution.modification.narrativeContext : undefined,
        })
      }
    }

    // If dry_run, return results without persisting
    if (dry_run) {
      return {
        success: true,
        resolved,
        flagged,
        narrator_summary: summaries.join(' '),
        mutations: { would_persist: snapshot },
      }
    }

    // Hooks write directly to D1 inside their own execute() — there is no
    // separate "apply" step here. #512 deliberately chose per-hook failure
    // isolation (above) over wrapping this whole loop in a D1 transaction:
    // the world-level lock already serializes ticks per world, so the only
    // real risk was "one bad hook wipes/poisons everything," not concurrent
    // corruption — see #512 for the full reasoning.

    return {
      success: true,
      resolved,
      flagged,
      narrator_summary: summaries.join(' '),
      conflict_resolutions: conflictResolutions.length > 0 ? conflictResolutions : undefined,
    }
  } finally {
    await releaseWorldLock(db, worldId, lockId)
  }
}
