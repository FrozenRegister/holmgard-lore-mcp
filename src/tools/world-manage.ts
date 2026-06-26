import type { ToolHandler } from './types'
import { makeError } from '../lib/rpc'
import { handle_thread_tick, handle_get_relationship, handle_get_faction_standing, handle_get_entity_knowledge, handle_get_location_occupants, handle_get_reachable_locations, handle_sense_environment, handle_get_thread_comparison, handle_check_convergence, handle_get_world_state } from './world'

const ACTION_MAP: Record<string, ToolHandler> = {
  thread_tick:             handle_thread_tick,
  get_relationship:        handle_get_relationship,
  get_faction_standing:    handle_get_faction_standing,
  get_entity_knowledge:    handle_get_entity_knowledge,
  get_location_occupants:  handle_get_location_occupants,
  get_reachable_locations: handle_get_reachable_locations,
  sense_environment:       handle_sense_environment,
  get_thread_comparison:   handle_get_thread_comparison,
  check_convergence:       handle_check_convergence,
  get_world_state:         handle_get_world_state,
}

export const handle_world_manage: ToolHandler = ({ c, id, args, isAuthenticated }) => {
  const { action, ...rest } = args
  if (!action || typeof action !== 'string')
    return Promise.resolve(c.json(makeError(id, -32602, 'Missing required param: action'), 200))
  const handler = ACTION_MAP[action]
  if (!handler)
    return Promise.resolve(c.json(makeError(id, -32602, `Unknown action "${action}"`), 200))
  return handler({ c, id, args: rest, isAuthenticated })
}
