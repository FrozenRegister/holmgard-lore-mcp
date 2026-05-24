// src/index.ts
import { Hono } from 'hono'
import { z } from 'zod'

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Constants ─────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret',
}

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────

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

// ── In-memory fallback ────────────────────────────────────────────────────────
// Keeps the server functional when Cloudflare KV is unavailable (e.g. local dev).
// Not persisted across worker restarts — KV is the source of truth.
const loreDB: Record<string, string> = {}

// ── KV helpers ────────────────────────────────────────────────────────────────
// Reads fall back to loreDB automatically so callers don't need to handle it.

function getKV(c: any): KVNamespace | null {
  return (c.env as any)?.LORE_DB ?? null
}

async function kvGet(c: any, key: string): Promise<string | null> {
  try {
    const kv = getKV(c)
    if (kv) return (await kv.get(key)) ?? loreDB[key] ?? null
  } catch (e) { console.warn('KV get failed', e) }
  return loreDB[key] ?? null
}

async function kvList(c: any): Promise<string[]> {
  try {
    const kv = getKV(c)
    if (kv) {
      const listed = await kv.list()
      const keys = listed.keys.map((k: any) => k.name).filter((k: string) => !k.startsWith('_history:'))
      if (keys.length) return keys
    }
  } catch (e) { console.warn('KV list failed', e) }
  return Object.keys(loreDB).filter(k => !k.startsWith('_history:'))
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

// ── History helpers ───────────────────────────────────────────────────────────

const HISTORY_DEPTH = 5

// Pushes currentRaw (the value about to be overwritten) onto _history:{key}.
// Pass the already-read raw string to avoid an extra KV round-trip.
async function pushHistory(c: any, key: string, currentRaw: string): Promise<void> {
  const kv = getKV(c)
  if (!kv) return
  const historyKey = `_history:${key}`
  let history: string[] = []
  try {
    const existing = await kv.get(historyKey)
    if (existing) history = JSON.parse(existing)
  } catch { }
  history.unshift(currentRaw)
  history = history.slice(0, HISTORY_DEPTH)
  await kv.put(historyKey, JSON.stringify(history))
}

// ── Lore entry helpers ────────────────────────────────────────────────────────

// Handles both the legacy plain-string format and the current { text, meta } JSON format.
function parseKvEntry(raw: string): { text: string; meta: Record<string, unknown> } {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.text === 'string') {
      return { text: parsed.text, meta: parsed.meta ?? {} }
    }
  } catch { }
  return { text: raw, meta: {} }
}

// Reads a **Field:** value from markdown-formatted lore text. Returns a number if parseable.
function extractFieldFromText(text: string, fieldPath: string): unknown {
  try {
    const lines = text.replace(/\r\n/g, '\n').split('\n')
    const escapedField = fieldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const line of lines) {
      const match = line.match(new RegExp(`^\\*\\*${escapedField}:\\*\\*\\s*(.+)$`, 'i'))
      if (match) {
        const value = match[1].trim()
        const numMatch = value.match(/^-?\d+/)
        if (numMatch) return parseInt(numMatch[0], 10)
        try { return JSON.parse(value) } catch { }
        return value
      }
    }
  } catch (e) {
    console.warn('extractFieldFromText error', e)
  }
  return null
}

// Replaces a **Field:** line in place, or appends it if not found.
function updateFieldInText(text: string, fieldPath: string, newValue: any): string {
  try {
    const lines = text.replace(/\r\n/g, '\n').split('\n')
    const escapedField = fieldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const searchRegex = new RegExp(`^\\*\\*${escapedField}:\\*\\*\\s*(.+)$`, 'i')
    let found = false
    const updated = lines.map(line => {
      if (searchRegex.test(line)) { found = true; return `**${fieldPath}:** ${newValue}` }
      return line
    })
    if (!found) updated.push(`**${fieldPath}:** ${newValue}`)
    return updated.join('\n')
  } catch (e) {
    console.warn('updateFieldInText error', e)
    return text
  }
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0; let pos = 0
  while (true) {
    const idx = haystack.indexOf(needle, pos)
    if (idx === -1) break
    count++; pos = idx + needle.length
  }
  return count
}

// Parses the system:active-narratives entry into structured thread objects.
function extractActiveThreads(narrativeText: string): Array<any> {
  const threads: Array<any> = []
  try {
    const lines = narrativeText.split('\n')
    let currentCategory = ''
    for (const line of lines) {
      if (line.includes('**Ascension Threads')) currentCategory = 'Ascension'
      if (line.includes('**Dissolution Threads')) currentCategory = 'Dissolution'
      const threadMatch = line.match(/^\s*-\s*\*\*(\w[\w_]*)\*\*\s*(?:\((\w+)\))?/)
      if (threadMatch) {
        threads.push({
          thread_name: threadMatch[1],
          category: currentCategory,
          character: threadMatch[2] || 'unknown',
          status: 'Active'
        })
      }
    }
  } catch (e) {
    console.warn('extractActiveThreads error', e)
  }
  return threads
}

