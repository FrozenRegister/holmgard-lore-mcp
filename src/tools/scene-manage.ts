import type { ActionSpec, ToolHandler } from './types'
import { makeActionDispatcher, defineAction } from './types'
import {
  handle_activate_scene, activateSceneSchema,
  handle_present_choices, presentChoicesSchema,
  handle_commit_choice, commitChoiceSchema,
  handle_get_choice_history, getChoiceHistorySchema,
  handle_scene_brief, sceneBriefSchema,
  handle_render_pov, renderPovSchema,
} from './scene'

const ACTION_MAP: Record<string, ActionSpec> = {
  activate: defineAction(activateSceneSchema, handle_activate_scene, {
    scene_key: 'scene:tribunal-summons',
  }),
  present_choices: defineAction(presentChoicesSchema, handle_present_choices, {
    scene_key: 'scene:tribunal-summons', entity_key: 'character:eira-holt',
  }),
  commit_choice: defineAction(commitChoiceSchema, handle_commit_choice, {
    choice_id: 'negotiate', entity_key: 'character:eira-holt',
  }),
  get_history: defineAction(getChoiceHistorySchema, handle_get_choice_history, {
    entity_key: 'character:eira-holt',
  }),
  brief: defineAction(sceneBriefSchema, handle_scene_brief, {
    location_key: 'location:marsh-end', include: { events: 5, open_setups: true },
  }),
  render_pov: defineAction(renderPovSchema, handle_render_pov, {
    pov_entity_key: 'character:eira-holt', location_key: 'location:marsh-end',
  }),
}

export const handle_scene_manage: ToolHandler = makeActionDispatcher('scene_manage', ACTION_MAP)
