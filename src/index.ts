// src/index.ts — slim entry point
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import type { AppBindings } from './types'
import { makeResult, makeError, validateRequest } from './lib/rpc'
import { kvGet, kvList, getKV } from './lib/kv'
import { parseKvEntry } from './lib/lore'
import rateLimitMiddleware, { wsReconnectRateLimit } from './middleware/rate-limit'
import { requestIdMiddleware, type RequestIdVariables } from './middleware/request-id'
import { toolDefinitions } from './tools/definitions'
import { toolRegistry } from './tools/registry'
import { coerceTransportArgs } from './lib/coerce-transport-args'
import { normalizeParamCasing } from './lib/normalize-param-casing'
import adminRoutes from './admin/routes'
import changesRouter from './changes/route'
import { HolmgardMCP } from './do/HolmgardMCP'
import {
  setToolIndex,
  setSchemaIndex,
  registerRpgSubSchema,
  registerRpgAlias,
} from './rpg/registry'
import { mathManageSchemaDoc } from './rpg/definitions'
import { handleBiomeManage } from './rpg/handlers/biome-manage'
import internalRoutes from './internal/routes'
import entityReadsRouter from './api/entity-reads'
import { registerCharacterManageTool } from './rpg/register-character-manage'
import { registerLoadToolSchemaTool } from './rpg/register-load-tool-schema'
import { registerSearchToolsTool } from './rpg/register-search-tools'
import { registerAgentManageTool } from './rpg/register-agent-manage'
import { registerLoreManageTool } from './tools/register-lore-manage'
import { registerEntityManageTool } from './tools/register-entity-manage'
import { registerWorldManageTool } from './tools/register-world-manage'
import { registerSceneManageTool } from './tools/register-scene-manage'
import { registerContinuityManageTool } from './tools/register-continuity-manage'

// Export the DO class so wrangler can bind it
export { HolmgardMCP }

// Phase 2 pilot: register character_manage via registerTool() (#543)
registerCharacterManageTool()

// Phase 3: register load_tool_schema, search_tools, agent_manage (#544)
registerLoadToolSchemaTool()
registerSearchToolsTool()
registerAgentManageTool()

// Phase 4: register lore-family tools (#545)
registerLoreManageTool()
registerEntityManageTool()
registerWorldManageTool()
registerSceneManageTool()
registerContinuityManageTool()

// Initialize meta-tool indexes once at module load time
setToolIndex(toolDefinitions.map((t: any) => ({ name: t.name, description: t.description ?? '' }))