// Extracts timeline/status/processor fields from a character lore entry.
// v0.2.0 — strengthened to match **Consumption-Timeline:** (new standard) with fallbacks.
function extractConsumptionInfo(characterText: string): any {
  try {
    // Match **Consumption-Timeline:** first (new standard), then legacy formats
    const timelineMatch =
      characterText.match(/\*\*Consumption[- ]Timeline:\*\*\s*(.+?)(?:\n|$)/i) ||
      characterText.match(/\*\*Projected[- ]Consumption[- ]Timeline:\*\*\s*(.+?)(?:\n|$)/i)

    const statusMatch =
      characterText.match(/\*\*Status:\*\*\s*(.+?)(?:\n|$)/i) ||
      characterText.match(/Status[*-:]*\s*(.+?)(?:\n|$)/i)

    const processorMatch =
      characterText.match(/\*\*Processor:\*\*\s*(.+?)(?:\n|$)/i) ||
      characterText.match(/Processor[*-:]*\s*(.+?)(?:\n|$)/i)

    return {
      timeline_remaining: timelineMatch ? timelineMatch[1].trim() : null,
      status: statusMatch ? statusMatch[1].trim() : 'active',
      processor: processorMatch ? processorMatch[1].trim() : 'unknown'
    }
  } catch (e) {
    return { timeline_remaining: null, status: 'active', processor: 'unknown' }
  }
}

// ── App ───────────────────────────────────────────────────────────────────────

const app = new Hono()

app.use('*', async (c, next) => {
  await next()
  Object.entries(CORS_HEADERS).forEach(([k, v]) => c.header(k, v))
})

