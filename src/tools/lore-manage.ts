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
import {
  handle_set_lore, setLoreSchema,
  handle_delete_lore, deleteLoreSchema,
  handle_patch_lore, patchLoreSchema,
  handle_batch_set_lore, batchSetLoreSchema,
  handle_batch_mutate, batchMutateSchema,
  handle_restore_lore, restoreLoreSchema,
  handle_get_topic_histories, getTopicHistoriesSchema,
  handle_increment_topic_field, incrementTopicFieldSchema,
  handle_append_to_section, appendToSectionSchema,
} from './lore'

const ACTION_MAP: Record<string, ActionSpec> = {
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
  set: defineAction(setLoreSchema, handle_set_lore, {
    key: 'character:eira-holt', text: 'Eira Holt is a surgeon...',
  }),
  delete: defineAction(deleteLoreSchema, handle_delete_lore, { key: 'character:eira-holt' }),
  patch: defineAction(patchLoreSchema, handle_patch_lore, {
    key: 'character:eira-holt', operation: 'append', value: 'New inventory item.',
  }),
  batch_set: defineAction(batchSetLoreSchema, handle_batch_set_lore, {
    entries: [{ key: 'character:eira-holt', text: '...' }],
  }),
  batch_mutate: defineAction(batchMutateSchema, handle_batch_mutate, {
    mutations: [{ key: 'character:eira-holt', action: 'increment', field_path: 'Reputation', increment: 1 }],
  }),
  restore: defineAction(restoreLoreSchema, handle_restore_lore, { key: 'character:eira-holt' }),
  history: defineAction(getTopicHistoriesSchema, handle_get_topic_histories, { keys: ['character:eira-holt'] }),
  increment: defineAction(incrementTopicFieldSchema, handle_increment_topic_field, {
    key: 'character:eira-holt', field_path: 'Reputation', increment: 1,
  }),
  append_section: defineAction(appendToSectionSchema, handle_append_to_section, {
    key: 'character:eira-holt', section: 'Inventory', text: 'New item added.',
  }),
}

export const handle_lore_manage: ToolHandler = makeActionDispatcher('lore_manage', ACTION_MAP)
