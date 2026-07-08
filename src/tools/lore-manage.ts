import type { ActionSpec, ToolHandler } from './types'
import { makeActionDispatcher, defineAction } from './types'
import {
  handle_get_lore, getLoreSchema,
  handle_get_lore_batch, getLoreBatchSchema,
  handle_get_lore_section, getLoreSectionSchema,
  handle_list_topics, listTopicsSchema,
  handle_list_maps, listMapsSchema,
  handle_get_map, getMapSchema,
  handle_search_lore, searchLoreSchema,
  handle_validate_topic_exists, validateTopicExistsSchema,
} from './system'
import { handle_set_lore, handle_delete_lore, handle_patch_lore, handle_batch_set_lore, handle_batch_mutate, handle_restore_lore, handle_get_topic_histories, handle_increment_topic_field, handle_append_to_section } from './lore'

// Read-side actions (system.ts) are converted to the typed ActionSpec pattern (#237/#238).
// Write-side actions (lore.ts) are still legacy raw ToolHandlers pending a follow-up PR —
// makeActionDispatcher supports both forms in the same map so the file migrates incrementally.
const ACTION_MAP: Record<string, ActionSpec | ToolHandler> = {
  get: defineAction(getLoreSchema, handle_get_lore, { query: 'character:eira-holt' }),
  get_batch: defineAction(getLoreBatchSchema, handle_get_lore_batch, {
    keys: ['character:eira-holt', 'location:marsh-end'],
  }),
  get_section: defineAction(getLoreSectionSchema, handle_get_lore_section, {
    key: 'character:eira-holt', sections: ['Inventory'],
  }),
  list: defineAction(listTopicsSchema, handle_list_topics),
  list_maps: defineAction(listMapsSchema, handle_list_maps),
  get_map: defineAction(getMapSchema, handle_get_map, { map_id: 'holmgard-overworld' }),
  search: defineAction(searchLoreSchema, handle_search_lore, { query: 'tribunal' }),
  validate: defineAction(validateTopicExistsSchema, handle_validate_topic_exists, { query_string: 'eira-holt' }),
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

export const handle_lore_manage: ToolHandler = makeActionDispatcher('lore_manage', ACTION_MAP)
