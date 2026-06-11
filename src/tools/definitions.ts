// src/tools/definitions.ts
import { rpgToolDefinitions } from '../rpg/definitions'
import { rpgMetaToolDefinitions } from '../rpg/meta-definitions'

const OPEN_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object' as const,
  properties: {
    action: { type: 'string', description: 'Action to perform (see tool description for valid values)' },
  },
  required: ['action'],
  additionalProperties: true,
}

export const toolDefinitions: any[] = [
  {
    name: 'lore_manage',
    title: 'Lore Manage',
    version: '1.0.0',
    description: 'KV lore store — read, write, search, and mutate lore entries. Actions: get, get_batch, get_section, list, list_maps, search, validate, set, delete, patch, batch_set, batch_mutate, restore, history, increment, append_section',
    inputSchema: OPEN_SCHEMA,
  },
  {
    name: 'entity_manage',
    title: 'Entity Manage',
    version: '1.0.0',
    description: 'Entity lifecycle — generate, move, inventory, encounters, consumption timelines, and interaction resolution. Actions: generate, move, roll_encounter, advance_stage, batch_stage, get_inventory, transfer_item, get_sensory_profile, get_compatibility, analyze_utility, map_integration, list_consumption_timelines, list_active_threads, resolve_interaction',
    inputSchema: OPEN_SCHEMA,
  },
  {
    name: 'world_manage',
    title: 'World Manage',
    version: '1.0.0',
    description: 'World state — threads, relationships, factions, knowledge, locations, and convergence checks. Actions: thread_tick, get_relationship, get_faction_standing, get_entity_knowledge, get_location_occupants, get_reachable_locations, sense_environment, get_thread_comparison, check_convergence',
    inputSchema: OPEN_SCHEMA,
  },
  {
    name: 'scene_manage',
    title: 'Scene Manage',
    version: '1.0.0',
    description: 'Scene management — activate scenes, present and commit choices, scene briefs, and POV rendering. Actions: activate, present_choices, commit_choice, get_history, brief, render_pov',
    inputSchema: OPEN_SCHEMA,
  },
  {
    name: 'continuity_manage',
    title: 'Continuity Manage',
    version: '1.0.0',
    description: 'Continuity tracking — events, tags, bookmarks, world diff, setups, goals, and continuity checks. Actions: append_event, get_event_log, recent_changes, tag_topic, find_by_tag, bookmark_state, world_diff, plant_setup, pay_off_setup, list_unpaid_setups, set_goal, check_continuity',
    inputSchema: OPEN_SCHEMA,
  },
  // RPG engine tools (Mnehmos port + meta)
  ...rpgToolDefinitions,
  ...rpgMetaToolDefinitions,
]
