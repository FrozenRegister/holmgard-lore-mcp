// src/index.ts
import { Hono } from 'hono'
import { z } from 'zod'

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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret',
}

const makeResult = (id: string | number | null, result: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0', id, result
})

const makeError = (id: string | number | null, code: number, message: string, data?: any): JsonRpcResponse => ({
  jsonrpc: '2.0', id, error: { code, message, data }
})

const validateRequest = (body: any): { ok: true; req: JsonRpcRequest } | { ok: false; error: JsonRpcResponse } => {
  if (body === null || body === undefined) return { ok: false, error: makeError(null, -32600, 'Invalid Request: empty body') }
  if (Array.isArray(body)) return { ok: false, error: makeError(null, -32600, 'Batch requests are not supported') }
  const req = body as JsonRpcRequest
  if (req.jsonrpc !== '2.0') return { ok: false, error: makeError(req.id ?? null, -32600, 'Invalid Request: jsonrpc must be "2.0"') }
  if (!req.method || typeof req.method !== 'string') return { ok: false, error: makeError(req.id ?? null, -32600, 'Invalid Request: method missing or not a string') }
  return { ok: true, req }
}

// ── KV helpers ────────────────────────────────────────────────────────────────

function getKV(c: any): KVNamespace | null {
  return (c.env as any)?.LORE_DB ?? null
}

async function kvGet(c: any, key: string): Promise<string | null> {
  try {
    const kv = getKV(c)
    if (kv) return await kv.get(key)
  } catch (e) { console.warn('KV get failed', e) }
  return null
}

async function kvList(c: any): Promise<string[]> {
  try {
    const kv = getKV(c)
    if (kv) {
      const listed = await kv.list()
      return listed.keys.map((k: any) => k.name)
    }
  } catch (e) { console.warn('KV list failed', e) }
  return []
}

async function kvPut(c: any, key: string, value: string): Promise<boolean> {
  try {
    const kv = getKV(c)
    if (kv) { await kv.put(key, value); return true }
  } catch (e) { console.warn('KV put failed', e) }
  return false
}

async function kvDelete(c: any, key: string): Promise<boolean> {
  try {
    const kv = getKV(c)
    if (kv) { await kv.delete(key); return true }
  } catch (e) { console.warn('KV delete failed', e) }
  return false
}

// Handles both old (raw string) and new ({ text, meta }) KV formats
function parseKvEntry(raw: string): { text: string; meta: Record<string, unknown> } {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.text === 'string') {
      return { text: parsed.text, meta: parsed.meta ?? {} };
    }
  } catch {}
  // Covers: parse failure OR parsed but no text field
  return { text: raw, meta: {} };
}


// ── In-memory fallback ────────────────────────────────────────────────────────
const loreDB: Record<string, string> = {}

// ── App ───────────────────────────────────────────────────────────────────────

const app = new Hono()

app.use('*', async (c, next) => {
  await next()
  Object.entries(CORS_HEADERS).forEach(([k, v]) => c.header(k, v))
})

app.options('*', (c) => new Response(null, { status: 204, headers: CORS_HEADERS }))

app.get('/mcp', (c) => {
  c.header('Content-Type', 'application/json')
  c.header('Cache-Control', 'no-store')
  return c.json(makeError(null, -32600, 'Invalid Request: use POST JSON-RPC'), 200)
})

