import type { ActionSpec, ToolHandler } from './types'
import { makeActionDispatcher, defineAction } from './types'
import {
  handle_append_event,
  appendEventSchema,
  handle_get_event_log,
  getEventLogSchema,
  handle_canonize,
  canonizeSchema,
  handle_migrate_events,
  migrateEventsSchema,
  handle_recent_changes,
  recentChangesSchema,
  handle_taxonomy_list,
  taxonomyListSchema,
  handle_taxonomy_set,
  taxonomySetSchema,
  handle_taxonomy_delete,
  taxonomyDeleteSchema,
  handle_tag_topic,
  tagTopicSchema,
  handle_find_by_tag,
  findByTagSchema,
  handle_list_tags,
  listTagsSchema,
  handle_bookmark_state,
  bookmarkStateSchema,
  handle_world_diff,
  worldDiffSchema,
  handle_plant_setup,
  plantSetupSchema,
  handle_pay_off_setup,
  payOffSetupSchema,
  handle_list_unpaid_setups,
  listUnpaidSetupsSchema,
  handle_set_goal,
  setGoalSchema,
  handle_check_continuity,
  checkContinuitySchema,
} from './meta'

const ACTION_MAP: Record<string, ActionSpec | ToolHandler> = {
  // PR 1: Typed event/changelog handlers
  append_event: defineAction(appendEventSchema, handle_append_event, {
    entity_key: 'character:eira-holt',
    verb: 'departed',
    object: 'marsh-end',
    detail: 'Household begins journey',
    at: '1264-05-01T00:00:00Z',
  }),
  get_event_log: defineAction(getEventLogSchema, handle_get_event_log, {
    entity_key: 'character:eira-holt',
    limit: 20,
  }),
  canonize: defineAction(canonizeSchema, handle_canonize, {
    event_id: 'some-uuid',
  }),
  migrate_events: defineAction(migrateEventsSchema, handle_migrate_events, {
    world_id: 'world-main',
  }),
  recent_changes: defineAction(recentChangesSchema, handle_recent_changes, {
    key_prefix: 'character',
    limit: 20,
  }),
  taxonomy_list: defineAction(taxonomyListSchema, handle_taxonomy_list, {
    tier: 'high',
  }),
  taxonomy_set: defineAction(taxonomySetSchema, handle_taxonomy_set, {
    verb: 'consumed',
    tier: 'high',
    category: 'narrative',
    description: 'Entity fully consumed/absorbed',
  }),
  taxonomy_delete: defineAction(taxonomyDeleteSchema, handle_taxonomy_delete, {
    verb: 'consumed',
  }),
  // PR 2: Typed setup/continuity handlers
  tag_topic: defineAction(tagTopicSchema, handle_tag_topic, {
    key: 'character:eira-holt',
    add: ['needs-review'],
  }),
  find_by_tag: defineAction(findByTagSchema, handle_find_by_tag, {
    tags: ['needs-review'],
    mode: 'any',
    limit: 20,
  }),
  list_tags: defineAction(listTagsSchema, handle_list_tags, {
    prefix: 'needs',
    with_counts: true,
    limit: 200,
  }),
  bookmark_state: defineAction(bookmarkStateSchema, handle_bookmark_state, {
    name: 'phase-9-complete',
    note: 'End of phase 9',
  }),
  world_diff: defineAction(worldDiffSchema, handle_world_diff, {
    from: 'phase-9-complete',
    detail: 'summary',
  }),
  plant_setup: defineAction(plantSetupSchema, handle_plant_setup, {
    id: 'church-ambush-foreshadow',
    description: 'Church courier spotted near Marsh-end canal',
    tension: 3,
  }),
  pay_off_setup: defineAction(payOffSetupSchema, handle_pay_off_setup, {
    id: 'church-ambush-foreshadow',
    resolution: 'Ambush occurred at the canal crossing',
    status: 'paid',
  }),
  list_unpaid_setups: defineAction(listUnpaidSetupsSchema, handle_list_unpaid_setups, {
    min_tension: 3,
  }),
  set_goal: defineAction(setGoalSchema, handle_set_goal, {
    entity_key: 'character:eira-holt',
    goal_id: 'survive-tribunal',
    description: 'Survive the Church tribunal in Novigrad on 15 Jun 1264',
  }),
  check_continuity: defineAction(checkContinuitySchema, handle_check_continuity, {
    scope: 'character',
    severity_floor: 'warn',
  }),
}

export const handle_continuity_manage: ToolHandler = makeActionDispatcher(
  'continuity_manage',
  ACTION_MAP,
)
