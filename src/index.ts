/**
 * src/index.ts
 *
 * MCP Streamable HTTP server for Cloudflare Workers + Hono
 *
 * - Full JSON-RPC 2.0 with batch support
 * - Session management via Mcp-Session-Id header
 * - Proper initialize → notifications/initialized handshake
 * - Compatible with the MCP Streamable HTTP transport spec
 */

import { Hono } from 'hono'
import { z } from 'zod'

const app = new Hono()

// In-memory session store. Replace with KV/Durable Objects for production.
const sessions: Map<string, { createdAt: number }> = new Map()
const SESSION_ID_HEADER = 'Mcp-Session-Id'
const SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes

function generateSessionId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  for (let i = 0; i < 32; i++) {
    result += chars[bytes[i] % chars.length]
  }
  return result
}

function createSession(): string {
  // Cleanup expired sessions
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(id)
    }
  }
  const sessionId = generateSessionId()
  sessions.set(sessionId, { createdAt: now })
  return sessionId
}

function ensureSession(sessionId: string | null): string {  
  // If client provides a session, trust it and register it  
  if (sessionId) {  
    sessions.set(sessionId, { createdAt: Date.now() });  
    return sessionId;  
  }  
  // Otherwise generate a fresh one  
  const newId = crypto.randomUUID();  
  sessions.set(newId, { createdAt: Date.now() });  
  return newId;  
}  

/**
 * Example lore DB. Replace with Cloudflare KV or Durable Objects as needed.
 */
const loreDB: Record<string, string> = {
  holmgard: `Holmgard is the capital of Sommerlund, a fortress city of stone and fjord. Its longhouses ring the central keep; the Kai Lords maintain order through ritual and blade. The city is known for the Hall of Oaths, the salt markets, and the lighthouse of the First Watch.`,
  lamia: `Lamia are subterranean humanoid predators adapted for burrowing.`,
  undercity: `The Undercity is a sprawling network of damp tunnels beneath ancient ruins.`
}


/**
 * JSON-RPC types
 */
type JsonRpcRequest = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: any
}

type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: string | number | null
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
}

/**
 * Helpers
 */
const makeResult = (id: string | number | null, result: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  result
})

const makeError = (
  id: string | number | null,
  code: number,
  message: string,
  data?: any
): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message, data }
})

/**
 * Validate a single JSON-RPC request object
 */
function validateSingleRequest(
  body: any
): { ok: true; req: JsonRpcRequest } | { ok: false; error: JsonRpcResponse } {
  if (body === null || body === undefined) {
    return { ok: false, error: makeError(null, -32600, 'Invalid Request: empty body') }
  }
  const req = body as JsonRpcRequest
  if (req.jsonrpc !== '2.0') {
    return { ok: false, error: makeError(req.id ?? null, -32600, 'Invalid Request: jsonrpc must be "2.0"') }
  }
  if (!req.method || typeof req.method !== 'string') {
    return { ok: false, error: makeError(req.id ?? null, -32600, 'Invalid Request: method missing or not a string') }
  }
  return { ok: true, req }
}

/**
 * Process a single JSON-RPC method call
 * Returns null for notifications (no response needed)
 */
function processMethod(
  req: JsonRpcRequest,
  id: string | number | null,
  sessionId: string | null
): JsonRpcResponse | null {
  const method = req.method!
  const params = req.params ?? {}

  // initialize handshake
  if (method === 'initialize') {
    return makeResult(id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {
          list: true,
          call: true
        }
      },
      serverInfo: {
        name: 'lamia-lore-mcp',
        version: '0.1.2',
        description: 'Lore retrieval MCP for Shapes'
      }
    })
  }

  // notifications/initialized — no response needed (notification)
  if (method === 'notifications/initialized') {
    return null
  }

  // ping
  if (method === 'ping') {
    return makeResult(id, {})
  }

  // tools/list
  if (method === 'tools/list') {
    const tools = [
        {
          name: 'ping_tool',
          title: 'Ping Tool',
          version: '0.0.1',
          description: 'Trivial tool used to validate discovery.',
          inputSchema: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            properties: {},
            additionalProperties: false
          },
          examples: [{ arguments: {} }]
        },
        {
          name: 'get_lore',
          title: 'Get Lore',
          version: '0.1.2',
          description: 'Retrieve lore, anatomy, factions, and worldbuilding information.',
          // Keep schema explicit but conservative to avoid validator rejections
          inputSchema: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Lore topic to retrieve (e.g., "lamia", "undercity")',
                minLength: 1
              },
              limit: {
                type: 'integer',
                description: 'Optional maximum number of results',
                minimum: 1,
                default: 1
              }
            },
            required: ['query'],
            additionalProperties: false
          },
          examples: [
            { arguments: { query: 'lamia' } },
            { arguments: { query: 'undercity', limit: 1 } }
          ]
        }
      ]

    return makeResult(id, { tools })
  }

  // tools/call
  if (method === 'tools/call') {
    const toolName = params?.name
    const args = params?.arguments ?? {}

    if (!toolName || typeof toolName !== 'string') {
      return makeError(id, -32602, 'Invalid params: missing tool name')
    }

    if (toolName === 'get_lore') {
      const schema = z.object({
        query: z.string().min(1),
        limit: z.number().int().positive().optional()
      })

      const parsed = schema.safeParse(args)
      if (!parsed.success) {
        return makeError(id, -32602, 'Invalid params', parsed.error.format())
      }

      const query = parsed.data.query.toLowerCase()
      const raw = loreDB[query]
      const resultText = raw || 'No lore found.'

      return makeResult(id, {
        content: [{ type: 'text', text: resultText }],
        metadata: {
          source: raw ? 'in-memory' : 'none',
          query
        }
      })
    }

    return makeError(id, -32601, `Method not found: tool "${toolName}"`)
  }

  // Unknown method
  return makeError(id, -32601, `Method not found: ${method}`)
}

