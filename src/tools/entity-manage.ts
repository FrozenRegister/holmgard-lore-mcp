import type { ActionSpec, ToolHandler } from './types'
import { makeActionDispatcher, defineAction } from './types'
import {
  handle_resolve_interaction, resolveInteractionSchema,
  handle_analyze_utility, analyzeUtilitySchema,
  handle_map_integration, mapIntegrationSchema,
  handle_generate_entity, generateEntitySchema,
  handle_roll_encounter, rollEncounterSchema,
  handle_advance_state_stage, advanceStateStageSchema,
  handle_process_stage_batch, processStageBatchSchema,
  handle_get_sensory_profile, getSensoryProfileSchema,
  handle_get_compatibility, getCompatibilitySchema,
  handle_get_inventory, getInventorySchema,
  handle_transfer_item, transferItemSchema,
  handle_list_consumption_timelines, listConsumptionTimelinesSchema,
  handle_list_active_threads,
  handle_destroy_entity, destroyEntitySchema,
  handle_create_consumption_timeline, createConsumptionTimelineSchema,
  handle_set_consumption_timeline, setConsumptionTimelineSchema,
} from './entity'
import { handle_move_entity, moveEntitySchema } from './lore'

// `list_active_threads` takes no args at all (no schema to enforce), so it stays a
// legacy raw ToolHandler — makeActionDispatcher supports both forms in the same map.
const ACTION_MAP: Record<string, ActionSpec | ToolHandler> = {
  generate: defineAction(generateEntitySchema, handle_generate_entity, {
    archetype_key: 'archetype:deer', location_key: 'location:marsh-end',
  }),
  move: defineAction(moveEntitySchema, handle_move_entity, {
    entity_key: 'character:eira-holt', new_location_key: 'location:marsh-end',
  }),
  roll_encounter: defineAction(rollEncounterSchema, handle_roll_encounter, {
    location_key: 'location:marsh-end', threat_level: 5,
  }),
  advance_stage: defineAction(advanceStateStageSchema, handle_advance_state_stage, {
    entity_key: 'character:eira-holt',
  }),
  batch_stage: defineAction(processStageBatchSchema, handle_process_stage_batch, {
    location_key: 'location:marsh-end',
  }),
  get_inventory: defineAction(getInventorySchema, handle_get_inventory, {
    entity_key: 'character:eira-holt',
  }),
  transfer_item: defineAction(transferItemSchema, handle_transfer_item, {
    from_entity: 'character:eira-holt', to_entity: 'character:gerent', item_key: 'sword', quantity: 1,
  }),
  get_sensory_profile: defineAction(getSensoryProfileSchema, handle_get_sensory_profile, {
    entity_key: 'character:eira-holt',
  }),
  get_compatibility: defineAction(getCompatibilitySchema, handle_get_compatibility, {
    entity_a: 'character:eira-holt', entity_b: 'character:gerent', interaction_type: 'hunt',
  }),
  analyze_utility: defineAction(analyzeUtilitySchema, handle_analyze_utility, {
    entity_id: 'character:eira-holt', utility_vector: 'GASTRIC', entity_role: 'subject',
  }),
  map_integration: defineAction(mapIntegrationSchema, handle_map_integration, {
    source_id: 'character:eira-holt', target_id: 'character:gerent', integration_depth: 0.5,
  }),
  list_consumption_timelines: defineAction(listConsumptionTimelinesSchema, handle_list_consumption_timelines, {
    status_filter: 'all', limit: 50,
  }),
  list_active_threads:        handle_list_active_threads,
  resolve_interaction: defineAction(resolveInteractionSchema, handle_resolve_interaction, {
    entity_a_id: 'character:eira-holt', entity_b_id: 'character:gerent', action_type: 'confront',
  }),
  destroy: defineAction(destroyEntitySchema, handle_destroy_entity, {
    entity_key: 'entity:temp-encounter-12345',
  }),
  create_consumption_timeline: defineAction(createConsumptionTimelineSchema, handle_create_consumption_timeline, {
    entity_key: 'character:eira-holt', predator_key: 'character:gerent', stages: 5, stage_timer: 10, terminal_state: 'consumed',
  }),
  set_consumption_timeline: defineAction(setConsumptionTimelineSchema, handle_set_consumption_timeline, {
    entity_key: 'character:eira-holt', current_stage: 2,
  }),
}

export const handle_entity_manage: ToolHandler = makeActionDispatcher('entity_manage', ACTION_MAP)
