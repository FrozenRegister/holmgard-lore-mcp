// src/rpg/registry.ts
// Wraps transport-agnostic RPG handlers into ToolHandler (ctx) => Promise<Response> format.
//
// agent_manage, character_manage, search_tools, and load_tool_schema were
// migrated to registerTool() (see the register-*.ts files in this directory)
// and removed from here — #539/#540's registration-cutover. `rpg` itself
// (47 sub-handlers, a much larger effort) is the one tool still served the
// old way; `wrap()` stays exported since the register-*.ts files reuse it.

import type { ToolHandler } from '../tools/types'
import type { AppBindings } from '../types'
import { makeResult } from '../lib/rpc'
import type { McpResponse } from './utils/response'

import { handle_rpg } from './rpg-handler'
import { setToolIndex } from './handlers/search-tools'
import { setSchemaIndex, registerRpgSubSchema, registerRpgAlias } from './handlers/load-tool-schema'

export { setToolIndex, setSchemaIndex, registerRpgSubSchema, registerRpgAlias }

type RpgFn = (env: AppBindings, args: Record<string, unknown>) => Promise<McpResponse>

export function wrap(fn: RpgFn): ToolHandler {
  return async ({ c, id, args }) => {
    const result = await fn(c.env, args ?? {})
    return c.json(makeResult(id, result), 200)
  }
}

export const rpgToolRegistry: Record<string, ToolHandler> = {
  rpg: handle_rpg,
}
