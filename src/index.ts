// src/index.ts — slim entry point
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import type { AppBindings } from './types'
import { makeResult, makeError, validateRequest } from './lib/rpc'
import { kvGet, kvList, getKV } from './lib/kv'
import { parseKvEntry } from './lib/lore'
import rateLimitMiddleware from './middleware/rate-limit'
import { toolDefinitions } from './tools/definitions'
import { toolRegistry } from './tools/registry'
import adminRoutes from './admin/routes'
import changesRouter from './changes/route'
import { HolmgardMCP } from './do/HolmgardMCP'
import { setToolIndex, setSchemaIndex } from './rpg/registry'

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
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Secret', 'X-Api-Key'],
}) as any)

// ── Streamable HTTP middleware (spec 2025-03-26) ──────────────────────────────
// Intercepts requests with Streamable HTTP transport markers before route
// handlers run. Legacy raw JSON-RPC requests fall through via next().
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
    return c.json(makeError(null, -32700, 'Parse error: invalid JSON'), 200)
  }

  try {
    try { console.log('MCP incoming:', JSON.stringify(body)) } catch { /* ignore log error */ }

    const validated = validateRequest(body)
    if (!validated.ok) return c.json(validated.error, 200)

    const req = validated.req
    const id = req.id ?? null
    const method = req.method!
    const params = (req.params ?? {}) as Record<string, unknown>

    // ── initialize ────────────────────────────────────────────────────────────
    if (method === 'initialize') {
      c.header('Cache-Control', 'no-store')
      c.header('Content-Type', 'application/json')
      return c.json(makeResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { list: true, call: true } },
        serverInfo: { name: 'holmgard-lore-mcp', version: '0.3.0', description: 'Holmgard lore MCP' }
      }), 200)
    }

    if (method === 'ping') {
      return c.json(makeResult(id, {}), 200)
    }

    // ── tools/list ────────────────────────────────────────────────────────────
    if (method === 'tools/list') {
      c.header('Cache-Control', 'no-store')
      c.header('Content-Type', 'application/json')
      return c.json(makeResult(id, { tools: toolDefinitions }), 200)
    }

    // ── tools/call ────────────────────────────────────────────────────────────
    if (method === 'tools/call') {
      const toolName = params?.name
      const args = (params?.arguments ?? {}) as Record<string, any>
      if (!toolName || typeof toolName !== 'string')
        return c.json(makeError(id, -32602, 'Invalid params: missing tool name'), 200)

      const isAuthenticated = getIsAuthenticated(c)

      if (toolName === 'lore_manage') {
        const action = typeof args?.action === 'string' ? args.action : null
        if (action === 'ping') {
          return c.json(makeResult(id, { content: [{ type: 'text', text: 'pong' }], metadata: { source: 'internal' } }), 200)
        }
        if (action === 'auth_check') {
          return c.json(makeResult(id, {
            content: [{ type: 'text', text: isAuthenticated ? 'Authenticated.' : 'Not authenticated — request was made without a valid API key.' }],
            metadata: { authenticated: isAuthenticated }
          }), 200)
        }
        // fall through to auth guard + registry for all other lore_manage actions
      }

      if (!isAuthenticated) {
        return c.json(makeError(id, -32001, 'Unauthorized: valid X-Api-Key header required'), 200)
      }

      const handler = toolRegistry[toolName]
      if (handler) {
        return handler({ c, id, args, isAuthenticated })
      }

      return c.json(makeError(id, -32601, `Method not found: tool "${toolName}"`), 200)
    }

    // ── Legacy bare-method handlers (pre-tools/call clients) ──────────────────
    // In production (MCP_API_KEY is set) require same auth check as tools/call.

    if (method === 'list_topics') {
      if (!getIsAuthenticated(c)) {
        return c.json(makeError(id, -32001, 'Unauthorized: valid X-Api-Key header required'), 200)
      }
      const keys = await kvList(c)
      return c.json(makeResult(id, { keys }), 200)
    }

    if (method === 'get_lore') {
      if (!getIsAuthenticated(c)) {
        return c.json(makeError(id, -32001, 'Unauthorized: valid X-Api-Key header required'), 200)
      }
      const key = (params?.key ?? params?.query ?? '').toString().toLowerCase()
      if (!key) return c.json(makeError(id, -32602, 'Invalid params: missing key'), 200)

      const raw = await kvGet(c, key)
      if (!raw) return c.json(makeError(id, -32601, `No lore found for key: ${key}`), 200)

      const { text, meta } = parseKvEntry(raw)
      return c.json(makeResult(id, { key, text, meta }), 200)
    }

    if (method === 'get_lore_batch') {
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

    // Optionally store in KV for later review (TODO: implement dashboard)
    const kv = getKV(c)
    if (kv) {
      try {
        const key = `_csp_report:${timestamp}:${Math.random().toString(36).slice(2, 9)}`
        await kv.put(key, JSON.stringify(violation))
      } catch (e) {
        console.error('[CSP Report] Failed to store in KV:', e)
      }
    }

    return c.json({ status: 'reported' }, 200)
  } catch (e) {
    console.error('[CSP Report] Error processing report:', e)
    return c.json({ error: 'Failed to process CSP report' }, 400)
  }
})

// ── Admin routes ──────────────────────────────────────────────────────────────
app.route('/admin', adminRoutes)

// ── GET /changes ──────────────────────────────────────────────────────────────
app.route('/changes', changesRouter)

app.all('*', (c) => c.text('Not Found', 404))

export default app