export interface StageMutation {
  sensory: {
    scent: string
    thermal: string | null
    texture: string | null
    visual: string | null
    sound: string | null
  }
  mechanical: {
    /** Weight-2 resistance decrement per stage */
    resistance_decrement: number
    /** Movement disabled (true for Stage 2+) */
    movement_locked: boolean
    /** Communication check penalty (absolute) */
    communication_penalty: number
    /** HP drain per tick */
    hp_drain_per_tick: number
    /** Knowledge leakage starts (Stage 4+) */
    knowledge_leakage: boolean
    /** Terminal state reached */
    terminal: boolean
  }
}

export type UtilityVector =
  'GASTRIC' | 'BUTCHERY' | 'INCUBATION' | 'SCULPTURE' | 'PARASITISM' | 'THRALL' | 'DISTRIBUTED'

export interface TerminalConversion {
  /** Human-readable label for the terminal object state */
  label: string
  /** What the entity becomes */
  outcome: string
  /** Narrative descriptor for the conversion pathway */
  description: string
}

export interface DissolutionConfig {
  /**
   * Map of stage number to StageMutation definition.
   * Stage numbers are 1-indexed and must be contiguous from 1 to terminalStage.
   */
  stages: Record<number, StageMutation>
  /**
   * Terminal stage for forced conversion.
   * Stages beyond this point are considered terminal conversions.
   */
  terminalStage: number
}

/**
 * Default dissolution configuration - 5 stages.
 * This config matches the hardcoded STAGE_MUTATIONS for backward compatibility.
 */
export const DEFAULT_DISSOLUTION_CONFIG: DissolutionConfig = {
  stages: {
    1: {
      sensory: {
        scent: 'fear-pheromone_spike',
        thermal: null,
        texture: null,
        visual: null,
        sound: null,
      },
      mechanical: {
        resistance_decrement: 0.05,
        movement_locked: false,
        communication_penalty: 0,
        hp_drain_per_tick: 0,
        knowledge_leakage: false,
        terminal: false,
      },
    },
    2: {
      sensory: {
        scent: 'fear-pheromone_spike, metabolic_stress',
        thermal: 'Shaper-radiance: ambient +10°F',
        texture: null,
        visual: null,
        sound: null,
      },
      mechanical: {
        resistance_decrement: 0.1,
        movement_locked: true,
        communication_penalty: 0,
        hp_drain_per_tick: 0,
        knowledge_leakage: false,
        terminal: false,
      },
    },
    3: {
      sensory: {
        scent: 'rending_tissue, metabolic_stress',
        thermal: 'Shaper-radiance: ambient +10°F',
        texture: 'epidermal_softening',
        visual: null,
        sound: 'voice_degradation',
      },
      mechanical: {
        resistance_decrement: 0.15,
        movement_locked: true,
        communication_penalty: -4,
        hp_drain_per_tick: 2,
        knowledge_leakage: false,
        terminal: false,
      },
    },
    4: {
      sensory: {
        scent: 'rending_tissue, metabolic_stress',
        thermal: 'Shaper-radiance: ambient +10°F',
        texture: 'epidermal_softening, surface_membrane_transparency',
        visual: 'bioluminescence_shift_to_predator_spectrum',
        sound: 'voice_degradation, internal_hum',
      },
      mechanical: {
        resistance_decrement: 0.2,
        movement_locked: true,
        communication_penalty: -6,
        hp_drain_per_tick: 4,
        knowledge_leakage: true,
        terminal: false,
      },
    },
    5: {
      sensory: {
        scent: 'rendered_fat / fermentation / mineral_stillness',
        thermal: 'cooling_to_ambient',
        texture: 'complete_tissue_restructuring',
        visual: 'identity_markers_dissolving',
        sound: 'silence',
      },
      mechanical: {
        resistance_decrement: 0.3,
        movement_locked: true,
        communication_penalty: -10,
        hp_drain_per_tick: 8,
        knowledge_leakage: true,
        terminal: true,
      },
    },
  },
  terminalStage: 5,
}

/**
 * Legacy constant for backward compatibility.
 * Re-exported from the default config so existing consumers of STAGE_MUTATIONS
 * keep working unchanged.
 */
export const STAGE_MUTATIONS: Record<1 | 2 | 3 | 4 | 5, StageMutation> = {
  1: DEFAULT_DISSOLUTION_CONFIG.stages[1],
  2: DEFAULT_DISSOLUTION_CONFIG.stages[2],
  3: DEFAULT_DISSOLUTION_CONFIG.stages[3],
  4: DEFAULT_DISSOLUTION_CONFIG.stages[4],
  5: DEFAULT_DISSOLUTION_CONFIG.stages[5],
}

// Reuse the exact vocabulary from #410/#315
export const TERMINAL_CONVERSIONS: Record<UtilityVector, TerminalConversion> = {
  GASTRIC: {
    label: 'Nutrient Slurry',
    outcome: 'consumed-nutrient',
    description:
      'Entity reduced to basic caloric slurry — optimal for enzymatic assimilation over 5–8 days. No consciousness remnant detected.',
  },
  BUTCHERY: {
    label: 'Material Yield',
    outcome: 'consumed-material',
    description:
      'Harvest yields cut of usable material — marbling grade determines quality. Cortisol taint assessed post-mortem.',
  },
  INCUBATION: {
    label: 'Brood Vessel',
    outcome: 'consumed-vessel',
    description:
      'Entity becomes incubation chamber — clutch viability contingent on host compliance throughout term. Consciousness repurposed as brood matrix.',
  },
  SCULPTURE: {
    label: 'Living Ornament',
    outcome: 'consumed-ornament',
    description:
      'Entity frozen in expressive state — permanent living artwork. Consciousness persists in locked state, aware but unable to act.',
  },
  PARASITISM: {
    label: 'Hijacked Host',
    outcome: 'consumed-host',
    description:
      'Neural substrate displaced — predator consciousness now occupies host body. Residual identity fragments may surface under stress.',
  },
  THRALL: {
    label: 'Permanent Thrall',
    outcome: 'consumed-thrall',
    description:
      'Entity permanently conditioned — will serves predator absolutely. No resistance potential detected. Reinforce conditioning at standard intervals.',
  },
  DISTRIBUTED: {
    label: 'Industrial Base',
    outcome: 'consumed-distributed',
    description:
      'Entity rendered into batch component — processed into distributed substrate for industrial use. Caloric density and marbling determine batch grade.',
  },
}
