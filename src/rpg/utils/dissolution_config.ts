export interface StageMutation {
  sensory: {
    scent: string;
    thermal: string | null;
    texture: string | null;
    visual: string | null;
    sound: string | null;
  };
  mechanical: {
    resistance_decrement: number;
    movement_locked: boolean;
    communication_penalty: number;
    hp_drain_per_tick: number;
    knowledge_leakage: boolean;
    terminal: boolean;
  };
}

export type UtilityVector =
  | 'GASTRIC'
  | 'BUTCHERY'
  | 'INCUBATION'
  | 'SCULPTURE'
  | 'PARASITISM'
  | 'THRALL'
  | 'DISTRIBUTED';

export interface TerminalConversion {
  label: string;
  outcome: string;
  description: string;
}

export const DEFAULT_DISSOLUTION_CONFIG = {
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
      }
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
        resistance_decrement: 0.10,
        movement_locked: true,
        communication_penalty: 0,
        hp_drain_per_tick: 0,
        knowledge_leakage: false,
        terminal: false,
      }
    },
    3: {
      sensory: {
        scent: 'fear-pheromone_spike, metabolic_stress, tissue-liquefaction',
        thermal: 'Shaper-radiance: ambient +15°F',
        texture: 'viscous',
        visual: null,
        sound: 'gurgling',
      },
      mechanical: {
        resistance_decrement: 0.15,
        movement_locked: true,
        communication_penalty: 0.5,
        hp_drain_per_tick: 1,
        knowledge_leakage: true,
        terminal: false,
      }
    },
    4: {
      sensory: {
        scent: 'fear-pheromone_spike, metabolic_stress, tissue-liquefaction, organic-acids',
        thermal: 'Shaper-radiance: ambient +20°F',
        texture: 'semi-liquid',
        visual: 'amber-hued',
        sound: 'gurgling, bubbling',
      },
      mechanical: {
        resistance_decrement: 0.20,
        movement_locked: true,
        communication_penalty: 1,
        hp_drain_per_tick: 2,
        knowledge_leakage: true,
        terminal: false,
      }
    },
    5: {
      sensory: {
        scent: 'fear-pheromone_spike, metabolic_stress, tissue-liquefaction, organic-acids, enzymatic-breakdown',
        thermal: 'Shaper-radiance: ambient +25°F',
        texture: 'fully-liquid',
        visual: 'bioluminescent-swirls',
        sound: 'gurgling, bubbling, faint-whispers',
      },
      mechanical: {
        resistance_decrement: 0.25,
        movement_locked: true,
        communication_penalty: 1,
        hp_drain_per_tick: 3,
        knowledge_leakage: true,
        terminal: true,
      }
    }
  },
  terminalConversions: {
    GASTRIC: {
      label: 'Nutrient Slurry',
      outcome: 'consumed-nutrient',
      description: 'Entity reduced to basic caloric slurry — optimal for enzymatic assimilation over 5–8 days. No consciousness remnant detected.',
    },
    BUTCHERY: {
      label: 'Butchered Biomass',
      outcome: 'consumed-butchered',
      description: 'Entity disassembled into clean, modular components — immediate utility for construction or grafting. No regenerative potential.',
    },
    INCUBATION: {
      label: 'Incubation Vessel',
      outcome: 'consumed-incubation',
      description: 'Entity re-purposed as living incubator for new forms. Consciousness fragments may persist as gestational substrate.',
    },
    SCULPTURE: {
      label: 'Living Sculpture',
      outcome: 'consumed-sculpture',
      description: 'Entity transformed into aesthetic form with constrained movement. Consciousness preserved but subjugated to aesthetic function.',
    },
    PARASITISM: {
      label: 'Parasitic Host',
      outcome: 'consumed-parasitism',
      description: 'Entity consumed from within by symbiotic or parasitic system. Consciousness fragmented, partially retained as host controller.',
    },
    THRALL: {
      label: 'Thrall Conversion',
      outcome: 'consumed-thrall',
      description: 'Entity consciousness overwritten with minimal biological preservation. Suitable for simple labor or combat roles.',
    },
    DISTRIBUTED: {
      label: 'Distributed Essence',
      outcome: 'consumed-distributed',
      description: 'Entity consciousness fragmented across multiple nodes or substrates. May reconstitute under specific conditions.',
    }
  }
};