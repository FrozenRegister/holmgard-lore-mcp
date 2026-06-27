// src/index.ts — slim entry point
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import type { AppBindings } from './types'
import { makeResult, makeError, validateRequest } from './lib/rpc'
import { kvGet, kvList, getKV } from './lib/kv'
import { parseKvEntry } from './lib/lore'
import rateLimitMiddleware, { wsReconnectRateLimit } from './middleware/rate-limit'
import { toolDefinitions } from './tools/definitions'
import { toolRegistry } from './tools/registry'
import adminRoutes from './admin/routes'
import changesRouter from './changes/route'
import { HolmgardMCP } from './do/HolmgardMCP'
import { setToolIndex, setSchemaIndex } from './rpg/registry'
import internalRoutes from './internal/routes'
import entityReadsRouter from './api/entity-reads'

// Export the DO class so wrangler can bind it
export { HolmgardMCP }

// Initialize meta-tool indexes once at module load time
setToolIndex(toolDefinitions.map((t: any) => ({ name: t.name, description: t.description ?? '' })))
setSchemaIndex(toolDefinitions.map((t: any) => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema })))

// ── App ───────────────────────────────────────────────────────────────────────

const getIsAuthenticated = (c: any): boolean => {
  const key = c.env.MCP_API_KEY
  return !key || c.req.header('X-Api-Key') === key
}

// Pre-built Streamable HTTP handler — routes spec-compliant MCP SDK clients to
// the HolmgardMCP DO via the agents SDK session management.
const mcpServeHandler = HolmgardMCP.serve('/mcp', { binding: 'MCP_OBJECT', transport: 'streamable-http' })

const app = new Hono<{ Bindings: AppBindings }>()

app.use('*', rateLimitMiddleware)

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Secret', 'X-Api-Key'],
}) as any)

// ── Health check endpoint ────────────────────────────────────────────────────
// GET /health — returns basic service status. Intentionally unauthenticated so
// orchestrators, load balancers, and monitoring tools can probe it.
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: Date.now(),
  }, 200)
})

// ── Streamable HTTP middleware (spec 2025-03-26) ──────────────────────────────
// Intercepts requests with Streamable HTTP transport markers before route
// handlers run. Legacy raw JSON-RPC requests fall through via next().
app.use('/mcp', wsReconnectRateLimit)

app.use('/mcp', async (c, next) => {
  const sessionId = c.req.header('Mcp-Session-Id')
  const acceptHeader = c.req.header('Accept') ?? ''
  const isStreamableHttp =
    !!sessionId ||
    (acceptHeader.includes('application/json') && acceptHeader.includes('text/event-stream'))

  if (!isStreamableHttp || !c.env.MCP_OBJECT) return next()

  const apiKey = c.env.MCP_API_KEY
  if (apiKey && c.req.header('X-Api-Key') !== apiKey) {
    return c.json({ error: 'Unauthorized: valid X-Api-Key header required' }, 401)
  }

  return mcpServeHandler.fetch(c.req.raw, c.env as any, c.executionCtx as any)
})

app.get('/mcp', (c) => {
  c.header('Content-Type', 'application/json')
  c.header('Cache-Control', 'no-store')
  return c.json(makeError(null, -32600, 'Invalid Request: use POST JSON-RPC'), 200)
})

