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
import { registerAgentManageTool } from './rpg/register-agent-manage'
import { registerSearchToolsTool } from './rpg/register-search-tools'
import { registerLoadToolSchemaTool } from './rpg/register-load-tool-schema'

// Export the DO class so wrangler can bind it
export { HolmgardMCP }

// Phase 2 pilot: register character_manage via registerTool() (#543)
registerCharacterManageTool()

// Phase 3: register agent_manage, search_tools, load_tool_schema via registerTool() (#544)
registerAgentManageTool()
registerSearchToolsTool()
registerLoadToolSchemaTool()

// Initialize meta-tool indexes once at module load time
setToolIndex(toolDefinitions.map((t: any) => ({ name: t.name, description: t.description ?? '' })))
setSchemaIndex(
  [...toolDefinitions, mathManageSchemaDoc].map((t: any) => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: t.inputSchema,
  })),
)

type SubSchemaEntry =
  | { sub: string; description: string; schema: Record<string, unknown> }
  | { sub: string; aliasOf: string }

const SUB_SCHEMAS: SubSchemaEntry[] = [
  {
    sub: 'corpse',
    description: 'Corpse ecology — decomposition, scavenging, looting, psychological impact.',
    schema: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'] },
  },
  {
    sub: 'character',
    description: 'Character CRUD and management.',
    schema: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'] },
  },
  { sub: 'characters', aliasOf: 'character' },
]

for (const s of SUB_SCHEMAS) {
  if ('aliasOf' in s) {
    const canonical = SUB_SCHEMAS.find(
      (c): c is Extract<SubSchemaEntry, { schema: unknown }> =>
        'schema' in c && c.sub === s.aliasOf,
    )!
    registerRpgSubSchema(s.sub, canonical.description, canonical.schema)
    registerRpgAlias(s.sub, s.aliasOf)
  } else {
    registerRpgSubSchema(s.sub, s.description, s.schema)
  }
}

const getIsAuthenticated = (c: any): boolean => {
  const key = c.env.MCP_API_KEY
  return !key || c.req.header('X-Api-Key') === key
}

const unauthorizedIfNeeded = (
  c: any,
  id: string | number | null,
  httpStatus: 200 | 401 = 200,
): ReturnType<typeof c.json> | null =>
  getIsAuthenticated(c)
    ? null
    : c.json(makeError(id, -32001, 'Unauthorized: valid X-Api-Key header required'), httpStatus)

const mcpServeHandler = HolmgardMCP.serve('/mcp', {
  binding: 'MCP_OBJECT',
  transport: 'streamable-http',
})

const app = new Hono<{ Bindings: AppBindings; Variables: RequestIdVariables }>()

app.use('*', requestIdMiddleware)
app.use('*', rateLimitMiddleware)

app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Secret', 'X-Api-Key'],
  }) as any,
)

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() }, 200)
})

app.use('/mcp', wsReconnectRateLimit)

app.use('/mcp', async (c, next) => {
  const sessionId = c.req.header('Mcp-Session-Id')
  const acceptHeader = c.req.header('Accept') ?? ''
  const isStreamableHttp =
    !!sessionId ||
    (acceptHeader.includes('application/json') && acceptHeader.includes('text/event-stream'))
  if (!isStreamableHttp || !c.env.MCP_OBJECT) return next()
  return (
    unauthorizedIfNeeded(c, null, 401) ??
    mcpServeHandler.fetch(c.req.raw, c.env as any, c.executionCtx as any)
  )
})

app.get('/mcp', (c) => {
  c.header('Content-Type', 'application/json')
  c.header('Cache-Control', 'no-store')
  return c.json(makeError(null, -32600, 'Invalid Request: use POST JSON-RPC'), 200)
})

app.post('/mcp', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(makeError(null, -32700, 'Parse error: invalid JSON'), 200)
  }
  const requestId = c.get('requestId')
  try {
    const validated = validateRequest(body)
    if (!validated.ok) return c.json(validated.error, 200)
    const req = validated.req
    const id = req.id ?? null
    const method = req.method!
    const params = (req.params ?? {}) as Record<string, unknown>

    if (method === 'initialize') {
      c.header('Cache-Control', 'no-store')
      c.header('Content-Type', 'application/json')
      return c.json(
        makeResult(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { list: true, call: true } },
          serverInfo: { name: 'holmgard-lore-mcp', version: '0.3.0', description: 'Holmgard lore MCP' },
        }),
        200,
      )
    }
    if (method === 'ping') return c.json(makeResult(id, {}), 200)
    if (method === 'tools/list') {
      c.header('Cache-Control', 'no-store')
      c.header('Content-Type', 'application/json')
      return c.json(makeResult(id, { tools: toolDefinitions }), 200)
    }
    if (method === 'tools/call') {
      const toolName = params?.name
      const args = normalizeParamCasing(coerceTransportArgs((params?.arguments ?? {}) as Record<string, any>))
      if (!toolName || typeof toolName !== 'string')
        return c.json(makeError(id, -32602, 'Invalid params: missing tool name'), 200)
      const unauth = unauthorizedIfNeeded(c, id)
      if (unauth) return unauth
      const handler = toolRegistry[toolName]
      if (handler) return handler({ c, id, args, isAuthenticated: getIsAuthenticated(c) })
      return c.json(makeError(id, -32601, `Method not found: tool "${toolName}"`), 200)
    }
    return c.json(makeError(id, -32601, `Method not found: ${method}`), 200)
  } catch (e: unknown) {
    console.error(JSON.stringify({ request_id: requestId, error: 'Unhandled exception', message: e instanceof Error ? e.message : String(e) }))
    return c.json(makeError(null, -32603, 'Internal error', { message: e instanceof Error ? e.message : String(e), request_id: requestId }), 200)
  }
})

app.post('/csp-report', async (c) => {
  try {
    const report = (await c.req.json()) as Record<string, unknown>
    console.log('[CSP Violation]', JSON.stringify({ timestamp: new Date().toISOString(), blockedUri: report['blocked-uri'] || 'unknown' }))
    return c.json({ status: 'reported' }, 200)
  } catch (e) {
    return c.json({ error: 'Failed to process CSP report' }, 400)
  }
})

app.route('/admin', adminRoutes)
app.route('/internal', internalRoutes)
app.route('/api/entities', entityReadsRouter)
app.route('/changes', changesRouter)
app.all('*', (c) => c.text('Not Found', 404))

export default app
