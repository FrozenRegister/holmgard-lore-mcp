// tests/worker/dissolution_config.test.ts
//
// Direct tests for dissolution_config.ts
// Verifies the config module's data integrity and structure.

import { describe, expect, it } from 'vitest'
import {
  STAGE_MUTATIONS,
  TERMINAL_CONVERSIONS,
  DEFAULT_DISSOLUTION_CONFIG,
  type StageMutation,
  type UtilityVector,
  type TerminalConversion,
} from '@/rpg/utils/dissolution_config'

describe('dissolution_config', () => {
  // ── STAGE_MUTATIONS ────────────────────────────────────────────────

  it('has all 5 stages (1-5) defined', () => {
    expect(Object.keys(STAGE_MUTATIONS).length).toBe(5)
    for (let s = 1; s <= 5; s++) {
      expect(STAGE_MUTATIONS[s as 1 | 2 | 3 | 4 | 5]).toBeDefined()
    }
  })

  it('has no extra or missing stages', () => {
    const keys = Object.keys(STAGE_MUTATIONS).map(Number).sort()
    expect(keys).toEqual([1, 2, 3, 4, 5])
  })

  it('all stages have complete sensory objects', () => {
    for (let s = 1; s <= 5; s++) {
      const stage = STAGE_MUTATIONS[s as 1 | 2 | 3 | 4 | 5]
      expect(stage.sensory).toHaveProperty('scent')
      expect(stage.sensory).toHaveProperty('thermal')
      expect(stage.sensory).toHaveProperty('texture')
      expect(stage.sensory).toHaveProperty('visual')
      expect(stage.sensory).toHaveProperty('sound')
    }
  })

  it('all stages have complete mechanical objects', () => {
    for (let s = 1; s <= 5; s++) {
      const stage = STAGE_MUTATIONS[s as 1 | 2 | 3 | 4 | 5]
      expect(stage.mechanical).toHaveProperty('resistance_decrement')
      expect(stage.mechanical).toHaveProperty('movement_locked')
      expect(stage.mechanical).toHaveProperty('communication_penalty')
      expect(stage.mechanical).toHaveProperty('hp_drain_per_tick')
      expect(stage.mechanical).toHaveProperty('knowledge_leakage')
      expect(stage.mechanical).toHaveProperty('terminal')
    }
  })

  it('stage 1 is not terminal', () => {
    expect(STAGE_MUTATIONS[1].mechanical.terminal).toBe(false)
  })

  it('stage 5 is terminal', () => {
    expect(STAGE_MUTATIONS[5].mechanical.terminal).toBe(true)
  })

  it('stages 2-4 are not terminal', () => {
    for (let s = 2; s <= 4; s++) {
      expect(STAGE_MUTATIONS[s as 2 | 3 | 4].mechanical.terminal).toBe(false)
    }
  })

  it('resistance_decrement increases monotonically', () => {
    const values = [1, 2, 3, 4, 5].map(
      (s) => STAGE_MUTATIONS[s as 1 | 2 | 3 | 4 | 5].mechanical.resistance_decrement,
    )
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1])
    }
  })

  it('hp_drain_per_tick increases monotonically', () => {
    const values = [1, 2, 3, 4, 5].map(
      (s) => STAGE_MUTATIONS[s as 1 | 2 | 3 | 4 | 5].mechanical.hp_drain_per_tick,
    )
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1])
    }
  })

  it('movement_locked is false for stage 1, true for stages 2-5', () => {
    expect(STAGE_MUTATIONS[1].mechanical.movement_locked).toBe(false)
    for (let s = 2; s <= 5; s++) {
      expect(STAGE_MUTATIONS[s as 2 | 3 | 4 | 5].mechanical.movement_locked).toBe(true)
    }
  })

  it('knowledge_leakage is false for stages 1-3, true for stages 4-5', () => {
    for (let s = 1; s <= 3; s++) {
      expect(STAGE_MUTATIONS[s as 1 | 2 | 3].mechanical.knowledge_leakage).toBe(false)
    }
    for (let s = 4; s <= 5; s++) {
      expect(STAGE_MUTATIONS[s as 4 | 5].mechanical.knowledge_leakage).toBe(true)
    }
  })

  // ── TERMINAL_CONVERSIONS ───────────────────────────────────────────

  it('has all 7 utility vectors defined', () => {
    const vectors: UtilityVector[] = [
      'GASTRIC',
      'BUTCHERY',
      'INCUBATION',
      'SCULPTURE',
      'PARASITISM',
      'THRALL',
      'DISTRIBUTED',
    ]
    for (const v of vectors) {
      expect(TERMINAL_CONVERSIONS[v]).toBeDefined()
    }
  })

  it('has no extra or missing vectors', () => {
    const keys = Object.keys(TERMINAL_CONVERSIONS).sort()
    const expected = [
      'BUTCHERY',
      'DISTRIBUTED',
      'GASTRIC',
      'INCUBATION',
      'PARASITISM',
      'SCULPTURE',
      'THRALL',
    ]
    expect(keys).toEqual(expected)
  })

  it('all terminal conversions have required fields', () => {
    for (const key of Object.keys(TERMINAL_CONVERSIONS)) {
      const conv = TERMINAL_CONVERSIONS[key as keyof typeof TERMINAL_CONVERSIONS]
      expect(conv).toHaveProperty('label')
      expect(conv).toHaveProperty('outcome')
      expect(conv).toHaveProperty('description')
      expect(typeof conv.label).toBe('string')
      expect(typeof conv.outcome).toBe('string')
      expect(typeof conv.description).toBe('string')
    }
  })

  it('all outcomes match consumed-* pattern', () => {
    for (const key of Object.keys(TERMINAL_CONVERSIONS)) {
      const conv = TERMINAL_CONVERSIONS[key as keyof typeof TERMINAL_CONVERSIONS]
      expect(conv.outcome).toMatch(/^consumed-/)
    }
  })

  it('labels are unique across all vectors', () => {
    const labels = Object.values(TERMINAL_CONVERSIONS).map((c) => c.label)
    const unique = new Set(labels)
    expect(unique.size).toBe(labels.length)
  })

  it('BUTCHERY uses Material Yield outcome', () => {
    expect(TERMINAL_CONVERSIONS.BUTCHERY.outcome).toBe('consumed-material')
    expect(TERMINAL_CONVERSIONS.BUTCHERY.label).toBe('Material Yield')
  })

  it('INCUBATION uses Brood Vessel outcome', () => {
    expect(TERMINAL_CONVERSIONS.INCUBATION.outcome).toBe('consumed-vessel')
    expect(TERMINAL_CONVERSIONS.INCUBATION.label).toBe('Brood Vessel')
  })

  it('DISTRIBUTED uses Industrial Base outcome', () => {
    expect(TERMINAL_CONVERSIONS.DISTRIBUTED.outcome).toBe('consumed-distributed')
    expect(TERMINAL_CONVERSIONS.DISTRIBUTED.label).toBe('Industrial Base')
  })

  // ── DEFAULT_DISSOLUTION_CONFIG (#472) ───────────────────────────────
  // #448 introduced DissolutionConfig/DEFAULT_DISSOLUTION_CONFIG but never
  // tested that it actually reproduces STAGE_MUTATIONS byte-for-byte, which
  // is the non-negotiable backward-compatibility requirement from #448's own
  // success criteria.

  it('terminalStage is 5', () => {
    expect(DEFAULT_DISSOLUTION_CONFIG.terminalStage).toBe(5)
  })

  it('stages 1-5 are byte-identical to STAGE_MUTATIONS', () => {
    for (let s = 1; s <= 5; s++) {
      expect(DEFAULT_DISSOLUTION_CONFIG.stages[s]).toEqual(STAGE_MUTATIONS[s as 1 | 2 | 3 | 4 | 5])
    }
  })

  it('has exactly 5 stages defined, no extras', () => {
    const keys = Object.keys(DEFAULT_DISSOLUTION_CONFIG.stages).map(Number).sort()
    expect(keys).toEqual([1, 2, 3, 4, 5])
  })
})
