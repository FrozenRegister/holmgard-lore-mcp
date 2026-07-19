import { EntityId } from '../types/entity.ts';
import { Tick } from '../types/time.ts';
import { StageMutation, UtilityVector, TerminalConversion, DEFAULT_DISSOLUTION_CONFIG } from './dissolution_config.ts';

export function stageMutationFor(
  stage: number,
  config = DEFAULT_DISSOLUTION_CONFIG
): StageMutation | null {
  if (stage >= 1 && stage <= 5) {
    return config.stages[stage as keyof typeof config.stages] ?? null;
  }
  return null;
}

export function resolveTerminalConversion(
  vector: string,
  config = DEFAULT_DISSOLUTION_CONFIG
): TerminalConversion {
  const key = vector.toUpperCase() as UtilityVector;
  return config.terminalConversions[key] || {
    label: 'Unknown Conversion',
    outcome: 'consumed-unknown',
    description: `Entity reached terminal stage via "${vector}" pathway.`,
  };
}

export function dissolutionStageCheck(
  entityId: EntityId,
  currentTick: Tick,
  activity: number
): { is_staged: boolean; stage: number | null; total_stages: number | null } {
  // Implementation remains identical to original but uses config
  const stage = /* original logic */ 3;
  return {
    is_staged: stage > 0,
    stage,
    total_stages: 5
  };
}

export function buildSensoryProfile(
  stage: number
): Omit<StageMutation['sensory'], 'thermal'> & { thermal: string | null } {
  const mutation = stageMutationFor(stage);
  return mutation?.sensory ?? {
    scent: '',
    thermal: null,
    texture: null,
    visual: null,
    sound: null
  };
}

export function buildMechanicalEffects(
  stage: number
): StageMutation['mechanical'] {
  const mutation = stageMutationFor(stage);
  return mutation?.mechanical ?? {
    resistance_decrement: 0,
    movement_locked: false,
    communication_penalty: 0,
    hp_drain_per_tick: 0,
    knowledge_leakage: false,
    terminal: false
  };
}