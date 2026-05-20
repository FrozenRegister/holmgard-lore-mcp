// src/index.ts
import { Hono } from 'hono'
import { z } from 'zod'

/**
 * Holmgard Lore MCP Worker
 *
 * - JSON-RPC 2.0 endpoint at POST /mcp
 * - GET /mcp returns a JSON-RPC error (discovery should use POST)
 * - Tools: ping_tool, get_lore, list_topics
 * - Optional KV binding: LORE_DB (for persistent storage)
 * - Optional admin endpoint: POST /admin/set-lore (protected by ADMIN_SECRET env var)
 *
 * Notes:
 * - If you bind a KV namespace in wrangler.toml, add:
 *   [[kv_namespaces]]
 *   binding = "LORE_DB"
 *   id = "<your-kv-id>"
 *
 * - Keep Cache-Control: no-store on initialize and tools/list responses so Shapes re-fetches manifests.
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
  error?: { code: number; message: string; data?: any }
}

const makeResult = (id: string | number | null, result: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  result
})

const makeError = (id: string | number | null, code: number, message: string, data?: any): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message, data }
})

const validateRequest = (body: any): { ok: true; req: JsonRpcRequest } | { ok: false; error: JsonRpcResponse } => {
  if (body === null || body === undefined) return { ok: false, error: makeError(null, -32600, 'Invalid Request: empty body') }
  if (Array.isArray(body)) return { ok: false, error: makeError(null, -32600, 'Batch requests are not supported') }
  const req = body as JsonRpcRequest
  if (req.jsonrpc !== '2.0') return { ok: false, error: makeError(req.id ?? null, -32600, 'Invalid Request: jsonrpc must be "2.0"') }
  if (!req.method || typeof req.method !== 'string') return { ok: false, error: makeError(req.id ?? null, -32600, 'Invalid Request: method missing or not a string') }
  return { ok: true, req }
}

const app = new Hono()

/**
 * In-memory fallback lore DB.
 * If you bind Workers KV (LORE_DB), the code will prefer KV values.
 */
const loreDB: Record<string, string> = {
  holmgard: `Holmgard is the capital of Sommerlund, a fortress city of stone and fjord. Its longhouses ring the central keep; the Kai Lords maintain order through ritual and blade. The city is known for the Hall of Oaths, the salt markets, and the lighthouse of the First Watch.`,
  lamia: `Lamia are subterranean humanoid predators adapted for burrowing.`,
  undercity: `The Undercity is a sprawling network of damp tunnels beneath ancient ruins.`
}

/**
 * GET /mcp
 * Return a JSON-RPC error telling callers to use POST.
 */
app.get('/mcp', (c) => {
  c.header('Content-Type', 'application/json')
  c.header('Cache-Control', 'no-store')
  return c.json(makeError(null, -32600, 'Invalid Request: use POST JSON-RPC'), 200)
})

/**
 * POST /mcp
 * Main JSON-RPC handler for initialize, tools/list, tools/call
 */
