// src/rpg/register-load-tool-schema.ts
// Registration of load_tool_schema tool via the Phase 1 registerTool() infrastructure (#544)

import { registerTool, type RegisteredTool } from '../tools/register'
import { InputSchema, handleLoadToolSchema } from './handlers/load-tool-schema'
import { wrap } from './registry'

/**
 * Register load_tool_schema with the new registerTool() infrastructure.
 * This is a parallel path to rpgToolRegistry — both remain active.
 * (Phase 1 #540, Phase 3 #544)
 */
export function registerLoadToolSchemaTool(): void {
  const tool: RegisteredTool = {
    name: 'load_tool_schema',
    title: 'Load Tool Schema',
    version: '1.0.0',
    description:
      'Meta-tool: return the full JSON schema for a named tool. Includes fuzzy matching and did_you_mean suggestions for typos.',
    category: 'rpg',
    inputSchema: InputSchema,
    handler: wrap(handleLoadToolSchema),
  }
  registerTool(tool)
}
