// src/rpg/utils/dissolution.ts
//
// Phase 0 of the #440 simulation layer: dissolution primitives.
// Stage-gated sensory mutations + mechanical consequences + terminal-conversion
// branching, as hardcoded TypeScript. No JSON interpreter.
//
// Reuses existing characters columns (death_mode, dissolution_stage,
// dissolution_stages, dissolution_terminal) and KV entity text fields.
// Every D1 write for one advance is a single atomic db.batch.

import {
  STAGE_MUTATIONS,
  TERMINAL_CONVERSIONS,
  type StageMutation,
  type UtilityVector,
  type TerminalConversion,
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
export type { StageMutation, UtilityVector, TerminalConversion }
export { STAGE_MUTATIONS, TERMINAL_CONVERSIONS }

/**
 * Returns the StageMutation record for a given stage number.
 * Returns null for out-of-range values (outside 1–5).
 */
export function stageMutationFor(stage: number): StageMutation | null {
  if (stage >= 1 && stage <= 5 && Number.isInteger(stage)) {
    return STAGE_MUTATIONS[stage as 1 | 2 | 3 | 4 | 5]
  }
  return null
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
export function buildSensoryProfile(currentStage: number): {
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

  for (let s = 1; s <= currentStage && s <= 5; s++) {
    const mut = STAGE_MUTATIONS[s as 1 | 2 | 3 | 4 | 5]
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
export function buildMechanicalEffects(currentStage: number): {
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

  for (let s = 1; s <= currentStage && s <= 5; s++) {
    const mut = STAGE_MUTATIONS[s as 1 | 2 | 3 | 4 | 5]
    if (!mut) continue
    effects.resistance_decrement = Math.max(effects.resistance_decrement, mut.mechanical.resistance_decrement)
    if (mut.mechanical.movement_locked) effects.movement_locked = true
    effects.communication_penalty = Math.min(effects.communication_penalty, mut.mechanical.communication_penalty)
    effects.hp_drain_per_tick = Math.max(effects.hp_drain_per_tick, mut.mechanical.hp_drain_per_tick)
    if (mut.mechanical.knowledge_leakage) effects.knowledge_leakage = true
    if (mut.mechanical.terminal) effects.terminal = true
  }

  return effects
}
