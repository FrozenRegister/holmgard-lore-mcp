// src/index.ts — slim entry point
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import type { AppBindings } from './types'
import { makeResult, makeError, validateRequest } from './lib/rpc'
import { kvGet, kvList, getKV } from './lib/kv'
import { parseKvEntry } from './lib/lore'
import rateLimitMiddleware from './lib/rate-limit'
import { toolRegistry } from './tools/registry'
import type { ToolHandler } from './tools/types'
import { dispatchToolCall, type DispatchResult } from './tools/dispatch'

// ─── Admin routes (gated by ADMIN_SECRET) ───────────────────────────────────
import adminRouter from './admin'
import { adminAuthMiddleware } from './lib/admin-auth'

// ─── Internal routes (no auth, no rate-limit) ────────────────────────────────
import internalRouter from './internal'

// ─── Public entity API ───────────────────────────────────────────────────────
import entityRouter from './api/entities'

// ─── Changes API ─────────────────────────────────────────────────────────────
import changesRouter from './api/changes'

// ─── Bindings ────────────────────────────────────────────────────────────────
export type { AppBindings }

const app = new Hono<{ Bindings: AppBindings }>()

// ─── Global CORS ─────────────────────────────────────────────────────────────
app.use(
  '*',
  cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  })
)

// ─── Rate limiting (all routes) ──────────────────────────────────────────────
app.use('*', rateLimitMiddleware)

// ─── Health ──────────────────────────────────────────────────────────────────
app.get('/health', () => new Response('ok', { status: 200 }))

// ─── Mount sub-routers ───────────────────────────────────────────────────────
app.route('/admin', adminAuthMiddleware, adminRouter)
app.route('/internal', internalRouter)
app.route('/api/entities', entityRouter)
app.route('/api/changes', changesRouter)

// ─── Helper: unauthorized error when API key is missing ──────────────────────
function unauthorizedIfNeeded(apiKey: string | undefined): ReturnType<typeof makeError> | null {
  if (!apiKey) {
    return makeError(null, -32600, 'Missing or invalid API key')
  }
  return null
}

// ─── POST /mcp — legacy JSON-RPC handler ─────────────────────────────────────
app.post('/mcp', async (c) => {
  const apiKey = c.req.header('X-API-Key')
  const authenticated = !!apiKey

  let body: { method?: string; params?: { name?: string; arguments?: Record<string, unknown>; action?: string } }
  try {
    body = await c.req.json()
  } catch {
    return c.json(makeError(null, -32700, 'Parse error'), 400)
  }

  const validation = validateRequest(body)
  if (!validation.valid) {
    return c.json(makeError(null, validation.code, validation.message), 400)
  }

  const { method, params } = body

  // tools/call is the primary dispatch path
  if (method === 'tools/call') {
    const toolName = params?.name as string | undefined
    if (!toolName) {
      return c.json(makeError(null, -32602, 'Invalid params: missing tool name'), 400)
    }

    const rawArgs = (params.arguments as Record<string, unknown>) || {}
    const dispatch = dispatchToolCall({
      name: toolName,
      args: rawArgs,
      authenticated,
    })

    // Short-circuit: ping / auth_check
    if (dispatch.kind === 'short-circuit') {
      return c.json(makeResult(null, [dispatch.content]))
    }

    // Tool not found
    if (dispatch.kind === 'not-found') {
      return c.json(makeError(null, -32601, `Method not found: ${dispatch.toolName}`), 400)
    }

    // Dispatch to the real handler
    const handler: ToolHandler = dispatch.handler
    const authError = handler.requiresAuth && !authenticated && unauthorizedIfNeeded(apiKey)
    if (authError) {
      return c.json(authError, 401)
    }

    try {
      const result = await handler.call(rawArgs, {
        kv: getKV(c),
        env: c.env,
        authenticated,
      })
      return c.json(makeResult(null, result))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return c.json(makeError(null, -32603, message), 500)
    }
  }

  // ── Bare-method aliases (read-only shortcuts) ──────────────────────────────
  // These are *not* exposed via the MCP spec — they exist so the AI can grab
  // clean bulk JSON without wrapping/unwrapping JSON-RPC envelopes.
  if (method === 'list_topics') {
    const prefix = typeof params?.prefix === 'string' ? params.prefix : ''
    const keys = await kvList(c.env.KV, { prefix })
    return c.json(makeResult(null, keys))
  }

  if (method === 'get_lore') {
    const key = typeof params?.key === 'string' ? params.key : ''
    if (!key) {
      return c.json(makeError(null, -32602, 'Invalid params: missing key'), 400)
    }
    const raw = await kvGet(c.env.KV, key)
    if (!raw) {
      return c.json(makeError(null, -32601, `Key not found: ${key}`), 404)
    }
    const entry = parseKvEntry(raw)
    return c.json(makeResult(null, entry))
  }

  return c.json(makeError(null, -32601, `Method not found: ${method}`), 400)
})

export default app
