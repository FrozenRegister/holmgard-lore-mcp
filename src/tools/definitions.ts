// src/tools/definitions.ts
//
// The 5 lore-family tools (lore_manage, entity_manage, world_manage,
// scene_manage, continuity_manage), plus agent_manage, character_manage,
// search_tools, and load_tool_schema, were all migrated to registerTool()
// (see src/tools/register.ts and the register-*.ts files across src/tools/
// and src/rpg/) — #539/#540's registration-cutover. Their hand-written
// JSON Schema definitions, previously duplicated here, are gone; tools/list
// now serializes them from the Zod schemas those registrations carry.
//
// `rpg` is the one tool still hand-defined — it dispatches to 47 RPG
// sub-handlers via its own `sub`/`action` routing (see src/rpg/rpg-handler.ts)
// and migrating it is a separate, much larger effort than this cutover.
import { rpgToolDefinitions } from '../rpg/definitions'
import { rpgMetaToolDefinitions } from '../rpg/meta-definitions'
import { getAllToolDefinitions as getRegisteredToolDefinitions } from './register'

export interface ToolDefinition {
  name: string
  title: string
  version: string
  description: string
  inputSchema: Record<string, any>
}

/** Tools not (yet) migrated to registerTool() — currently just `rpg`. */
export const toolDefinitions: ToolDefinition[] = [...rpgToolDefinitions, ...rpgMetaToolDefinitions]

/**
 * Full tools/list payload: every registerTool()-registered tool (Zod →
 * JSON Schema, serialized fresh each call) plus the remaining hand-written
 * entries. This is the single source both MCP transports read from.
 */
export function getAllToolDefinitions(): ToolDefinition[] {
  return [...getRegisteredToolDefinitions(), ...toolDefinitions]
}
