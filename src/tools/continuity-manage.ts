import type { ActionSpec, ToolHandler } from './types'
import { makeActionDispatcher, defineAction } from './types'
import {
  handle_append_event, appendEventSchema,
  handle_get_event_log, getEventLogSchema,
  handle_canonize, canonizeSchema,
  handle_migrate_events, migrateEventsSchema,
  handle_recent_changes, recentChangesSchema,
  handle_tag_topic, handle_find_by_tag, handle_list_tags, handle_bookmark_state, handle_world_diff, handle_plant_setup, handle_pay_off_setup, handle_list_unpaid_setups, handle_set_goal, handle_check_continuity,
} from './meta'

const ACTION_MAP: Record<string, ActionSpec | ToolHandler> = {
  // PR 1: Typed event/changelog handlers
  append_event: defineAction(appendEventSchema, handle_append_event, {
    entity_key: 'character:eira-holt', verb: 'departed', object: 'marsh-end', detail: 'Household begins journey', at: '1264-05-01T00:00:00Z'
  }),
  get_event_log: defineAction(getEventLogSchema, handle_get_event_log, {
    entity_key: 'character:eira-holt', limit: 20
  }),
  canonize: defineAction(canonizeSchema, handle_canonize, {
    event_id: 'some-uuid'
  }),
  migrate_events: defineAction(migrateEventsSchema, handle_migrate_events, {
    world_id: 'world-main'
  }),
  recent_changes: defineAction(recentChangesSchema, handle_recent_changes, {
    key_prefix: 'character', limit: 20
  }),
  // PR 2: Legacy setup/continuity handlers (to be refactored)
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

export const handle_continuity_manage: ToolHandler = makeActionDispatcher('continuity_manage', ACTION_MAP)
