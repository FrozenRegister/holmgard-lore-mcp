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

import type { AppBindings } from '../../types'

// ── Hook Categories ──────────────────────────────────────────────────────────

export type HookCategory = 'resolved' | 'flagged'

export interface HookResult {
  category: HookCategory
  data: unknown
  narrator_summary?: string
}

// Import claims system for conflict resolution
import { resolveTickConflicts, type FlaggedEvent } from '../utils/claims'

export interface WorldSnapshot {
  date: string
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

export async function snapshotWorldState(db: D1Database, worldId: string): Promise<WorldSnapshot> {
  const ws = (await db
    .prepare('SELECT * FROM world_state WHERE world_id = ?')
    .bind(worldId)
    .first()) as Record<string, any> | null

  const dateStr = ws?.current_date ?? new Date().toISOString().split('T')[0]
  return {
    date: dateStr,
    parties: new Map(),
    characters: new Map(),
    encounters: new Map(),
    weather: ws?.weather as any,
  }
}

// ── Phase 1 Hooks ─────────────────────────────────────────────────────────────

// weather_update — resolved hook
const weatherUpdateHook: HookRunner = {
  name: 'weather_update',
  config: { enabled: true, batch_mode: true },
  dependsOn: [],
  batchMode: true,
  execute: async (
    _env: AppBindings,
    worldId: string,
    date: string,
    _snapshot: WorldSnapshot, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<HookResult> => {
    // TODO: Reuse weather system from #364. For now, return stub.
    return {
      category: 'resolved',
      data: { action: 'weather_update', worldId, date },
      narrator_summary: 'Weather system placeholder.',
    }
  },
}

// resource_consume — resolved hook, batch mode
const resourceConsumeHook: HookRunner = {
  name: 'resource_consume',
  config: { enabled: true, batch_mode: true },
  dependsOn: ['weather_update'],
  batchMode: true,
  execute: async (
    _env: AppBindings,
    worldId: string,
    date: string,
    _snapshot: WorldSnapshot, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<HookResult> => {
    // TODO: Call resource-manage.ts consume for each active party.
    // For now, return stub.
    return {
      category: 'resolved',
      data: { action: 'resource_consume', worldId, date },
      narrator_summary: 'Party resources consumed.',
    }
  },
}

// encounter_check — flagged hook
const encounterCheckHook: HookRunner = {
  name: 'encounter_check',
  config: { enabled: true, batch_mode: false },
  dependsOn: ['weather_update'],
  batchMode: false,
  execute: async (
    _env: AppBindings,
    worldId: string,
    date: string,
    _snapshot: WorldSnapshot, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<HookResult> => {
    // TODO: Reuse encounter.resolve from #280. Report eligibility, do not auto-resolve.
    return {
      category: 'flagged',
      data: { action: 'encounter_check', worldId, date },
      narrator_summary: 'Encounter eligibility checked.',
    }
  },
}

// health_degradation — resolved hook
const healthDegradationHook: HookRunner = {
  name: 'health_degradation',
  config: { enabled: true, batch_mode: false },
  dependsOn: ['resource_consume'],
  batchMode: false,
  execute: async (
    _env: AppBindings,
    worldId: string,
    date: string,
    _snapshot: WorldSnapshot, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<HookResult> => {
    // TODO: Implement untreated wound worsening, HP/condition tick.
    return {
      category: 'resolved',
      data: { action: 'health_degradation', worldId, date },
      narrator_summary: 'Character health degraded.',
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
    _env: AppBindings,
    worldId: string,
    date: string,
    _snapshot: WorldSnapshot, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<HookResult> => {
    // TODO: Scan staged entities via Phase 0's DissolutionStageCheck interface.
    // Report which are eligible to advance a stage. Never auto-advance.
    return {
      category: 'flagged',
      data: { action: 'dissolution_flag', worldId, date },
      narrator_summary: 'Dissolution stage eligibility checked.',
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
  const { hooks = [], dry_run = false } = input

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
    const snapshot = await snapshotWorldState(db, worldId)

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
        const result = await hook.execute(env, worldId, startDate, snapshot)
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
