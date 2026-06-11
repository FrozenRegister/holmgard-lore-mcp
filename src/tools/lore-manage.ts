import type { ToolHandler } from './types'
import { makeError } from '../lib/rpc'
import { handle_list_topics, handle_list_maps, handle_get_lore, handle_get_lore_batch, handle_get_lore_section, handle_validate_topic_exists, handle_search_lore } from './system'
import { handle_set_lore, handle_delete_lore, handle_patch_lore, handle_batch_set_lore, handle_batch_mutate, handle_restore_lore, handle_get_topic_histories, handle_increment_topic_field, handle_append_to_section } from './lore'

const ACTION_MAP: Record<string, ToolHandler> = {
  get:            handle_get_lore,
  get_batch:      handle_get_lore_batch,
  get_section:    handle_get_lore_section,
  list:           handle_list_topics,
  list_maps:      handle_list_maps,
  search:         handle_search_lore,
  validate:       handle_validate_topic_exists,
  set:            handle_set_lore,
  delete:         handle_delete_lore,
  patch:          handle_patch_lore,
  batch_set:      handle_batch_set_lore,
  batch_mutate:   handle_batch_mutate,
  restore:        handle_restore_lore,
  history:        handle_get_topic_histories,
  increment:      handle_increment_topic_field,
  append_section: handle_append_to_section,
}

export const handle_lore_manage: ToolHandler = ({ c, id, args, isAuthenticated }) => {
  const { action, ...rest } = args
  if (!action || typeof action !== 'string')
    return Promise.resolve(c.json(makeError(id, -32602, 'Missing required param: action'), 200))
  const handler = ACTION_MAP[action]
  if (!handler)
    return Promise.resolve(c.json(makeError(id, -32602, `Unknown action "${action}"`), 200))
  return handler({ c, id, args: rest, isAuthenticated })
}
