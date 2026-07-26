// src/rpg/register-search-tools.ts
// Registration of search_tools tool via the Phase 1 registerTool() infrastructure (#544)

import { registerTool, type RegisteredTool } from '../tools/register'
import { InputSchema, handleSearchTools } from './handlers/search-tools'
import { wrap } from './registry'

/**
 * Register search_tools with the new registerTool() infrastructure.
 * This is a parallel path to rpgToolRegistry — both remain active.
 * (Phase 1 #540, Phase 3 #544)
 */
export function registerSearchToolsTool(): void {
  const tool: RegisteredTool = {
    name: 'search_tools',
    title: 'Search Tools',
    version: '1.0.0',
    description: 'Meta-tool: fuzzy-search the full combined tool list by name or description.',
    category: 'rpg',
    inputSchema: InputSchema,
    handler: wrap(handleSearchTools),
  }
  registerTool(tool)
}