/**
 * Health/GET endpoint
 */
app.get('/mcp', (c) => {
  c.header('Content-Type', 'application/json')
  return c.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request: use POST JSON-RPC' } }, 200)
})

/**
 * MCP POST endpoint — Streamable HTTP transport
 */
app.post('/mcp', async (c) => {
  let body: any
  try {
    body = await c.req.json()
  } catch (e) {
    const resp = makeError(null, -32700, 'Parse error: invalid JSON')
    c.header('Content-Type', 'application/json')
    return c.json(resp, 200)
  }

  // Determine session from header
  const sessionId = c.req.header(SESSION_ID_HEADER) || null

  // Handle batch requests (array)
  if (Array.isArray(body)) {
    const responses: (JsonRpcResponse | null)[] = []
    let needsNewSession = false

    for (const item of body) {
      const validated = validateSingleRequest(item)
      if (!validated.ok) {
        // For batch, invalid items get error response if they have an id, or skipped if notification
        if (item.id !== undefined && item.id !== null) {
          responses.push(validated.error)
        }
        continue
      }

      const req = validated.req
      const id = req.id ?? null

      // Check if this is an initialize request
      if (req.method === 'initialize') {
        needsNewSession = true
      }

      // Require valid session for non-initialize, non-notification requests
      if (req.method !== 'initialize' && !req.method?.startsWith('notifications/')) {
        if (sessionId && !ensureSession(sessionId)) {
          responses.push(makeError(id, -32001, 'Session expired or invalid'))
          continue
        }
        if (!sessionId && id !== null) {
          // Request with id but no session — still process it (lenient mode)
        }
      }

      try {
        const result = processMethod(req, id, sessionId)
        if (result !== null) {
          responses.push(result)
        }
      } catch (e) {
        responses.push(makeError(id, -32603, 'Internal error', { message: String(e) }))
      }
    }

    // Filter out nulls (notifications that don't need responses)
    const filtered = responses.filter((r): r is JsonRpcResponse => r !== null)

    // If every item was a notification, return 202 with no body
    if (filtered.length === 0) {
      return c.body(null, 202)
    }

    c.header('Content-Type', 'application/json')
    c.header('Cache-Control', 'no-store')

    const response = c.json(filtered, 200)

    // If this batch contained an initialize, set the session header
    if (needsNewSession) {
      const newSessionId = createSession()
      response.headers.set(SESSION_ID_HEADER, newSessionId)
    }

    return response
  }

  // Single request
  const validated = validateSingleRequest(body)
  if (!validated.ok) {
    c.header('Content-Type', 'application/json')
    return c.json(validated.error, 200)
  }

  const req = validated.req
  const id = req.id ?? null

  // Session validation for non-initialize requests
  if (req.method !== 'initialize' && !req.method?.startsWith('notifications/')) {
    if (sessionId && !ensureSession(sessionId)) {
      c.header('Content-Type', 'application/json')
      return c.json(makeError(id, -32001, 'Session expired or invalid'), 200)
    }
  }

  try {
    const result = processMethod(req, id, sessionId)

    // Notification — no response body
    if (result === null) {
      return c.body(null, 202)
    }

    c.header('Content-Type', 'application/json')
    c.header('Cache-Control', 'no-store')

    const response = c.json(result, 200)

    // If this was initialize, create and return a session
    if (req.method === 'initialize') {
      const newSessionId = createSession()
      response.headers.set(SESSION_ID_HEADER, newSessionId)
    }

    return response
  } catch (e) {
    c.header('Content-Type', 'application/json')
    return c.json(makeError(id, -32603, 'Internal error', { message: String(e) }), 200)
  }
})

/**
 * DELETE /mcp — session termination (spec-compliant)
 */
app.delete('/mcp', (c) => {
  const sessionId = c.req.header(SESSION_ID_HEADER)
  if (sessionId && sessions.has(sessionId)) {
    sessions.delete(sessionId)
    return c.body(null, 200)
  }
  return c.body(null, 404)
})

/**
 * Global 404 / fallback
 */
app.all('*', (c) => {
  return c.text('Not Found', 404)
})

export default app
