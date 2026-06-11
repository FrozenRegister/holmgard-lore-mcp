// src/rpg/registry.ts
// Wraps transport-agnostic RPG handlers into ToolHandler (ctx) => Promise<Response> format.

import type { ToolHandler } from '../tools/types'
import type { AppBindings } from '../types'
import { makeResult } from '../lib/rpc'
import type { McpResponse } from './utils/response'

import { handle_rpg } from './rpg-handler'
import { handleSearchTools, setToolIndex } from './handlers/search-tools'
import { handleLoadToolSchema, setSchemaIndex } from './handlers/load-tool-schema'
import { handleAgentManage } from './handlers/agent-manage'

export { setToolIndex, setSchemaIndex }

type RpgFn = (env: AppBindings, args: Record<string, unknown>) => Promise<McpResponse>

function wrap(fn: RpgFn): ToolHandler {
  return async ({ c, id, args }) => {
    const result = await fn(c.env, args ?? {})
    return c.json(makeResult(id, result), 200)
  }
}

export const rpgToolRegistry: Record<string, ToolHandler> = {
  rpg:              handle_rpg,
  agent_manage:     wrap(handleAgentManage),
  search_tools:     wrap(handleSearchTools),
  load_tool_schema: wrap(handleLoadToolSchema),
}
