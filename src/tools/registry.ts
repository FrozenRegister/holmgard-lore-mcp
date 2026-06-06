// src/tools/registry.ts
import type { ToolHandler } from './types'
import { handle_list_topics, handle_list_maps, handle_get_lore, handle_get_lore_batch, handle_get_lore_section, handle_validate_topic_exists, handle_search_lore } from './system'
import { handle_set_lore, handle_delete_lore, handle_patch_lore, handle_batch_set_lore, handle_batch_mutate, handle_restore_lore, handle_get_topic_histories, handle_increment_topic_field, handle_append_to_section, handle_move_entity } from './lore'
import { handle_resolve_interaction, handle_analyze_utility, handle_map_integration, handle_generate_entity, handle_roll_encounter, handle_advance_state_stage, handle_process_stage_batch, handle_get_sensory_profile, handle_get_compatibility, handle_get_inventory, handle_transfer_item, handle_list_consumption_timelines, handle_list_active_threads } from './entity'
import { handle_thread_tick, handle_get_relationship, handle_get_faction_standing, handle_get_entity_knowledge, handle_get_location_occupants, handle_get_reachable_locations, handle_sense_environment, handle_get_thread_comparison, handle_check_convergence } from './world'
import { handle_activate_scene, handle_present_choices, handle_commit_choice, handle_get_choice_history, handle_scene_brief, handle_render_pov } from './scene'
import { handle_append_event, handle_get_event_log, handle_recent_changes, handle_tag_topic, handle_find_by_tag, handle_bookmark_state, handle_world_diff, handle_plant_setup, handle_pay_off_setup, handle_list_unpaid_setups, handle_set_goal, handle_check_continuity } from './meta'

export const toolRegistry: Record<string, ToolHandler> = {
  // system
  list_topics: handle_list_topics,
  list_maps: handle_list_maps,
  get_lore: handle_get_lore,
  get_lore_batch: handle_get_lore_batch,
  get_lore_section: handle_get_lore_section,
  validate_topic_exists: handle_validate_topic_exists,
  search_lore: handle_search_lore,
  // lore mutations
  set_lore: handle_set_lore,
  delete_lore: handle_delete_lore,
  patch_lore: handle_patch_lore,
  batch_set_lore: handle_batch_set_lore,
  batch_mutate: handle_batch_mutate,
  restore_lore: handle_restore_lore,
  get_topic_histories: handle_get_topic_histories,
  increment_topic_field: handle_increment_topic_field,
  append_to_section: handle_append_to_section,
  move_entity: handle_move_entity,
  // entity
  resolve_interaction: handle_resolve_interaction,
  analyze_utility: handle_analyze_utility,
  map_integration: handle_map_integration,
  generate_entity: handle_generate_entity,
  roll_encounter: handle_roll_encounter,
  advance_state_stage: handle_advance_state_stage,
  process_stage_batch: handle_process_stage_batch,
  get_sensory_profile: handle_get_sensory_profile,
  get_compatibility: handle_get_compatibility,
  get_inventory: handle_get_inventory,
  transfer_item: handle_transfer_item,
  list_consumption_timelines: handle_list_consumption_timelines,
  list_active_threads: handle_list_active_threads,
  // world
  thread_tick: handle_thread_tick,
  get_relationship: handle_get_relationship,
  get_faction_standing: handle_get_faction_standing,
  get_entity_knowledge: handle_get_entity_knowledge,
  get_location_occupants: handle_get_location_occupants,
  get_reachable_locations: handle_get_reachable_locations,
  sense_environment: handle_sense_environment,
  get_thread_comparison: handle_get_thread_comparison,
  check_convergence: handle_check_convergence,
  // scene
  activate_scene: handle_activate_scene,
  present_choices: handle_present_choices,
  commit_choice: handle_commit_choice,
  get_choice_history: handle_get_choice_history,
  scene_brief: handle_scene_brief,
  render_pov: handle_render_pov,
  // meta
  append_event: handle_append_event,
  get_event_log: handle_get_event_log,
  recent_changes: handle_recent_changes,
  tag_topic: handle_tag_topic,
  find_by_tag: handle_find_by_tag,
  bookmark_state: handle_bookmark_state,
  world_diff: handle_world_diff,
  plant_setup: handle_plant_setup,
  pay_off_setup: handle_pay_off_setup,
  list_unpaid_setups: handle_list_unpaid_setups,
  set_goal: handle_set_goal,
  check_continuity: handle_check_continuity,
}