app.post('/mcp', async (c) => {
  let body: any
  try {
    body = await c.req.json()
  } catch (e) {
    console.error('Failed to parse JSON body', e)
    return c.json(makeError(null, -32700, 'Parse error: invalid JSON'), 200)
  }

  try {
    // Log incoming request for wrangler tail
    try { console.log('MCP incoming:', JSON.stringify(body)) } catch (e) {}

    const validated = validateRequest(body)
    if (!validated.ok) return c.json(validated.error, 200)

    const req = validated.req
    const id = req.id ?? null
    const method = req.method!
    const params = req.params ?? {}

    // initialize
    if (method === 'initialize') {
      const result = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { list: true, call: true } },
        serverInfo: { name: 'holmgard-lore-mcp', version: '0.1.0', description: 'Holmgard lore MCP' }
      }
      c.header('Cache-Control', 'no-store')
      c.header('Content-Type', 'application/json')
      console.log('MCP initialize ->', JSON.stringify(result))
      return c.json(makeResult(id, result), 200)
    }

    // ping (simple health)
    if (method === 'ping') {
      return c.json(makeResult(id, {}), 200)
    }

    // tools/list (discovery)
    if (method === 'tools/list') {
      const tools = [
        {
          name: 'ping_tool',
          title: 'Ping Tool',
          version: '0.0.1',
          description: 'Trivial tool used to validate discovery.',
          inputSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: {}, additionalProperties: false },
          examples: [{ arguments: {} }]
        },
        {
          name: 'get_lore',
          title: 'Get Lore',
          version: '0.1.2',
          description: 'Retrieve lore, anatomy, factions, and worldbuilding information.',
          inputSchema: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Lore topic to retrieve (e.g., "lamia", "undercity")', minLength: 1 },
              limit: { type: 'integer', description: 'Optional maximum number of results', minimum: 1, default: 1 }
            },
            required: ['query'],
            additionalProperties: false
          },
          examples: [{ arguments: { query: 'lamia' } }, { arguments: { query: 'undercity', limit: 1 } }]
        },
        {
          name: 'list_topics',
          title: 'List Topics',
          version: '0.1.0',
          description: 'Return available lore topics.',
          inputSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: {}, additionalProperties: false },
          examples: [{ arguments: {} }]
        }
      ]

      try { console.log('MCP tools/list ->', JSON.stringify({ tools })) } catch (e) {}
      c.header('Cache-Control', 'no-store')
      c.header('Content-Type', 'application/json')
      return c.json(makeResult(id, { tools }), 200)
    }

    // tools/call
    if (method === 'tools/call') {
      const toolName = params?.name
      const args = params?.arguments ?? {}
      if (!toolName || typeof toolName !== 'string') return c.json(makeError(id, -32602, 'Invalid params: missing tool name'), 200)

      // ping_tool
      if (toolName === 'ping_tool') {
        return c.json(makeResult(id, { content: [{ type: 'text', text: 'pong' }], metadata: { source: 'internal', tool: 'ping_tool' } }), 200)
      }

      // list_topics
      if (toolName === 'list_topics') {
        // If KV is bound, prefer listing keys from KV is expensive; here we list in-memory keys.
        const topics = Object.keys(loreDB)
        const toolResult = { content: [{ type: 'text', text: topics.join(', ') }], metadata: { count: topics.length } }
        return c.json(makeResult(id, toolResult), 200)
      }

      // get_lore (supports KV if bound)
      if (toolName === 'get_lore') {
        const schema = z.object({ query: z.string().min(1), limit: z.number().int().positive().optional() })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const query = parsed.data.query.toLowerCase()
        const limit = parsed.data.limit ?? 1

        // If KV binding exists, try KV first
        let raw: string | null | undefined = undefined
        try {
          // @ts-ignore - LORE_DB is injected by Wrangler if bound
          if (typeof (globalThis as any).LORE_DB !== 'undefined' || (c.env && (c.env as any).LORE_DB)) {
            // Hono exposes bindings via c.env in some setups; try both
            const kv = (c.env as any)?.LORE_DB ?? (globalThis as any).LORE_DB
            if (kv && typeof kv.get === 'function') {
              raw = await kv.get(query)
            }
          }
        } catch (e) {
          console.warn('KV read failed, falling back to in-memory', e)
        }

        // Fallback to in-memory DB
        if (!raw) raw = loreDB[query]

        const resultText = raw ?? 'No lore found.'
        const toolResult = { content: [{ type: 'text', text: resultText }], metadata: { source: raw ? (raw === loreDB[query] ? 'in-memory' : 'kv') : 'none', query, limit } }
        return c.json(makeResult(id, toolResult), 200)
      }

      return c.json(makeError(id, -32601, `Method not found: tool "${toolName}"`), 200)
    }

    // method not found
    return c.json(makeError(id, -32601, `Method not found: ${method}`), 200)
  } catch (e) {
    console.error('Unhandled exception in MCP handler', e)
    return c.json(makeError(null, -32603, 'Internal error', { message: String(e) }), 200)
  }
})

/**
 * Admin endpoint to set lore into KV (if bound) or in-memory fallback.
 * POST /admin/set-lore
 * Body: { key: string, text: string, secret: string }
 *
 * WARNING: This endpoint is intentionally minimal. Protect ADMIN_SECRET and do not expose publicly.
 */
app.post('/admin/set-lore', async (c) => {
  try {
    const body = await c.req.json()
    const key = (body?.key ?? '').toString().trim().toLowerCase()
    const text = (body?.text ?? '').toString()
    const secret = (body?.secret ?? '').toString()

    if (!key || !text) return c.json({ ok: false, error: 'missing key or text' }, 400)

    const ADMIN_SECRET = process.env.ADMIN_SECRET ?? (c.env ? (c.env as any).ADMIN_SECRET : undefined)
    if (!ADMIN_SECRET || secret !== ADMIN_SECRET) return c.json({ ok: false, error: 'unauthorized' }, 401)

    // Try KV put if available
    try {
      // @ts-ignore
      const kv = (c.env as any)?.LORE_DB ?? (globalThis as any).LORE_DB
      if (kv && typeof kv.put === 'function') {
        await kv.put(key, text)
        return c.json({ ok: true, source: 'kv' }, 200)
      }
    } catch (e) {
      console.warn('KV put failed, falling back to in-memory', e)
    }

    // Fallback to in-memory (ephemeral)
    loreDB[key] = text
    return c.json({ ok: true, source: 'in-memory' }, 200)
  } catch (e) {
    console.error('admin/set-lore error', e)
    return c.json({ ok: false, error: String(e) }, 500)
  }
})

app.all('*', (c) => c.text('Not Found', 404))

export default app