app.post('/mcp', async (c) => {
  // ── Legacy hand-rolled JSON-RPC handler ───────────────────────────────────
  // Streamable HTTP requests are handled by the app.use('/mcp', ...) middleware
  // above and never reach this handler.
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(makeError(null, -32700, 'Parse error'), 200)
  }

  const { id, method, params } = body as any
  if (!method) return c.json(makeError(null, -32600, 'Invalid Request: missing method'), 200)

  try {
    // ── tools/list ────────────────────────────────────────────────────────────
    if (method === 'tools/list') {
      return c.json(makeResult(id, { tools: toolDefinitions }), 200)
    }

    // ── tools/call ────────────────────────────────────────────────────────────
    if (method === 'tools/call') {
      const { name, arguments: args } = params ?? {}
      if (!name) return c.json(makeError(id, -32602, 'Invalid params: missing tool name'), 200)

      const tool = toolRegistry.get(name)
      if (!tool) return c.json(makeError(id, -32602, `Tool not found: ${name}`), 200)

      // Validate args against schema
      const validationResult = validateRequest(args ?? {}, tool.inputSchema)
      if (!validationResult.success) {
        return c.json(makeError(id, -32602, validationResult.error.message), 200)
      }

      const result = await tool.execute(validationResult.data, {
        env: c.env,
        getKV,
        kvGet: (key: string) => kvGet(c, key),
        isAuthenticated: getIsAuthenticated(c),
      })

      return c.json(makeResult(id, result), 200)
    }

    // ── legacy: get_topics ────────────────────────────────────────────────────
    if (method === 'get_topics') {
      const MCP_LEGACY_API_KEY = c.env.MCP_API_KEY
      if (MCP_LEGACY_API_KEY && c.req.header('X-Api-Key') !== MCP_LEGACY_API_KEY) {
        return c.json(makeError(id, -32001, 'Unauthorized: valid X-Api-Key header required'), 200)
      }
      const keys: string[] = Array.isArray(params?.keys) ? params.keys.map((k: string) => k.trim().toLowerCase()) : []
      if (!keys.length) return c.json(makeError(id, -32602, 'Invalid params: missing keys array'), 200)
      const rawValues = await Promise.all(keys.map(k => kvGet(c, k)))
      const results: Record<string, any> = {}
      keys.forEach((k, i) => { results[k] = rawValues[i] ? parseKvEntry(rawValues[i]!) : null })
      return c.json(makeResult(id, { results }), 200)
    }

    if (method === 'get_topic_histories') {
      const MCP_LEGACY_API_KEY = c.env.MCP_API_KEY
      if (MCP_LEGACY_API_KEY && c.req.header('X-Api-Key') !== MCP_LEGACY_API_KEY) {
        return c.json(makeError(id, -32001, 'Unauthorized: valid X-Api-Key header required'), 200)
      }
      const keys: string[] = Array.isArray(params?.keys) ? params.keys.map((k: string) => k.trim().toLowerCase()) : []
      if (!keys.length) return c.json(makeError(id, -32602, 'Invalid params: missing keys array'), 200)

      const kv = getKV(c)
      if (!kv) return c.json(makeError(id, -32603, 'KV not available', null), 200)

      const histories: Record<string, Array<{ text: string; meta: Record<string, unknown> }>> = {}

      try {
        for (const key of keys) {
          const historyKey = `_history:${key}`
          const historyRaw = await kv.get(historyKey)
          const snapshots: Array<{ text: string; meta: Record<string, unknown> }> = []

          if (historyRaw) {
            const historyList: string[] = JSON.parse(historyRaw)
            for (const snapshot of historyList) {
              snapshots.push(parseKvEntry(snapshot))
            }
          }

          histories[key] = snapshots
        }
      } catch {
        return c.json(makeError(id, -32603, 'Failed to read histories', null), 200)
      }

      return c.json(makeResult(id, histories), 200)
    }

    return c.json(makeError(id, -32601, `Method not found: ${method}`), 200)

  } catch (e: unknown) {
    console.error('Unhandled exception in MCP handler', e)
    return c.json(makeError(null, -32603, 'Internal error', { message: e instanceof Error ? e.message : String(e) }), 200)
  }
})

// ── CSP violation reporting ──────────────────────────────────────────────────────
app.post('/csp-report', async (c) => {
  try {
    const report = await c.req.json() as Record<string, unknown>
    const timestamp = new Date().toISOString()

    const violation = {
      timestamp,
      blockedUri: report['blocked-uri'] || 'unknown',
      violatedDirective: report['violated-directive'] || 'unknown',
      sourceFile: report['source-file'] || 'unknown',
      lineNumber: report['line-number'],
      columnNumber: report['column-number'],
      originalPolicy: report['original-policy'] || 'unknown',
      disposition: report['disposition'] || 'enforce'
    }

    console.log('[CSP Violation]', JSON.stringify(violation))

    return c.json({ status: 'reported' }, 200)
  } catch (e) {
    console.error('[CSP Report] Error processing report:', e)
    return c.json({ error: 'Failed to process CSP report' }, 400)
  }
})

// ── Admin routes ──────────────────────────────────────────────────────────────
app.route('/admin', adminRoutes)

// ── Internal routes ────────────────────────────────────────────────────────────
app.route('/internal', internalRoutes)

// ── Entity list reads (open, no auth) ─────────────────────────────────────────
app.route('/api/entities', entityReadsRouter)

// ── GET /changes ──────────────────────────────────────────────────────────────
app.route('/changes', changesRouter)

app.all('*', (c) => c.text('Not Found', 404))

export default app
