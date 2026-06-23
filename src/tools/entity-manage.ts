import type { ToolHandler } from './types'
import { makeError } from '../lib/rpc'
import { handle_resolve_interaction, handle_analyze_utility, handle_map_integration, handle_generate_entity, handle_roll_encounter, handle_advance_state_stage, handle_process_stage_batch, handle_get_sensory_profile, handle_get_compatibility, handle_get_inventory, handle_transfer_item, handle_list_consumption_timelines, handle_list_active_threads, handle_destroy_entity, handle_create_consumption_timeline, handle_set_consumption_timeline } from './entity'
import { handle_move_entity } from './lore'

const ACTION_MAP: Record<string, ToolHandler> = {
  generate:                     handle_generate_entity,
  move:                         handle_move_entity,
  roll_encounter:               handle_roll_encounter,
  advance_stage:                handle_advance_state_stage,
  batch_stage:                  handle_process_stage_batch,
  get_inventory:                handle_get_inventory,
  transfer_item:                handle_transfer_item,
  get_sensory_profile:          handle_get_sensory_profile,
  get_compatibility:            handle_get_compatibility,
  analyze_utility:              handle_analyze_utility,
  map_integration:              handle_map_integration,
  list_consumption_timelines:   handle_list_consumption_timelines,
  list_active_threads:          handle_list_active_threads,
  resolve_interaction:          handle_resolve_interaction,
  destroy:                      handle_destroy_entity,
  create_consumption_timeline:  handle_create_consumption_timeline,
  set_consumption_timeline:     handle_set_consumption_timeline,
}

export const handle_entity_manage: ToolHandler = ({ c, id, args, isAuthenticated }) => {
  const { action, ...rest } = args
  if (!action || typeof action !== 'string')
    return Promise.resolve(c.json(makeError(id, -32602, 'Missing required param: action'), 200))
  const handler = ACTION_MAP[action]
  if (!handler)
    return Promise.resolve(c.json(makeError(id, -32602, `Unknown action "${action}"`), 200))
  return handler({ c, id, args: rest, isAuthenticated })
}
