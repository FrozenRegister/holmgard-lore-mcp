import { EntityId } from '../types/entity.ts';
import { Tick } from '../types/time.ts';
import { StageMutation, UtilityVector, TerminalConversion, DissolutionConfig, loadDissolutionConfig } from './dissolution_config.ts';

export function stageMutationFor(
  stage: number,
  config: DissolutionConfig = loadDissolutionConfig()
): StageMutation | null {
  return config.stages[stage] ?? null;
}

export function resolveTerminalConversion(
  vector: string,
  config: DissolutionConfig = loadDissolutionConfig()
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
  // Original implementation using 0-based stages
  const stage = Math.floor(activity / 10);
  return {
    is_staged: stage >= 0,
    stage: stage >= 0 ? Math.min(stage, 4) : null,
    total_stages: 5
  };
}

export function buildSensoryProfile(
  stage: number,
  config: DissolutionConfig = loadDissolutionConfig()
): StageMutation['sensory'] {
  const mutation = stageMutationFor(stage, config);
  return mutation?.sensory ?? {
    scent: '',
    thermal: null,
    texture: null,
    visual: null,
    sound: null
  };
}

export function buildMechanicalEffects(
  stage: number,
  config: DissolutionConfig = loadDissolutionConfig()
): StageMutation['mechanical'] {
  const mutation = stageMutationFor(stage, config);
  return mutation?.mechanical ?? {
    resistance_decrement: 0,
    movement_locked: false,
    communication_penalty: 0,
    hp_drain_per_tick: 0,
    knowledge_leakage: false,
    terminal: false
  };
}