app.post('/mcp', async (c) => {
  let body: any
  try {
    body = await c.req.json()
  } catch (e) {
    return c.json(makeError(null, -32700, 'Parse error: invalid JSON'), 200)
  }

  try {
    try { console.log('MCP incoming:', JSON.stringify(body)) } catch (e) {}

    const validated = validateRequest(body)
    if (!validated.ok) return c.json(validated.error, 200)

    const req = validated.req
    const id = req.id ?? null
    const method = req.method!
    const params = req.params ?? {}

    if (method === 'initialize') {
      c.header('Cache-Control', 'no-store')
      c.header('Content-Type', 'application/json')
      return c.json(makeResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { list: true, call: true } },
        serverInfo: { name: 'holmgard-lore-mcp', version: '0.2.0', description: 'Holmgard lore MCP' }
      }), 200)
    }

    if (method === 'ping') {
      return c.json(makeResult(id, {}), 200)
    }

    if (method === 'tools/list') {
      c.header('Cache-Control', 'no-store')
      c.header('Content-Type', 'application/json')
      return c.json(makeResult(id, { tools: [
        {
          name: 'ping_tool', title: 'Ping Tool', version: '0.0.1',
          description: 'Trivial tool used to validate discovery.',
          inputSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: {}, additionalProperties: false },
          examples: [{ arguments: {} }]
        },
        {
          name: 'get_lore', title: 'Get Lore', version: '0.1.2',
          description: 'Retrieve lore, anatomy, factions, and worldbuilding information.',
          inputSchema: {
            $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
            properties: {
              query: { type: 'string', description: 'Lore topic to retrieve (e.g. "lamia", "undercity")', minLength: 1 },
              limit: { type: 'integer', minimum: 1, default: 1 }
            },
            required: ['query'], additionalProperties: false
          },
          examples: [{ arguments: { query: 'lamia' } }]
        },
        {
          name: 'list_topics', title: 'List Topics', version: '0.1.0',
          description: 'Return all available lore topic keys.',
          inputSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: {}, additionalProperties: false },
          examples: [{ arguments: {} }]
        },
        {
          name: 'set_lore', title: 'Set Lore', version: '0.1.0',
          description: 'Write or update a lore entry. Use this to record new worldbuilding, anatomy, factions, or location details so they persist for future queries.',
          inputSchema: {
            $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
            properties: {
              key:  { type: 'string', description: 'Topic key — lowercase, no spaces (e.g. "lamia", "undercity")', minLength: 1 },
              text: { type: 'string', description: 'Full lore text to store for this topic.', minLength: 1 }
            },
            required: ['key', 'text'], additionalProperties: false
          },
          examples: [{ arguments: { key: 'lamia', text: 'Lamia are subterranean predators...' } }]
        },
        {
          name: 'delete_lore', title: 'Delete Lore', version: '0.1.0',
          description: 'Permanently delete a lore entry by key.',
          inputSchema: {
            $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
            properties: {
              key: { type: 'string', description: 'Topic key to delete', minLength: 1 }
            },
            required: ['key'], additionalProperties: false
          },
          examples: [{ arguments: { key: 'thornwall' } }]
        }

      ]}), 200)
    }

    if (method === 'tools/call') {
      const toolName = params?.name
      const args = params?.arguments ?? {}
      if (!toolName || typeof toolName !== 'string')
        return c.json(makeError(id, -32602, 'Invalid params: missing tool name'), 200)

      if (toolName === 'ping_tool') {
        return c.json(makeResult(id, { content: [{ type: 'text', text: 'pong' }], metadata: { source: 'internal' } }), 200)
      }

      if (toolName === 'list_topics') {
        let keys = await kvList(c)
        if (!keys.length) keys = Object.keys(loreDB)
        return c.json(makeResult(id, { content: [{ type: 'text', text: keys.join(', ') }], metadata: { count: keys.length } }), 200)
      }

      if (toolName === 'get_lore') {
        const schema = z.object({
          key: z.string().min(1).optional(),
          query: z.string().min(1).optional(),
        }).refine(d => d.key || d.query, { message: 'key or query is required' })

        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const key = (parsed.data.key ?? parsed.data.query ?? '').trim().toLowerCase()
        const raw = await kvGet(c, key)

        if (!raw) return c.json(makeError(id, -32602, `No lore found for key "${key}"`, null), 200)

        const { text, meta } = parseKvEntry(raw)

        return c.json(makeResult(id, {
          content: [{ type: 'text', text }],
          key,
          text,
          meta,
        }), 200)
      }



      if (toolName === 'set_lore') {
        const schema = z.object({ key: z.string().min(1), text: z.string() })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const key = parsed.data.key.trim().toLowerCase()
        const text = parsed.data.text

        // ── Read existing entry to preserve/increment version ──────────────────
        const existing = await kvGet(c, key)
        let existingMeta: Record<string, unknown> = {}
        if (existing) {
          try { existingMeta = JSON.parse(existing).meta ?? {} } catch { }
        }

        const now = new Date().toISOString()
        const version = typeof existingMeta.version === 'number' ? existingMeta.version + 1 : 1

        const payload = JSON.stringify({
          text,
          meta: {
            version,
            updatedAt: now,
            createdAt: existingMeta.createdAt ?? now,
          },
        })

        await kvPut(c, key, payload)
        loreDB[key] = text

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: `Lore saved for "${key}" (v${version}).` }],
          metadata: { key, version }
        }), 200)
      }

      
      if (toolName === 'delete_lore') {
        const schema = z.object({ key: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const key = parsed.data.key.trim().toLowerCase()
        const deleted = await kvDelete(c, key)
        delete loreDB[key]

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: `Lore deleted for "${key}".` }],
          metadata: { source: deleted ? 'kv' : 'in-memory', key }
        }), 200)
      }


      return c.json(makeError(id, -32601, `Method not found: tool "${toolName}"`), 200)
    }

    if (method === 'list_topics') {
      let keys = await kvList(c)
      if (!keys.length) keys = Object.keys(loreDB)
      return c.json(makeResult(id, { keys }), 200)
    }

    if (method === 'get_lore') {
      const key = (params?.key ?? params?.query ?? '').toString().toLowerCase()
      if (!key) return c.json(makeError(id, -32602, 'Invalid params: missing key'), 200)

      const raw = (await kvGet(c, key)) ?? loreDB[key] ?? null
      if (!raw) return c.json(makeError(id, -32601, `No lore found for key: ${key}`), 200)

      const { text, meta } = parseKvEntry(raw)
      return c.json(makeResult(id, { key, text, meta }), 200)
    }


    return c.json(makeError(id, -32601, `Method not found: ${method}`), 200)

  } catch (e) {
    console.error('Unhandled exception in MCP handler', e)
    return c.json(makeError(null, -32603, 'Internal error', { message: String(e) }), 200)
  }
})

