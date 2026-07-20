// src/rpg/utils/dissolution.ts
//
// Phase 0 of the #440 simulation layer: dissolution primitives.
// Stage-gated sensory mutations + mechanical consequences + terminal-conversion
// branching, as hardcoded TypeScript. No JSON interpreter.
//
// Reuses existing characters columns (death_mode, dissolution_stage,
// dissolution_stages, dissolution_terminal) and KV entity text fields.
// Every D1 write for one advance is a single atomic db.batch.

import type { AppBindings } from '../../types'
import {
  STAGE_MUTATIONS,
  TERMINAL_CONVERSIONS,
  DEFAULT_DISSOLUTION_CONFIG,
  type StageMutation,
  type UtilityVector,
  type TerminalConversion,
  type DissolutionConfig,
} from './dissolution_config'

/**
 * The five-stage dissolution model from #440 Gap 1.
 *
 * 1 — Tenderizing:   Fear-pheromone spike scent, Weight-2 begins decrement
 * 2 — Engulfment:    Thermal +10°F ambient, movement disabled, location locked
 * 3 — Dissolution:   Voice degradation, communication penalized, HP drain begins
 * 4 — Assimilation:  Membrane transparency, bioluminescence shift, consciousness
 *                    fragmentation, knowledge leakage to predator
 * 5 — Terminal:      Rendered fat / fermentation / mineral stillness, identity
 *                    unmade, conversion pathway resolves
 */
// Re-exported from config for backward compat
export type { StageMutation, UtilityVector, TerminalConversion, DissolutionConfig }
export { STAGE_MUTATIONS, TERMINAL_CONVERSIONS, DEFAULT_DISSOLUTION_CONFIG }

// ── Config Integration ─────────────────────────────────────────────────────────

/**
 * Returns the StageMutation record for a given stage number from the config.
 * Returns null for out-of-range values (outside 1 to config.terminalStage).
 */
export function stageMutationFor(
  stage: number,
  config: DissolutionConfig = DEFAULT_DISSOLUTION_CONFIG,
): StageMutation | null {
  if (
    stage >= 1 &&
    stage <= config.terminalStage &&
    Number.isInteger(stage)
  ) {
    return config.stages[stage] ?? null
  }
  return null
}

// ── KV-backed config resolution (#472) ────────────────────────────────────
// The seed step (seedDissolutionConfigKV) lives in migrate-dissolution-config.ts
// as a one-time deploy operation, but reading a config back is on the live
// advance_stage request path — it belongs here, not in a migrate-*.ts file
// (vitest.config.ts excludes migrate-*.ts from the coverage gate, which is
// correct for one-time seed scripts but would wrongly exempt this read path).

export const CONFIG_KEY = 'dissolution:config:phase0-5'

export interface SerializedConfig {
  version: number
  stages: Record<number, StageMutation>
  terminalStage: number
  terminalConversions: Record<string, TerminalConversion>
  migrated_at: string
}

/**
 * Load a dissolution config from KV at the given key (defaults to the
 * seeded phase0-5 default key). Returns null if KV is unavailable, the key
 * doesn't exist, or the stored value doesn't parse.
 */
export async function loadDissolutionConfigFromKV(
  c: { env: AppBindings },
  key: string = CONFIG_KEY,
): Promise<SerializedConfig | null> {
  try {
    const kv = c.env.LORE_DB
    if (!kv) return null
    return (await kv.get(key, 'json')) as SerializedConfig | null
  } catch {
    return null
  }
}

/**
 * Resolves the DissolutionConfig that applies to a specific dissolving
 * character. Lookup order: a per-instance config keyed by the character's
 * own `dissolution_id` (e.g. a narrator-authored 20-stage transformation
 * written directly to KV — no admin tool exists to author these yet, same
 * as any other narrator-improvised KV content in this repo) → the seeded
 * default config (`dissolution:config:phase0-5`, written by
 * seedDissolutionConfigKV) → the in-memory DEFAULT_DISSOLUTION_CONFIG
 * fallback, so behavior is never broken even before seedDissolutionConfigKV
 * has ever run.
 */
export async function resolveDissolutionConfig(
  c: { env: AppBindings },
  dissolutionId: string | null,
): Promise<DissolutionConfig> {
  if (dissolutionId) {
    const custom = await loadDissolutionConfigFromKV(c, `dissolution:config:${dissolutionId}`)
    if (custom) return { stages: custom.stages, terminalStage: custom.terminalStage }
  }
  const seeded = await loadDissolutionConfigFromKV(c)
  if (seeded) return { stages: seeded.stages, terminalStage: seeded.terminalStage }
  return DEFAULT_DISSOLUTION_CONFIG
}

// ── Terminal Conversion Pathways ──────────────────────────────────────────────

/**
 * Resolve a terminal conversion given a utility vector.
 * Returns the TerminalConversion descriptor.
 * For unknown vectors, returns a generic terminal descriptor.
 */
