import { registerTool, type RegisteredTool } from './register'
import { handle_scene_manage } from './scene-manage'
import { z } from 'zod'

const activateSchema = z.object({
  action: z.literal('activate'),
  scene_key: z.string().min(1),
})

const presentChoicesSchema = z.object({
  action: z.literal('present_choices'),
  scene_key: z.string().min(1),
  entity_key: z.string().min(1),
})

const commitChoiceSchema = z.object({
  action: z.literal('commit_choice'),
  choice_id: z.string().min(1),
  entity_key: z.string().min(1),
})

const getHistorySchema = z.object({
  action: z.literal('get_history'),
  entity_key: z.string().min(1),
})

const briefSchema = z.object({
  action: z.literal('brief'),
  location_key: z.string().optional(),
  scene_key: z.string().optional(),
  include: z
    .object({
      events: z.number().int().min(0).optional(),
      open_setups: z.boolean().optional(),
      relationships: z.boolean().optional(),
      sensory: z.boolean().optional(),
    })
    .optional(),
})

const renderPovSchema = z.object({
  action: z.literal('render_pov'),
  pov_entity_key: z.string().min(1),
  scene_key: z.string().optional(),
  location_key: z.string().optional(),
  include_voice_hints: z.boolean().optional(),
  reveal_threshold: z.number().min(0).max(1).optional(),
})

export const InputSchema = z.discriminatedUnion('action', [
  activateSchema,
  presentChoicesSchema,
  commitChoiceSchema,
  getHistorySchema,
  briefSchema,
  renderPovSchema,
])

export function registerSceneManageTool(): void {
  const tool: RegisteredTool = {
    name: 'scene_manage',
    title: 'Scene Manage',
    version: '1.0.0',
    description:
      'Scene management — activate scenes, present and commit choices, scene briefs, and POV rendering. Actions: activate, present_choices, commit_choice, get_history, brief, render_pov.',
    category: 'lore',
    inputSchema: InputSchema,
    handler: handle_scene_manage,
  }
  registerTool(tool)
}