app.post('/admin/set-lore', async (c) => {
  try {
    const body   = await c.req.json()
    const key    = (body?.key    ?? '').toString().trim().toLowerCase()
    const text   = (body?.text   ?? '').toString()
    const secret = (body?.secret ?? '').toString()

    if (!key || !text) return c.json({ ok: false, error: 'missing key or text' }, 400)

    const ADMIN_SECRET = (c.env as any)?.ADMIN_SECRET
    if (!ADMIN_SECRET || secret !== ADMIN_SECRET)
      return c.json({ ok: false, error: 'unauthorized' }, 401)

    // ── Read existing entry to preserve/increment version ───────────────────
    const existing = await kvGet(c, key)
    let existingMeta: Record<string, unknown> = {}
    if (existing) {
      try { existingMeta = JSON.parse(existing).meta ?? {} } catch {}
    }

    const now     = new Date().toISOString()
    const version = typeof existingMeta.version === 'number' ? existingMeta.version + 1 : 1

    const payload = JSON.stringify({
      text,
      meta: {
        version,
        updatedAt: now,
        createdAt: existingMeta.createdAt ?? now,
      },
    })

    await kvPut(c, key, payload)
    loreDB[key] = text

    return c.json({ ok: true, version }, 200)
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})


app.post('/admin/delete-lore', async (c) => {
  try {
    const body = await c.req.json()
    const key    = (body?.key    ?? '').toString().trim().toLowerCase()
    const secret = (body?.secret ?? '').toString()

    if (!key) return c.json({ ok: false, error: 'missing key' }, 400)

    const ADMIN_SECRET = (c.env as any)?.ADMIN_SECRET
    if (!ADMIN_SECRET || secret !== ADMIN_SECRET)
      return c.json({ ok: false, error: 'unauthorized' }, 401)

    const deleted = await kvDelete(c, key)
    delete loreDB[key]
    return c.json({ ok: true, source: deleted ? 'kv' : 'in-memory' }, 200)
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})


app.all('*', (c) => c.text('Not Found', 404))

export default app