export function resolveTerminalConversion(vector: string): TerminalConversion {
  const upper = vector.toUpperCase() as UtilityVector
  if (upper in TERMINAL_CONVERSIONS) {
    return TERMINAL_CONVERSIONS[upper]
  }
  return {
    label: 'Unknown Conversion',
    outcome: 'consumed-unknown',
    description: `Entity reached terminal stage via "${vector}" pathway. Specific conversion mechanics are undocumented.`,
  }
}

// ── Query Helpers ─────────────────────────────────────────────────────────────

/**
 * Check if a character row indicates an active dissolution stage.
 * Reads from D1 character columns (death_mode, dissolution_stage).
 */
export function dissolutionStageCheck(char: {
  death_mode: string | null
  dissolution_stage: number | null
  dissolution_stages: number | null
}): { is_staged: boolean; stage: number | null; total_stages: number | null } {
  if (char.death_mode === 'staged' && typeof char.dissolution_stage === 'number') {
    return {
      is_staged: true,
      stage: char.dissolution_stage,
      total_stages: char.dissolution_stages ?? null,
    }
  }
  return { is_staged: false, stage: null, total_stages: null }
}

export interface ConsumptionTimelineInfo {
  timeline_remaining: string | null
  status: string | null
  processor: string | null
}

/**
 * Parse consumption timeline info from KV entity text.
 *
 * Lightweight re-implementation that matches extractConsumptionInfo's behavior,
 * so this module has no dependency on lib/lore for testability.
 */
export function consumptionTimelineCheck(kvText: string): ConsumptionTimelineInfo {
  const timelineMatch =
    kvText.match(/\*\*Consumption[- ]Timeline:\*\*\s*(.+?)(?:\n|$)/i) ||
    kvText.match(/\*\*Projected[- ]Consumption[- ]Timeline:\*\*\s*(.+?)(?:\n|$)/i)

  const statusMatch =
    kvText.match(/\*\*Status:\*\*\s*(.+?)(?:\n|$)/i) ||
    kvText.match(/Status[*-:]*\s*(.+?)(?:\n|$)/i)

  const processorMatch =
    kvText.match(/\*\*Processor:\*\*\s*(.+?)(?:\n|$)/i) ||
    kvText.match(/Processor[*-:]*\s*(.+?)(?:\n|$)/i)

  return {
    timeline_remaining: timelineMatch ? timelineMatch[1].trim() : null,
    status: statusMatch ? statusMatch[1].trim() : null,
    processor: processorMatch ? processorMatch[1].trim() : null,
  }
}

// ── Sensory Profile Builder ───────────────────────────────────────────────────

/**
 * Build a cumulative sensory profile string for an entity at a given stage.
 * Each stage's mutations are layered on top of previous stages.
 */
export function buildSensoryProfile(
  currentStage: number,
  config: DissolutionConfig = DEFAULT_DISSOLUTION_CONFIG,
): {
  scent: string[]
  thermal: string[]
  texture: string[]
  visual: string[]
  sound: string[]
} {
  const profile = {
    scent: [] as string[],
    thermal: [] as string[],
    texture: [] as string[],
    visual: [] as string[],
    sound: [] as string[],
  }

  for (let s = 1; s <= currentStage && s <= config.terminalStage; s++) {
    const mut = config.stages[s]
    if (!mut) continue
    if (mut.sensory.scent) profile.scent.push(mut.sensory.scent)
    if (mut.sensory.thermal) profile.thermal.push(mut.sensory.thermal)
    if (mut.sensory.texture) profile.texture.push(mut.sensory.texture)
    if (mut.sensory.visual) profile.visual.push(mut.sensory.visual)
    if (mut.sensory.sound) profile.sound.push(mut.sensory.sound)
  }

  return profile
}

/**
 * Build a cumulative mechanical effects descriptor for an entity at a given stage.
 */
export function buildMechanicalEffects(
  currentStage: number,
  config: DissolutionConfig = DEFAULT_DISSOLUTION_CONFIG,
): {
  resistance_decrement: number
  movement_locked: boolean
  communication_penalty: number
  hp_drain_per_tick: number
  knowledge_leakage: boolean
  terminal: boolean
} {
  const effects = {
    resistance_decrement: 0,
    movement_locked: false,
    communication_penalty: 0,
    hp_drain_per_tick: 0,
    knowledge_leakage: false,
    terminal: false,
  }

  for (let s = 1; s <= currentStage && s <= config.terminalStage; s++) {
    const mut = config.stages[s]
    if (!mut) continue
    effects.resistance_decrement = Math.max(
      effects.resistance_decrement,
      mut.mechanical.resistance_decrement,
    )
    if (mut.mechanical.movement_locked) effects.movement_locked = true
    effects.communication_penalty = Math.min(
      effects.communication_penalty,
      mut.mechanical.communication_penalty,
    )
    effects.hp_drain_per_tick = Math.max(
      effects.hp_drain_per_tick,
      mut.mechanical.hp_drain_per_tick,
    )
    if (mut.mechanical.knowledge_leakage) effects.knowledge_leakage = true
    if (mut.mechanical.terminal) effects.terminal = true
  }

  return effects
}
