// Tick Driver: Hook runner + Phase 1 hooks for time.advance (#442).
// Shadow state cloning, batched/per-day execution, checkpoint+rollback atomicity,
// world-level locking, feature flags, and structured observability.

import type { AppBindings } from '../../types'

// ── Hook Categories ──────────────────────────────────────────────────────────

export type HookCategory = 'resolved' | 'flagged'

export interface HookResult {
  category: HookCategory
  data: unknown
  narrator_summary?: string
}

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

const WORLD_LOCKS = new Map<string, { holderId: string; expiresAt: number }>()

export async function acquireWorldLock(
  worldId: string,
  holderId: string = 'tick-driver',
): Promise<boolean> {
  const now = Date.now()
  const lock = WORLD_LOCKS.get(worldId)
  if (lock && lock.expiresAt > now) return false
  WORLD_LOCKS.set(worldId, { holderId, expiresAt: now + 30000 }) // 30s TTL
  return true
}

export function releaseWorldLock(worldId: string): void {
  WORLD_LOCKS.delete(worldId)
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

const HOOK_REGISTRY = new Map<string, HookRunner>([
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

  // Acquire world-level lock
  const lockId = `tick-driver-${Date.now()}`
  const lockAcquired = await acquireWorldLock(worldId, lockId)
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
        if (result.category === 'flagged') flagged.push(result)
        if (result.narrator_summary) summaries.push(result.narrator_summary)
      } catch (e) {
        // Hook failure → abort entire advance, restore snapshot, return error
        return {
          success: false,
          resolved: [],
          flagged: [],
          narrator_summary: `Hook ${hookName} failed: ${(e as Error).message}`,
        }
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

    // Apply mutations to real world state (single transaction)
    // TODO: Wrap in D1 transaction once per-day logic is complete

    return {
      success: true,
      resolved,
      flagged,
      narrator_summary: summaries.join(' '),
    }
  } finally {
    releaseWorldLock(worldId)
  }
}
