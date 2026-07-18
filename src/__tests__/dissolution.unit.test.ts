// src/__tests__/dissolution.unit.test.ts
//
// Phase 0 dissolution primitives unit tests.
// Pure-function tests, no KV/D1 dependencies.
// Tests all 5 stages, all 7 terminal vectors, edge cases.

import { describe, expect, it } from 'vitest'
import {
  STAGE_MUTATIONS,
  stageMutationFor,
  TERMINAL_CONVERSIONS,
  resolveTerminalConversion,
  dissolutionStageCheck,
  consumptionTimelineCheck,
  buildSensoryProfile,
  buildMechanicalEffects,
} from '../rpg/utils/dissolution'

describe('dissolution primitives', () => {
  // ── STAGE_MUTATIONS ───────────────────────────────────────────────

  it('has all 5 stages defined', () => {
    expect(STAGE_MUTATIONS[1]).toBeDefined()
    expect(STAGE_MUTATIONS[2]).toBeDefined()
    expect(STAGE_MUTATIONS[3]).toBeDefined()
    expect(STAGE_MUTATIONS[4]).toBeDefined()
    expect(STAGE_MUTATIONS[5]).toBeDefined()
  })

  it('stage 1 — tenderizing: fear-pheromone spike, no HP drain, not terminal', () => {
    const s1 = STAGE_MUTATIONS[1]
    expect(s1.sensory.scent).toBe('fear-pheromone_spike')
    expect(s1.sensory.thermal).toBeNull()
    expect(s1.sensory.texture).toBeNull()
    expect(s1.sensory.visual).toBeNull()
    expect(s1.sensory.sound).toBeNull()
    expect(s1.mechanical.resistance_decrement).toBe(0.05)
    expect(s1.mechanical.movement_locked).toBe(false)
    expect(s1.mechanical.communication_penalty).toBe(0)
    expect(s1.mechanical.hp_drain_per_tick).toBe(0)
    expect(s1.mechanical.knowledge_leakage).toBe(false)
    expect(s1.mechanical.terminal).toBe(false)
  })

  it('stage 2 — engulfment: thermal +10°F, movement locked, no HP drain', () => {
    const s2 = STAGE_MUTATIONS[2]
    expect(s2.sensory.scent).toContain('metabolic_stress')
    expect(s2.sensory.thermal).toContain('+10°F')
    expect(s2.sensory.texture).toBeNull()
    expect(s2.mechanical.movement_locked).toBe(true)
    expect(s2.mechanical.hp_drain_per_tick).toBe(0)
    expect(s2.mechanical.communication_penalty).toBe(0)
    expect(s2.mechanical.terminal).toBe(false)
  })

  it('stage 3 — dissolution: voice degradation, HP drain 2/tick, comm penalty -4', () => {
    const s3 = STAGE_MUTATIONS[3]
    expect(s3.sensory.sound).toContain('voice_degradation')
    expect(s3.sensory.texture).toContain('epidermal_softening')
    expect(s3.mechanical.communication_penalty).toBe(-4)
    expect(s3.mechanical.hp_drain_per_tick).toBe(2)
    expect(s3.mechanical.movement_locked).toBe(true)
    expect(s3.mechanical.terminal).toBe(false)
  })

  it('stage 4 — assimilation: knowledge leakage, bioluminescence shift', () => {
    const s4 = STAGE_MUTATIONS[4]
    expect(s4.sensory.visual).toContain('bioluminescence_shift')
    expect(s4.sensory.texture).toContain('surface_membrane_transparency')
    expect(s4.mechanical.knowledge_leakage).toBe(true)
    expect(s4.mechanical.hp_drain_per_tick).toBe(4)
    expect(s4.mechanical.communication_penalty).toBe(-6)
    expect(s4.mechanical.terminal).toBe(false)
  })

  it('stage 5 — terminal: all effects max, terminal=true', () => {
    const s5 = STAGE_MUTATIONS[5]
    expect(s5.sensory.scent).toContain('rendered_fat')
    expect(s5.sensory.sound).toBe('silence')
    expect(s5.sensory.visual).toContain('identity_markers_dissolving')
    expect(s5.mechanical.resistance_decrement).toBe(0.30)
    expect(s5.mechanical.hp_drain_per_tick).toBe(8)
    expect(s5.mechanical.communication_penalty).toBe(-10)
    expect(s5.mechanical.knowledge_leakage).toBe(true)
    expect(s5.mechanical.terminal).toBe(true)
  })

  // ── stageMutationFor ───────────────────────────────────────────────

  it('stageMutationFor returns correct mutation for valid stages 1-5', () => {
    for (let s = 1; s <= 5; s++) {
      const mut = stageMutationFor(s)
      expect(mut).not.toBeNull()
      expect(mut!.mechanical.terminal).toBe(s === 5)
    }
  })

  it('stageMutationFor returns null for stage 0', () => {
    expect(stageMutationFor(0)).toBeNull()
  })

  it('stageMutationFor returns null for stage 6', () => {
    expect(stageMutationFor(6)).toBeNull()
  })

  it('stageMutationFor returns null for negative stages', () => {
    expect(stageMutationFor(-1)).toBeNull()
  })

  it('stageMutationFor returns null for non-integer stages', () => {
    expect(stageMutationFor(2.5)).toBeNull()
  })

  // ── TERMINAL_CONVERSIONS ───────────────────────────────────────────

  it('has all 7 utility vectors defined', () => {
    const vectors = ['GASTRIC', 'BUTCHERY', 'INCUBATION', 'SCULPTURE', 'PARASITISM', 'THRALL', 'DISTRIBUTED']
    for (const v of vectors) {
      expect(TERMINAL_CONVERSIONS[v as keyof typeof TERMINAL_CONVERSIONS]).toBeDefined()
    }
  })

  it('GASTRIC terminal: consumed-nutrient', () => {
    const conv = TERMINAL_CONVERSIONS.GASTRIC
    expect(conv.label).toBe('Nutrient Slurry')
    expect(conv.outcome).toBe('consumed-nutrient')
    expect(conv.description).toContain('caloric slurry')
  })

  it('BUTCHERY terminal: consumed-material', () => {
    const conv = TERMINAL_CONVERSIONS.BUTCHERY
    expect(conv.label).toBe('Material Yield')
    expect(conv.outcome).toBe('consumed-material')
  })

  it('INCUBATION terminal: consumed-vessel', () => {
    const conv = TERMINAL_CONVERSIONS.INCUBATION
    expect(conv.label).toBe('Brood Vessel')
    expect(conv.outcome).toBe('consumed-vessel')
  })

  it('SCULPTURE terminal: consumed-ornament', () => {
    const conv = TERMINAL_CONVERSIONS.SCULPTURE
    expect(conv.label).toBe('Living Ornament')
    expect(conv.outcome).toBe('consumed-ornament')
  })

  it('PARASITISM terminal: consumed-host', () => {
    const conv = TERMINAL_CONVERSIONS.PARASITISM
    expect(conv.label).toBe('Hijacked Host')
    expect(conv.outcome).toBe('consumed-host')
  })

  it('THRALL terminal: consumed-thrall', () => {
    const conv = TERMINAL_CONVERSIONS.THRALL
    expect(conv.label).toBe('Permanent Thrall')
    expect(conv.outcome).toBe('consumed-thrall')
  })

  it('DISTRIBUTED terminal: consumed-distributed', () => {
    const conv = TERMINAL_CONVERSIONS.DISTRIBUTED
    expect(conv.label).toBe('Industrial Base')
    expect(conv.outcome).toBe('consumed-distributed')
  })

  // ── resolveTerminalConversion ──────────────────────────────────────

  it('resolveTerminalConversion returns GASTRIC for uppercase input', () => {
    const conv = resolveTerminalConversion('GASTRIC')
    expect(conv.label).toBe('Nutrient Slurry')
  })

  it('resolveTerminalConversion returns GASTRIC for lowercase input', () => {
    const conv = resolveTerminalConversion('gastric')
    expect(conv.label).toBe('Nutrient Slurry')
  })

  it('resolveTerminalConversion returns GASTRIC for mixed-case input', () => {
    const conv = resolveTerminalConversion('Gastric')
    expect(conv.label).toBe('Nutrient Slurry')
  })

  it('resolveTerminalConversion returns BUTCHERY for BUTCHERY', () => {
    const conv = resolveTerminalConversion('BUTCHERY')
    expect(conv.outcome).toBe('consumed-material')
  })

  it('resolveTerminalConversion returns generic for unknown vector', () => {
    const conv = resolveTerminalConversion('UNKNOWN_VECTOR')
    expect(conv.label).toBe('Unknown Conversion')
    expect(conv.outcome).toBe('consumed-unknown')
    expect(conv.description).toContain('UNKNOWN_VECTOR')
  })

  // ── dissolutionStageCheck ──────────────────────────────────────────

  it('dissolutionStageCheck returns staged=true for staged death_mode with valid stage', () => {
    const result = dissolutionStageCheck({
      death_mode: 'staged',
      dissolution_stage: 3,
      dissolution_stages: 5,
    })
    expect(result.is_staged).toBe(true)
    expect(result.stage).toBe(3)
    expect(result.total_stages).toBe(5)
  })

  it('dissolutionStageCheck returns staged=false for instant death_mode', () => {
    const result = dissolutionStageCheck({
      death_mode: 'instant',
      dissolution_stage: null,
      dissolution_stages: null,
    })
    expect(result.is_staged).toBe(false)
    expect(result.stage).toBeNull()
    expect(result.total_stages).toBeNull()
  })

  it('dissolutionStageCheck returns staged=false for null dissolution_stage', () => {
    const result = dissolutionStageCheck({
      death_mode: 'staged',
      dissolution_stage: null,
      dissolution_stages: 5,
    })
    expect(result.is_staged).toBe(false)
    expect(result.stage).toBeNull()
  })

  it('dissolutionStageCheck returns total_stages=null when dissolution_stages is null', () => {
    const result = dissolutionStageCheck({
      death_mode: 'staged',
      dissolution_stage: 2,
      dissolution_stages: null,
    })
    expect(result.is_staged).toBe(true)
    expect(result.stage).toBe(2)
    expect(result.total_stages).toBeNull()
  })

  // ── consumptionTimelineCheck ───────────────────────────────────────

  it('consumptionTimelineCheck parses standard markdown format', () => {
    const text = '**Name:** Test Entity\n**Status:** active\n**Consumption-Timeline:** hours to days\n**Processor:** leonar-2'
    const info = consumptionTimelineCheck(text)
    expect(info.timeline_remaining).toBe('hours to days')
    expect(info.status).toBe('active')
    expect(info.processor).toBe('leonar-2')
  })

  it('consumptionTimelineCheck falls back to projected timeline', () => {
    const text = '**Projected-Consumption-Timeline:** weeks to months\n**Status:** active'
    const info = consumptionTimelineCheck(text)
    expect(info.timeline_remaining).toBe('weeks to months')
  })

  it('consumptionTimelineCheck returns nulls when no timeline present', () => {
    const text = '**Name:** Normal Entity\n**Description:** Just a regular character.'
    const info = consumptionTimelineCheck(text)
    expect(info.timeline_remaining).toBeNull()
    expect(info.status).toBeNull()
    expect(info.processor).toBeNull()
  })

  it('consumptionTimelineCheck handles hyphenated Consumption-Timeline', () => {
    const text = '**Consumption-Timeline:** imminent (hours)'
    const info = consumptionTimelineCheck(text)
    expect(info.timeline_remaining).toBe('imminent (hours)')
  })

  // ── buildSensoryProfile ────────────────────────────────────────────

  it('buildSensoryProfile for stage 1: only scent', () => {
    const profile = buildSensoryProfile(1)
    expect(profile.scent).toHaveLength(1)
    expect(profile.scent[0]).toBe('fear-pheromone_spike')
    expect(profile.thermal).toHaveLength(0)
    expect(profile.texture).toHaveLength(0)
    expect(profile.visual).toHaveLength(0)
    expect(profile.sound).toHaveLength(0)
  })

  it('buildSensoryProfile for stage 2: scent + thermal', () => {
    const profile = buildSensoryProfile(2)
    expect(profile.scent).toHaveLength(2)
    expect(profile.thermal).toHaveLength(1)
    expect(profile.thermal[0]).toContain('+10°F')
    expect(profile.texture).toHaveLength(0)
  })

  it('buildSensoryProfile for stage 3: cumulative scent + thermal + texture + sound', () => {
    const profile = buildSensoryProfile(3)
    // scent accumulates from stages 1, 2, and 3
    expect(profile.scent).toHaveLength(3)
    // thermal accumulates from stages 2 and 3 (both have thermal entries)
    expect(profile.thermal).toHaveLength(2)
    expect(profile.texture).toHaveLength(1)
    expect(profile.texture[0]).toBe('epidermal_softening')
    expect(profile.sound).toHaveLength(1)
    expect(profile.sound[0]).toBe('voice_degradation')
    expect(profile.visual).toHaveLength(0)
  })

  it('buildSensoryProfile for stage 5: all 5 senses have entries', () => {
    const profile = buildSensoryProfile(5)
    expect(profile.scent.length).toBeGreaterThan(0)
    expect(profile.thermal.length).toBeGreaterThan(0)
    expect(profile.texture.length).toBeGreaterThan(0)
    expect(profile.visual.length).toBeGreaterThan(0)
    expect(profile.sound.length).toBeGreaterThan(0)
  })

  it('buildSensoryProfile for stage 0: empty arrays', () => {
    const profile = buildSensoryProfile(0)
    expect(profile.scent).toHaveLength(0)
    expect(profile.thermal).toHaveLength(0)
    expect(profile.texture).toHaveLength(0)
    expect(profile.visual).toHaveLength(0)
    expect(profile.sound).toHaveLength(0)
  })

  // ── buildMechanicalEffects ─────────────────────────────────────────

  it('buildMechanicalEffects for stage 1: resistance decrement 0.05, no locks', () => {
    const effects = buildMechanicalEffects(1)
    expect(effects.resistance_decrement).toBe(0.05)
    expect(effects.movement_locked).toBe(false)
    expect(effects.communication_penalty).toBe(0)
    expect(effects.hp_drain_per_tick).toBe(0)
    expect(effects.knowledge_leakage).toBe(false)
    expect(effects.terminal).toBe(false)
  })

  it('buildMechanicalEffects for stage 2: movement locked', () => {
    const effects = buildMechanicalEffects(2)
    expect(effects.movement_locked).toBe(true)
    expect(effects.hp_drain_per_tick).toBe(0)
    expect(effects.communication_penalty).toBe(0)
    expect(effects.knowledge_leakage).toBe(false)
  })

  it('buildMechanicalEffects for stage 3: HP drain 2, comm penalty -4', () => {
    const effects = buildMechanicalEffects(3)
    expect(effects.hp_drain_per_tick).toBe(2)
    expect(effects.communication_penalty).toBe(-4)
    expect(effects.knowledge_leakage).toBe(false)
  })

  it('buildMechanicalEffects for stage 4: knowledge leakage active', () => {
    const effects = buildMechanicalEffects(4)
    expect(effects.knowledge_leakage).toBe(true)
    expect(effects.hp_drain_per_tick).toBe(4)
    expect(effects.communication_penalty).toBe(-6)
  })

  it('buildMechanicalEffects for stage 5: terminal with max values', () => {
    const effects = buildMechanicalEffects(5)
    expect(effects.terminal).toBe(true)
    expect(effects.resistance_decrement).toBe(0.30)
    expect(effects.hp_drain_per_tick).toBe(8)
    expect(effects.communication_penalty).toBe(-10)
    expect(effects.movement_locked).toBe(true)
    expect(effects.knowledge_leakage).toBe(true)
  })

  it('buildMechanicalEffects for stage 0: zero values', () => {
    const effects = buildMechanicalEffects(0)
    expect(effects.resistance_decrement).toBe(0)
    expect(effects.movement_locked).toBe(false)
    expect(effects.communication_penalty).toBe(0)
    expect(effects.hp_drain_per_tick).toBe(0)
    expect(effects.knowledge_leakage).toBe(false)
    expect(effects.terminal).toBe(false)
  })
})