import type { ActionSpec, ToolHandler } from './types'
import { makeActionDispatcher, defineAction } from './types'
import { handle_resolve_interaction, handle_analyze_utility, handle_map_integration, handle_generate_entity, handle_roll_encounter, handle_advance_state_stage, handle_process_stage_batch, handle_get_sensory_profile, handle_get_compatibility, handle_get_inventory, handle_transfer_item, handle_list_consumption_timelines, handle_list_active_threads, handle_destroy_entity, handle_create_consumption_timeline, handle_set_consumption_timeline } from './entity'
import { handle_move_entity, moveEntitySchema } from './lore'

// `move` is converted to the typed ActionSpec pattern (#237/#238) since its handler
// (handle_move_entity) lives in the now-typed lore.ts. The rest of these actions live
// in entity.ts, which is still legacy raw ToolHandlers pending a follow-up PR (#239) —
// makeActionDispatcher supports both forms in the same map.
const ACTION_MAP: Record<string, ActionSpec | ToolHandler> = {
  generate:                   handle_generate_entity,
  move: defineAction(moveEntitySchema, handle_move_entity, {
    entity_key: 'character:eira-holt', new_location_key: 'location:marsh-end',
  }),
  roll_encounter:             handle_roll_encounter,
  advance_stage:              handle_advance_state_stage,
  batch_stage:                handle_process_stage_batch,
  get_inventory:              handle_get_inventory,
  transfer_item:              handle_transfer_item,
  get_sensory_profile:        handle_get_sensory_profile,
  get_compatibility:          handle_get_compatibility,
  analyze_utility:            handle_analyze_utility,
  map_integration:            handle_map_integration,
  list_consumption_timelines: handle_list_consumption_timelines,
  list_active_threads:        handle_list_active_threads,
  resolve_interaction:        handle_resolve_interaction,
  destroy:                    handle_destroy_entity,
  create_consumption_timeline: handle_create_consumption_timeline,
  set_consumption_timeline:   handle_set_consumption_timeline,
}

export const handle_entity_manage: ToolHandler = makeActionDispatcher('entity_manage', ACTION_MAP)
