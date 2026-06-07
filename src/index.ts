// src/index.ts — slim entry point
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import type { AppBindings } from './types'
import { makeResult, makeError, validateRequest } from './lib/rpc'
import { kvGet, kvList, kvPut, kvDelete, getKV, loreDB } from './lib/kv'
import { parseKvEntry } from './lib/lore'
import { pushHistory, appendChangelog } from './lib/history'
import { updateIndexes } from './lib/indexes'
import rateLimitMiddleware from './middleware/rate-limit'
import { toolDefinitions } from './tools/definitions'
import { toolRegistry } from './tools/registry'
import adminRoutes from './admin/routes'
import changesRouter from './changes/route'

// ── App ───────────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: AppBindings }>()

app.use('*', rateLimitMiddleware)

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Secret', 'X-Api-Key'],
}) as any)

app.get('/mcp', (c) => {
  c.header('Content-Type', 'application/json')
  c.header('Cache-Control', 'no-store')
  return c.json(makeError(null, -32600, 'Invalid Request: use POST JSON-RPC'), 200)
})

app.post('/mcp', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch (e) {
    return c.json(makeError(null, -32700, 'Parse error: invalid JSON'), 200)
  }

  try {
    try { console.log('MCP incoming:', JSON.stringify(body)) } catch (e) { }

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

      const MCP_API_KEY = c.env.MCP_API_KEY
      const isAuthenticated = !!MCP_API_KEY && c.req.header('X-Api-Key') === MCP_API_KEY

      if (toolName === 'ping_tool') {
        return c.json(makeResult(id, { content: [{ type: 'text', text: 'pong' }], metadata: { source: 'internal' } }), 200)
      }

      if (toolName === 'check_authentication') {
        return c.json(makeResult(id, {
          content: [{ type: 'text', text: isAuthenticated ? 'Authenticated.' : 'Not authenticated — request was made without a valid API key.' }],
          metadata: { authenticated: isAuthenticated }
        }), 200)
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
    // These read-only compatibility shims predate tools/call authentication.

    if (method === 'list_topics') {
      const keys = await kvList(c)
      return c.json(makeResult(id, { keys }), 200)
    }

    if (method === 'get_lore') {
      const key = (params?.key ?? params?.query ?? '').toString().toLowerCase()
      if (!key) return c.json(makeError(id, -32602, 'Invalid params: missing key'), 200)

      const raw = await kvGet(c, key)
      if (!raw) return c.json(makeError(id, -32601, `No lore found for key: ${key}`), 200)

      const { text, meta } = parseKvEntry(raw)
      return c.json(makeResult(id, { key, text, meta }), 200)
    }

    if (method === 'get_lore_batch') {
      const keys: string[] = Array.isArray(params?.keys) ? params.keys.map((k: string) => k.trim().toLowerCase()) : []
      if (!keys.length) return c.json(makeError(id, -32602, 'Invalid params: missing keys array'), 200)
      const rawValues = await Promise.all(keys.map(k => kvGet(c, k)))
      const results: Record<string, any> = {}
      keys.forEach((k, i) => { results[k] = rawValues[i] ? parseKvEntry(rawValues[i]!) : null })
      return c.json(makeResult(id, { results }), 200)
    }

    if (method === 'get_topic_histories') {
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
      } catch (e) {
        return c.json(makeError(id, -32603, 'Failed to read histories', null), 200)
      }

      return c.json(makeResult(id, histories), 200)
    }

    return c.json(makeError(id, -32601, `Method not found: ${method}`), 200)

  } catch (e) {
    console.error('Unhandled exception in MCP handler', e)
    return c.json(makeError(null, -32603, 'Internal error', { message: String(e) }), 200)
  }
})

// ── Admin routes ──────────────────────────────────────────────────────────────
app.route('/admin', adminRoutes)

// ── GET /changes ──────────────────────────────────────────────────────────────
app.route('/changes', changesRouter)

app.all('*', (c) => c.text('Not Found', 404))

export default app
