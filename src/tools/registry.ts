// src/tools/registry.ts
import type { ToolHandler } from './types'
import { handle_lore_manage } from './lore-manage'
import { handle_entity_manage } from './entity-manage'
import { handle_world_manage } from './world-manage'
import { handle_scene_manage } from './scene-manage'
import { handle_continuity_manage } from './continuity-manage'
import { rpgToolRegistry } from '../rpg/registry'

export const toolRegistry: Record<string, ToolHandler> = {
  lore_manage: handle_lore_manage,
  entity_manage: handle_entity_manage,
  world_manage: handle_world_manage,
  scene_manage: handle_scene_manage,
  continuity_manage: handle_continuity_manage,
  ...rpgToolRegistry,
}
