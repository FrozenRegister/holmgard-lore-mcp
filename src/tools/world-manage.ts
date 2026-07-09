import type { ActionSpec, ToolHandler } from './types'
import { makeActionDispatcher, defineAction } from './types'
import {
  handle_thread_tick, threadTickSchema,
  handle_get_relationship, getRelationshipSchema,
  handle_get_faction_standing, getFactionStandingSchema,
  handle_get_entity_knowledge, getEntityKnowledgeSchema,
  handle_set_entity_knowledge, setEntityKnowledgeSchema,
  handle_learn_from_event, learnFromEventSchema,
  handle_migrate_knowledge, migrateKnowledgeSchema,
  handle_get_location_occupants, getLocationOccupantsSchema,
  handle_get_reachable_locations, getReachableLocationsSchema,
  handle_sense_environment, senseEnvironmentSchema,
  handle_get_thread_comparison, getThreadComparisonSchema,
  handle_check_convergence, checkConvergenceSchema,
  handle_get_world_state,
} from './world'

const ACTION_MAP: Record<string, ActionSpec | ToolHandler> = {
  thread_tick: defineAction(threadTickSchema, handle_thread_tick, {
    thread_id: 'tribunal'
  }),
  get_relationship: defineAction(getRelationshipSchema, handle_get_relationship, {
    entity_a: 'character:eira-holt', entity_b: 'character:gerent'
  }),
  get_faction_standing: defineAction(getFactionStandingSchema, handle_get_faction_standing, {
    entity_key: 'character:eira-holt', faction_key: 'faction:guild-of-surgeons'
  }),
  get_entity_knowledge: defineAction(getEntityKnowledgeSchema, handle_get_entity_knowledge, {
    entity_key: 'character:eira-holt', topic: 'the-lock'
  }),
  set_entity_knowledge: defineAction(setEntityKnowledgeSchema, handle_set_entity_knowledge, {
    entity_id: 'char-uuid', topic: 'the-lock', knowledge_type: 'fact', acquired_at: '2184-07-15'
  }),
  learn_from_event: defineAction(learnFromEventSchema, handle_learn_from_event, {
    entity_id: 'char-uuid', event_id: 'event-uuid'
  }),
  migrate_knowledge: defineAction(migrateKnowledgeSchema, handle_migrate_knowledge, {
    world_id: 'world-main'
  }),
  get_location_occupants: defineAction(getLocationOccupantsSchema, handle_get_location_occupants, {
    location_key: 'location:marsh-end'
  }),
  get_reachable_locations: defineAction(getReachableLocationsSchema, handle_get_reachable_locations, {
    origin_key: 'location:marsh-end'
  }),
  sense_environment: defineAction(senseEnvironmentSchema, handle_sense_environment, {
    location_key: 'location:marsh-end', entity_key: 'character:eira-holt'
  }),
  get_thread_comparison: defineAction(getThreadComparisonSchema, handle_get_thread_comparison, {
    thread_a: 'tribunal', thread_b: 'the-lock'
  }),
  check_convergence: defineAction(checkConvergenceSchema, handle_check_convergence, {
    thread_a: 'tribunal', thread_b: 'the-lock'
  }),
  get_world_state: handle_get_world_state,
}

export const handle_world_manage: ToolHandler = makeActionDispatcher('world_manage', ACTION_MAP)
