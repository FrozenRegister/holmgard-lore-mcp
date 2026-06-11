import type { ToolHandler } from './types'
import { makeError } from '../lib/rpc'
import { handle_activate_scene, handle_present_choices, handle_commit_choice, handle_get_choice_history, handle_scene_brief, handle_render_pov } from './scene'

const ACTION_MAP: Record<string, ToolHandler> = {
  activate:        handle_activate_scene,
  present_choices: handle_present_choices,
  commit_choice:   handle_commit_choice,
  get_history:     handle_get_choice_history,
  brief:           handle_scene_brief,
  render_pov:      handle_render_pov,
}

export const handle_scene_manage: ToolHandler = ({ c, id, args, isAuthenticated }) => {
  const { action, ...rest } = args
  if (!action || typeof action !== 'string')
    return Promise.resolve(c.json(makeError(id, -32602, 'Missing required param: action'), 200))
  const handler = ACTION_MAP[action]
  if (!handler)
    return Promise.resolve(c.json(makeError(id, -32602, `Unknown action "${action}"`), 200))
  return handler({ c, id, args: rest, isAuthenticated })
}
