import type { ToolHandler } from './types'
import { makeError } from '../lib/rpc'
import { handle_append_event, handle_get_event_log, handle_recent_changes, handle_tag_topic, handle_find_by_tag, handle_list_tags, handle_bookmark_state, handle_world_diff, handle_plant_setup, handle_pay_off_setup, handle_list_unpaid_setups, handle_set_goal, handle_check_continuity } from './meta'

const ACTION_MAP: Record<string, ToolHandler> = {
  append_event:       handle_append_event,
  get_event_log:      handle_get_event_log,
  recent_changes:     handle_recent_changes,
  tag_topic:          handle_tag_topic,
  find_by_tag:        handle_find_by_tag,
  list_tags:          handle_list_tags,
  bookmark_state:     handle_bookmark_state,
  world_diff:         handle_world_diff,
  plant_setup:        handle_plant_setup,
  pay_off_setup:      handle_pay_off_setup,
  list_unpaid_setups: handle_list_unpaid_setups,
  set_goal:           handle_set_goal,
  check_continuity:   handle_check_continuity,
}

export const handle_continuity_manage: ToolHandler = ({ c, id, args, isAuthenticated }) => {
  const { action, ...rest } = args
  if (!action || typeof action !== 'string')
    return Promise.resolve(c.json(makeError(id, -32602, 'Missing required param: action'), 200))
  const handler = ACTION_MAP[action]
  if (!handler)
    return Promise.resolve(c.json(makeError(id, -32602, `Unknown action "${action}"`), 200))
  return handler({ c, id, args: rest, isAuthenticated })
}