app.options('*', (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }))

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
    try { console.log('MCP incoming:', JSON.stringify(body)) } catch (e) { }

    const validated = validateRequest(body)
    if (!validated.ok) return c.json(validated.error, 200)

    const req = validated.req
    const id = req.id ?? null
    const method = req.method!
    const params = req.params ?? {}

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
      return c.json(makeResult(id, {
        tools: [
          {
            name: 'ping_tool', title: 'Ping Tool', version: '0.0.1',
            description: 'Trivial tool used to validate discovery.',
            inputSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: {}, additionalProperties: false },
            examples: [{ arguments: {} }]
          },
          {
            name: 'get_lore', title: 'Get Lore', version: '0.1.3',
            description: 'Retrieve lore, anatomy, factions, and worldbuilding information by topic key.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                query: { type: 'string', description: 'Exact topic key to retrieve (e.g. "lamia", "location:undercity")', minLength: 1 }
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
                key: { type: 'string', description: 'Topic key — lowercase, no spaces (e.g. "lamia", "undercity")', minLength: 1 },
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
          },
          {
            name: 'get_lore_batch', title: 'Get Lore Batch', version: '0.1.0',
            description: 'Retrieve multiple lore entries in one call. Optimized for reducing API round-trips.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                keys: {
                  type: 'array',
                  items: { type: 'string', minLength: 1 },
                  description: 'Array of topic keys to retrieve (e.g. ["character:sarah-weaver", "location:fernveil:outpost:deep-forest-cafe", "system:active-narratives"])',
                  minItems: 1
                }
              },
              required: ['keys'], additionalProperties: false
            },
            examples: [{ arguments: { keys: ['character:sarah-weaver', 'location:fernveil:outpost:deep-forest-cafe'] } }]
          },
          {
            name: 'list_consumption_timelines', title: 'List Consumption Timelines', version: '0.2.0',
            description: 'Return all prey-characters with current consumption-status and timeline-remaining. Scans all character:* keys for Consumption-Timeline fields.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                status_filter: {
                  type: 'string',
                  enum: ['all', 'imminent', 'days-to-weeks', 'weeks-to-months', 'consumed'],
                  default: 'all',
                  description: 'Filter by consumption status. "imminent" = hours or 1 day remaining.'
                }
              },
              additionalProperties: false
            },
            examples: [{ arguments: { status_filter: 'imminent' } }]
          },
          {
            name: 'list_active_threads', title: 'List Active Threads', version: '0.1.0',
            description: 'Return all active consumption/predation threads with current status.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {},
              additionalProperties: false
            },
            examples: [{ arguments: {} }]
          },
          {
            name: 'increment_topic_field', title: 'Increment Topic Field', version: '0.1.0',
            description: 'Atomically increment a numeric field in a topic without full rewrite.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                key: { type: 'string', description: 'Topic key (e.g. "character:lucinda-prime-livestock")', minLength: 1 },
                field_path: { type: 'string', description: 'Field to increment (e.g. "days_remaining", "version")', minLength: 1 },
                increment: { type: 'integer', description: 'Positive or negative integer to add', default: 1 },
                reason: { type: 'string', description: 'Reason for the change (logged)', default: 'system-update' }
              },
              required: ['key', 'field_path'], additionalProperties: false
            },
            examples: [{ arguments: { key: 'character:lucinda-prime-livestock', field_path: 'days_remaining', increment: -1, reason: 'daily-decrement' } }]
          },
          {
            name: 'validate_topic_exists', title: 'Validate Topic Exists', version: '0.1.0',
            description: 'Check if a topic exists and return namespace-suggestions if not.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                query_string: { type: 'string', description: 'What the user asked for (e.g. "molly")', minLength: 1 }
              },
              required: ['query_string'], additionalProperties: false
            },
            examples: [{ arguments: { query_string: 'molly' } }]
          },
          {
            name: 'search_lore', title: 'Search Lore', version: '0.1.0',
            description: 'Full-text search across all lore entry bodies. Returns matching keys with excerpt snippets.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                query: { type: 'string', description: 'Search term (case-insensitive substring match)', minLength: 1 },
                max_results: { type: 'integer', minimum: 1, maximum: 50, default: 10 }
              },
              required: ['query'], additionalProperties: false
            },
            examples: [{ arguments: { query: 'lamia', max_results: 5 } }]
          },
          {
            name: 'patch_lore', title: 'Patch Lore', version: '0.1.0',
            description: 'Surgically modify a lore entry without full overwrite. Supports replace, append, and delete_field operations on substrings.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                key: { type: 'string', description: 'Topic key to modify', minLength: 1 },
                operation: { type: 'string', enum: ['replace', 'append', 'delete_field'], description: 'Operation to perform: replace, append, or delete_field' },
                target: { type: 'string', description: 'Exact substring to match. Required for replace and delete_field. Optional for append (if omitted, appends to end of text).' },
                value: { type: 'string', description: 'New text. Required for replace and append. Ignored for delete_field.' }
              },
              required: ['key', 'operation'], additionalProperties: false
            },
            examples: [{ arguments: { key: 'character:example', operation: 'replace', target: 'Status: Alive', value: 'Status: Sedated' } }]
          },
          {
            name: 'batch_set_lore', title: 'Batch Set Lore', version: '0.1.0',
            description: 'Write or overwrite multiple lore entries in one call. Returns per-key success/failure. Uses parallel writes — not transactional; partial success is possible.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                entries: {
                  type: 'array', minItems: 1,
                  items: {
                    type: 'object',
                    properties: {
                      key: { type: 'string', minLength: 1 },
                      text: { type: 'string', minLength: 1 }
                    },
                    required: ['key', 'text'], additionalProperties: false
                  }
                }
              },
              required: ['entries'], additionalProperties: false
            },
            examples: [{ arguments: { entries: [{ key: 'character:zira', text: 'Zira lore...' }, { key: 'character:vex', text: 'Vex lore...' }] } }]
          },
          {
            name: 'batch_mutate', title: 'Batch Mutate', version: '0.1.0',
            description: 'Apply multiple mutations (increment or patch) across multiple keys in one call. Each mutation is applied sequentially. Returns per-mutation outcome.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                mutations: {
                  type: 'array', minItems: 1,
                  items: {
                    type: 'object',
                    properties: {
                      key: { type: 'string', minLength: 1 },
                      action: { type: 'string', enum: ['increment', 'patch'] },
                      field_path: { type: 'string' },
                      increment: { type: 'integer' },
                      reason: { type: 'string' },
                      operation: { type: 'string', enum: ['replace', 'append', 'delete_field'] },
                      target: { type: 'string' },
                      value: { type: 'string' }
                    },
                    required: ['key', 'action'], additionalProperties: false
                  }
                }
              },
              required: ['mutations'], additionalProperties: false
            },
            examples: [{ arguments: { mutations: [{ key: 'character:zira', action: 'patch', operation: 'replace', target: 'Status: Alive', value: 'Status: Sedated' }, { key: 'character:zira', action: 'increment', field_path: 'Days-Remaining', increment: -1 }] } }]
          },
          {
            name: 'restore_lore', title: 'Restore Lore', version: '0.1.0',
            description: 'Restore a lore entry to its previous state by popping the history stack. Writes to the same key are snapshotted automatically (up to 5 deep).',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                key: { type: 'string', description: 'Topic key to restore', minLength: 1 }
              },
              required: ['key'], additionalProperties: false
            },
            examples: [{ arguments: { key: 'character:sarah-weaver' } }]
          }
        ]
      }), 200)
    }

    // ── tools/call ────────────────────────────────────────────────────────────
    if (method === 'tools/call') {
      const toolName = params?.name
      const args = params?.arguments ?? {}
      if (!toolName || typeof toolName !== 'string')
        return c.json(makeError(id, -32602, 'Invalid params: missing tool name'), 200)

      if (toolName === 'ping_tool') {
        return c.json(makeResult(id, { content: [{ type: 'text', text: 'pong' }], metadata: { source: 'internal' } }), 200)
      }

      if (toolName === 'list_topics') {
        const keys = await kvList(c)
        return c.json(makeResult(id, { content: [{ type: 'text', text: keys.join(', ') }], metadata: { count: keys.length } }), 200)
      }

      if (toolName === 'get_lore') {
        const schema = z.object({ query: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const key = parsed.data.query.trim().toLowerCase()
        const raw = await kvGet(c, key)
        if (!raw) return c.json(makeError(id, -32602, `No lore found for key "${key}"`, null), 200)

        const { text, meta } = parseKvEntry(raw)
        return c.json(makeResult(id, { content: [{ type: 'text', text }], key, text, meta }), 200)
      }

      if (toolName === 'set_lore') {
        const schema = z.object({ key: z.string().min(1), text: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const key = parsed.data.key.trim().toLowerCase()
        const text = parsed.data.text

        const existingRaw = await kvGet(c, key)
        const existingMeta = existingRaw ? parseKvEntry(existingRaw).meta : {}

        if (existingRaw) await pushHistory(c, key, existingRaw)

        const now = new Date().toISOString()
        const version = typeof existingMeta.version === 'number' ? existingMeta.version + 1 : 1

        const payload = JSON.stringify({
          text,
          meta: { version, updatedAt: now, createdAt: existingMeta.createdAt ?? now },
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

      if (toolName === 'get_lore_batch') {
        const schema = z.object({ keys: z.array(z.string().min(1)).min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const cleanKeys = parsed.data.keys.map(k => k.trim().toLowerCase())
        const rawValues = await Promise.all(cleanKeys.map(k => kvGet(c, k)))
        const results: Record<string, any> = {}
        cleanKeys.forEach((k, i) => { results[k] = rawValues[i] ? parseKvEntry(rawValues[i]!) : null })

        const text = Object.entries(results)
          .map(([k, v]) => v ? `${k}: [retrieved]` : `${k}: [not found]`)
          .join('\n')

        return c.json(makeResult(id, {
          content: [{ type: 'text', text }],
          metadata: { retrieved: Object.values(results).filter(v => v !== null).length, total: parsed.data.keys.length },
          results
        }), 200)
      }

      // ── list_consumption_timelines (v0.2.0 — broad character scan) ──────────
      if (toolName === 'list_consumption_timelines') {
        const schema = z.object({
          status_filter: z.enum(['all', 'imminent', 'days-to-weeks', 'weeks-to-months', 'consumed']).default('all')
        })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const allKeys = await kvList(c)
        // v0.2.0: scan ALL character:* keys, not just livestock/prisoner
        const characterKeys = allKeys.filter(k => k.startsWith('character:'))

        const timelines: Array<any> = []
        for (const key of characterKeys) {
          const raw = await kvGet(c, key)
          if (!raw) continue
          const { text } = parseKvEntry(raw)
          const info = extractConsumptionInfo(text)

          // Skip characters with no timeline (predators, ascended staff, etc.)
          if (!info.timeline_remaining) continue

          if (parsed.data.status_filter !== 'all') {
            const tl = info.timeline_remaining.toLowerCase()
            if (parsed.data.status_filter === 'imminent' && !tl.includes('hour') && !/\b1\s*day\b/.test(tl)) continue
            if (parsed.data.status_filter === 'days-to-weeks' && !tl.includes('day') && !tl.includes('week')) continue
            if (parsed.data.status_filter === 'weeks-to-months' && !tl.includes('week') && !tl.includes('month') && !tl.includes('year')) continue
            if (parsed.data.status_filter === 'consumed' && !tl.includes('consumed')) continue
          }

          timelines.push({
            character_key: key,
            current_status: info.status,
            timeline_remaining: info.timeline_remaining,
            processor: info.processor,
            location: 'unknown'
          })
        }

        const text = timelines.length > 0
          ? timelines.map(t => `${t.character_key}: ${t.timeline_remaining}`).join('\n')
          : 'No consumption timelines found.'

        return c.json(makeResult(id, {
          content: [{ type: 'text', text }],
          metadata: { count: timelines.length },
          timelines
        }), 200)
      }

      if (toolName === 'list_active_threads') {
        const raw = await kvGet(c, 'system:active-narratives')

        if (!raw) {
          return c.json(makeResult(id, {
            content: [{ type: 'text', text: 'No active narratives found.' }],
            threads: [], metadata: { count: 0 }
          }), 200)
        }

        const { text } = parseKvEntry(raw)
        const threads = extractActiveThreads(text)
        const summaryText = threads.length > 0
          ? threads.map(v => `${v.thread_name}: ${v.status}`).join('\n')
          : 'No active threads found.'

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: summaryText }],
          metadata: { count: threads.length },
          threads
        }), 200)
      }

      if (toolName === 'increment_topic_field') {
        const schema = z.object({
          key: z.string().min(1),
          field_path: z.string().min(1),
          increment: z.number().default(1),
          reason: z.string().default('system-update')
        })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const key = parsed.data.key.trim().toLowerCase()
        const raw = await kvGet(c, key)
        if (!raw) return c.json(makeError(id, -32602, `Topic "${key}" not found`, null), 200)

        const { text, meta } = parseKvEntry(raw)
        const currentValue = extractFieldFromText(text, parsed.data.field_path)

        if (typeof currentValue !== 'number') {
          return c.json(makeError(id, -32602, `Field "${parsed.data.field_path}" is not numeric`, { current: currentValue }), 200)
        }

        const newValue = currentValue + parsed.data.increment
        const updatedText = updateFieldInText(text, parsed.data.field_path, newValue)

        await pushHistory(c, key, raw)

        const now = new Date().toISOString()
        const version = typeof meta.version === 'number' ? meta.version + 1 : 1

        const payload = JSON.stringify({
          text: updatedText,
          meta: {
            version,
            updatedAt: now,
            createdAt: meta.createdAt ?? now,
            lastIncrementReason: parsed.data.reason,
            lastIncrementValue: parsed.data.increment
          }
        })

        await kvPut(c, key, payload)
        loreDB[key] = updatedText

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: `Incremented ${parsed.data.field_path} from ${currentValue} to ${newValue} (reason: ${parsed.data.reason})` }],
          metadata: { key, version, field_path: parsed.data.field_path, old_value: currentValue, new_value: newValue }
        }), 200)
      }

      if (toolName === 'validate_topic_exists') {
        const schema = z.object({ query_string: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const allKeys = await kvList(c)
        const query = parsed.data.query_string.trim().toLowerCase()

        if (allKeys.includes(query)) {
          return c.json(makeResult(id, {
            content: [{ type: 'text', text: `Found: ${query}` }],
            exists: true, exact_match: query, namespace_matches: [], suggestion: query
          }), 200)
        }

        const suggestions = allKeys.filter(k => k.includes(query))
        if (suggestions.length > 0) {
          return c.json(makeResult(id, {
            content: [{ type: 'text', text: `No exact match for "${query}", but found: ${suggestions.join(', ')}` }],
            exists: false, exact_match: null, namespace_matches: suggestions, suggestion: suggestions[0] || null
          }), 200)
        }

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: `No lore found matching "${query}".` }],
          exists: false, exact_match: null, namespace_matches: [], suggestion: null
        }), 200)
      }

      if (toolName === 'search_lore') {
        const schema = z.object({
          query: z.string().min(1),
          max_results: z.number().min(1).max(50).default(10)
        })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const searchQuery = parsed.data.query.toLowerCase()
        const allKeys = await kvList(c)
        const results: Array<{ key: string; excerpt: string }> = []

        for (const key of allKeys) {
          if (results.length >= parsed.data.max_results) break
          const raw = await kvGet(c, key)
          if (!raw) continue
          const { text } = parseKvEntry(raw)
          const lowerText = text.toLowerCase()
          const idx = lowerText.indexOf(searchQuery)
          if (idx === -1) continue

          // Extract ~80 chars around the first match for context
          const start = Math.max(0, idx - 30)
          const end = Math.min(text.length, idx + searchQuery.length + 50)
          let excerpt = text.slice(start, end)
          if (start > 0) excerpt = '…' + excerpt
          if (end < text.length) excerpt = excerpt + '…'

          results.push({ key, excerpt })
        }

        const summaryText = results.length > 0
          ? results.map(r => `${r.key}: "${r.excerpt}"`).join('\n')
          : `No lore entries matching "${parsed.data.query}".`

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: summaryText }],
          metadata: { query: parsed.data.query, match_count: results.length },
          results
        }), 200)
      }

      if (toolName === 'patch_lore') {
        const schema = z.object({
          key: z.string().min(1),
          operation: z.string().min(1),
          target: z.string().optional(),
          value: z.string().optional()
        })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const key = parsed.data.key.trim().toLowerCase()
        const operation = parsed.data.operation
        const target = parsed.data.target
        const value = parsed.data.value

        if (!['replace', 'append', 'delete_field'].includes(operation)) {
          return c.json(makeResult(id, {
            content: [{ type: 'text', text: `Unknown operation "${operation}". Use replace, append, or delete_field.` }]
          }), 200)
        }

        if ((operation === 'replace' || operation === 'delete_field') && target === undefined) {
          return c.json(makeResult(id, { content: [{ type: 'text', text: `Parameter "target" required for ${operation}.` }] }), 200)
        }
        if (operation === 'replace' && value === undefined) {
          return c.json(makeResult(id, { content: [{ type: 'text', text: 'Parameter "value" required for replace.' }] }), 200)
        }
        if (operation === 'append' && value === undefined) {
          return c.json(makeResult(id, { content: [{ type: 'text', text: 'Parameter "value" required for append.' }] }), 200)
        }

        const raw = await kvGet(c, key)
        if (!raw) {
          return c.json(makeResult(id, { content: [{ type: 'text', text: `Key "${key}" not found. Check list_topics.` }] }), 200)
        }

        const { text, meta } = parseKvEntry(raw)

        let updatedText: string
        let successMessage: string

        if (operation === 'replace') {
          const count = countOccurrences(text, target!)
          if (count === 0) return c.json(makeResult(id, { content: [{ type: 'text', text: `Target "${target}" not found in "${key}".` }] }), 200)
          if (count > 1) return c.json(makeResult(id, { content: [{ type: 'text', text: `Ambiguous: target "${target}" matches ${count} times in "${key}". Use a longer or more specific target string.` }] }), 200)
          const idx = text.indexOf(target!)
          updatedText = text.slice(0, idx) + value! + text.slice(idx + target!.length)
          successMessage = `Replaced 1 occurrence of "${target}" in "${key}".`

        } else if (operation === 'append') {
          if (target !== undefined) {
            const count = countOccurrences(text, target)
            if (count === 0) return c.json(makeResult(id, { content: [{ type: 'text', text: `Target "${target}" not found in "${key}".` }] }), 200)
            if (count > 1) return c.json(makeResult(id, { content: [{ type: 'text', text: `Ambiguous: target "${target}" matches ${count} times in "${key}". Use a longer or more specific target string.` }] }), 200)
            const idx = text.indexOf(target)
            updatedText = text.slice(0, idx + target.length) + value! + text.slice(idx + target.length)
            successMessage = `Appended after "${target}" in "${key}".`
          } else {
            const needsSeparator = !text.endsWith('\n') && !value!.startsWith('\n')
            updatedText = text + (needsSeparator ? '\n' : '') + value!
            successMessage = `Appended to end of "${key}".`
          }

        } else { // delete_field
          const count = countOccurrences(text, target!)
          if (count === 0) return c.json(makeResult(id, { content: [{ type: 'text', text: `Target "${target}" not found in "${key}".` }] }), 200)
          if (count > 1) return c.json(makeResult(id, { content: [{ type: 'text', text: `Ambiguous: target "${target}" matches ${count} times in "${key}". Use a longer or more specific target string.` }] }), 200)
          const idx = text.indexOf(target!)
          updatedText = (text.slice(0, idx) + text.slice(idx + target!.length)).replace(/\n{2,}/g, '\n')
          successMessage = value !== undefined
            ? `Deleted 1 occurrence of "${target}" from "${key}". (Note: "value" parameter is ignored for delete_field.)`
            : `Deleted 1 occurrence of "${target}" from "${key}".`
        }

        await pushHistory(c, key, raw)

        const now = new Date().toISOString()
        const version = typeof meta.version === 'number' ? meta.version + 1 : 1

        const payload = JSON.stringify({
          text: updatedText,
          meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now }
        })

        await kvPut(c, key, payload)
        loreDB[key] = updatedText

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: successMessage }],
          metadata: { key, version }
        }), 200)
      }

      if (toolName === 'batch_set_lore') {
        const schema = z.object({
          entries: z.array(z.object({ key: z.string().min(1), text: z.string().min(1) })).min(1)
        })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const now = new Date().toISOString()
        const batchResults: Record<string, { ok: boolean; version?: number; error?: string }> = {}

        const cleanedEntries = parsed.data.entries.map(e => ({ ...e, key: e.key.trim().toLowerCase() }))

        const rawValues = await Promise.all(cleanedEntries.map(e => kvGet(c, e.key)))

        await Promise.all(cleanedEntries.map((e, i) =>
          rawValues[i] ? pushHistory(c, e.key, rawValues[i]!) : Promise.resolve()
        ))

        await Promise.all(cleanedEntries.map(async (e, i) => {
          const existingMeta = rawValues[i] ? parseKvEntry(rawValues[i]!).meta : {}
          const version = typeof existingMeta.version === 'number' ? existingMeta.version + 1 : 1
          const payload = JSON.stringify({
            text: e.text,
            meta: { version, updatedAt: now, createdAt: existingMeta.createdAt ?? now }
          })
          try {
            await kvPut(c, e.key, payload)
            loreDB[e.key] = e.text
            batchResults[e.key] = { ok: true, version }
          } catch (err) {
            batchResults[e.key] = { ok: false, error: String(err) }
          }
        }))

        const okCount = Object.values(batchResults).filter(r => r.ok).length
        const failCount = cleanedEntries.length - okCount
        const summaryText = failCount === 0
          ? `Saved ${okCount} lore entr${okCount === 1 ? 'y' : 'ies'}.`
          : `Saved ${okCount}/${cleanedEntries.length} entries. ${failCount} failed — see results.`

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: summaryText }],
          metadata: { total: cleanedEntries.length, set_count: okCount, failed_count: failCount },
          results: batchResults
        }), 200)
      }

      if (toolName === 'batch_mutate') {
        const mutationSchema = z.object({
          key: z.string().min(1),
          action: z.enum(['increment', 'patch']),
          field_path: z.string().optional(),
          increment: z.number().int().optional(),
          reason: z.string().optional(),
          operation: z.enum(['replace', 'append', 'delete_field']).optional(),
          target: z.string().optional(),
          value: z.string().optional(),
        })
        const schema = z.object({ mutations: z.array(mutationSchema).min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const now = new Date().toISOString()
        const mutationResults: Array<{ key: string; action: string; ok: boolean; message: string; old_value?: any; new_value?: any }> = []

        for (const mut of parsed.data.mutations) {
          const key = mut.key.trim().toLowerCase()
          const raw = await kvGet(c, key)

          if (!raw) {
            mutationResults.push({ key, action: mut.action, ok: false, message: `Key "${key}" not found.` })
            continue
          }

          const { text, meta } = parseKvEntry(raw)

          if (mut.action === 'increment') {
            if (!mut.field_path) {
              mutationResults.push({ key, action: 'increment', ok: false, message: 'field_path required for increment.' })
              continue
            }
            const currentValue = extractFieldFromText(text, mut.field_path)
            if (typeof currentValue !== 'number') {
              mutationResults.push({ key, action: 'increment', ok: false, message: `Field "${mut.field_path}" is not numeric.`, old_value: currentValue })
              continue
            }
            const delta = mut.increment ?? 1
            const newValue = currentValue + delta
            const updatedText = updateFieldInText(text, mut.field_path, newValue)
            await pushHistory(c, key, raw)
            const version = typeof meta.version === 'number' ? meta.version + 1 : 1
            await kvPut(c, key, JSON.stringify({
              text: updatedText,
              meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now, lastIncrementReason: mut.reason ?? 'batch-mutate', lastIncrementValue: delta }
            }))
            loreDB[key] = updatedText
            mutationResults.push({ key, action: 'increment', ok: true, message: `${mut.field_path}: ${currentValue} → ${newValue}`, old_value: currentValue, new_value: newValue })

          } else { // patch
            if (!mut.operation) {
              mutationResults.push({ key, action: 'patch', ok: false, message: 'operation required for patch.' })
              continue
            }
            const op = mut.operation
            const target = mut.target
            const value = mut.value

            if ((op === 'replace' || op === 'delete_field') && !target) {
              mutationResults.push({ key, action: 'patch', ok: false, message: `target required for ${op}.` })
              continue
            }
            if ((op === 'replace' || op === 'append') && value === undefined) {
              mutationResults.push({ key, action: 'patch', ok: false, message: `value required for ${op}.` })
              continue
            }

            let updatedText: string
            let msg: string

            if (op === 'replace') {
              const count = countOccurrences(text, target!)
              if (count === 0) { mutationResults.push({ key, action: 'patch:replace', ok: false, message: `Target "${target}" not found in "${key}".` }); continue }
              if (count > 1) { mutationResults.push({ key, action: 'patch:replace', ok: false, message: `Target "${target}" ambiguous (${count} matches) in "${key}".` }); continue }
              const idx = text.indexOf(target!)
              updatedText = text.slice(0, idx) + value! + text.slice(idx + target!.length)
              msg = `Replaced "${target}" in "${key}".`
            } else if (op === 'append') {
              if (target !== undefined) {
                const count = countOccurrences(text, target)
                if (count === 0) { mutationResults.push({ key, action: 'patch:append', ok: false, message: `Target "${target}" not found in "${key}".` }); continue }
                if (count > 1) { mutationResults.push({ key, action: 'patch:append', ok: false, message: `Target "${target}" ambiguous (${count} matches) in "${key}".` }); continue }
                const idx = text.indexOf(target)
                updatedText = text.slice(0, idx + target.length) + value! + text.slice(idx + target.length)
                msg = `Appended after "${target}" in "${key}".`
              } else {
                updatedText = text + (!text.endsWith('\n') && !value!.startsWith('\n') ? '\n' : '') + value!
                msg = `Appended to end of "${key}".`
              }
            } else { // delete_field
              const count = countOccurrences(text, target!)
              if (count === 0) { mutationResults.push({ key, action: 'patch:delete_field', ok: false, message: `Target "${target}" not found in "${key}".` }); continue }
              if (count > 1) { mutationResults.push({ key, action: 'patch:delete_field', ok: false, message: `Target "${target}" ambiguous (${count} matches) in "${key}".` }); continue }
              const idx = text.indexOf(target!)
              updatedText = (text.slice(0, idx) + text.slice(idx + target!.length)).replace(/\n{2,}/g, '\n')
              msg = `Deleted "${target}" from "${key}".`
            }

            await pushHistory(c, key, raw)
            const version = typeof meta.version === 'number' ? meta.version + 1 : 1
            await kvPut(c, key, JSON.stringify({ text: updatedText, meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now } }))
            loreDB[key] = updatedText
            mutationResults.push({ key, action: `patch:${op}`, ok: true, message: msg })
          }
        }

        const okCount = mutationResults.filter(r => r.ok).length
        const failCount = mutationResults.length - okCount
        const summaryText = failCount === 0
          ? `Applied ${okCount} mutation${okCount === 1 ? '' : 's'}.`
          : `Applied ${okCount}/${mutationResults.length} mutations. ${failCount} failed — see results.`

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: summaryText }],
          metadata: { total: mutationResults.length, ok_count: okCount, failed_count: failCount },
          results: mutationResults
        }), 200)
      }

      if (toolName === 'restore_lore') {
        const schema = z.object({ key: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const key = parsed.data.key.trim().toLowerCase()
        const kv = getKV(c)
        if (!kv) return c.json(makeError(id, -32603, 'KV not available', null), 200)

        const historyKey = `_history:${key}`
        let history: string[] = []
        try {
          const existing = await kv.get(historyKey)
          if (existing) history = JSON.parse(existing)
        } catch {
          return c.json(makeError(id, -32603, 'Failed to read history', null), 200)
        }

        if (history.length === 0) {
          return c.json(makeResult(id, {
            content: [{ type: 'text', text: `No history found for "${key}".` }],
            metadata: { key, restored: false }
          }), 200)
        }

        const previous = history.shift()!
        await kv.put(key, previous)
        loreDB[key] = parseKvEntry(previous).text

        if (history.length > 0) {
          await kv.put(historyKey, JSON.stringify(history))
        } else {
          await kv.delete(historyKey)
        }

        const { meta } = parseKvEntry(previous)
        return c.json(makeResult(id, {
          content: [{ type: 'text', text: `Restored "${key}" to v${meta.version ?? '?'}. ${history.length} snapshot(s) remaining.` }],
          metadata: { key, restored: true, restored_version: meta.version ?? null, remaining_history: history.length }
        }), 200)
      }

      return c.json(makeError(id, -32601, `Method not found: tool "${toolName}"`), 200)
    }

    // ── Legacy bare-method handlers (pre-tools/call clients) ──────────────────
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

    return c.json(makeError(id, -32601, `Method not found: ${method}`), 200)

  } catch (e) {
    console.error('Unhandled exception in MCP handler', e)
    return c.json(makeError(null, -32603, 'Internal error', { message: String(e) }), 200)
  }
})

// ── Admin routes ──────────────────────────────────────────────────────────────

app.post('/admin/set-lore', async (c) => {
  try {
    const body = await c.req.json()
    const key = (body?.key ?? '').toString().trim().toLowerCase()
    const text = (body?.text ?? '').toString()
    const secret = (body?.secret ?? '').toString()

    if (!key || !text) return c.json({ ok: false, error: 'missing key or text' }, 400)

    const ADMIN_SECRET = (c.env as any)?.ADMIN_SECRET
    if (!ADMIN_SECRET || secret !== ADMIN_SECRET)
      return c.json({ ok: false, error: 'unauthorized' }, 401)

    const existingRaw = await kvGet(c, key)
    const existingMeta = existingRaw ? parseKvEntry(existingRaw).meta : {}

    if (existingRaw) await pushHistory(c, key, existingRaw)

    const now = new Date().toISOString()
    const version = typeof existingMeta.version === 'number' ? existingMeta.version + 1 : 1

    const payload = JSON.stringify({
      text,
      meta: { version, updatedAt: now, createdAt: existingMeta.createdAt ?? now },
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
    const key = (body?.key ?? '').toString().trim().toLowerCase()
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
