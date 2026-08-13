// src/tools/registry.ts
//
// The 5 lore-family tools were migrated to registerTool() (see
// register-lore-manage.ts and its siblings) and removed from here —
// #539/#540's registration-cutover. `rpg` (via rpgToolRegistry) is the one
// tool still served the old way.
import type { ToolHandler } from './types'
import { rpgToolRegistry } from '../rpg/registry'

export const toolRegistry: Record<string, ToolHandler> = {
  ...rpgToolRegistry,
}
