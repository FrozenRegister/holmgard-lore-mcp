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
      const keys: string[] = []
      let cursor: string | undefined
      do {
        const listed: any = await kv.list(cursor ? { cursor } : undefined)
        for (const k of listed.keys) {
          if (!k.name.startsWith('_history:')) keys.push(k.name)
        }
        cursor = listed.list_complete ? undefined : listed.cursor
      } while (cursor)
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

// Reads a field value from lore text. Handles three formats:
//   1. Markdown bold: **Field:** val  or  - **Field (desc):** val
//   2. JSON block:    "Field": 0.9,
//   3. Loose:         Field: 0.9  or  Field=0.9
function extractFieldFromText(text: string, fieldPath: string): unknown {
  try {
    const escapedField = fieldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    // Pass 1: markdown bold (optional bullet + optional parenthetical descriptor)
    const mdRegex = new RegExp(
      `^\\s*(?:-\\s+)?\\*\\*${escapedField}(?:\\s*\\([^)]*\\))?:\\*\\*\\s*(.+?)\\s*$`,
      'im'
    )
    const mdMatch = text.match(mdRegex)
    if (mdMatch) {
      const value = mdMatch[1].trim()
      const numMatch = value.match(/^-?\d+(?:\.\d+)?/)
      if (numMatch) return parseFloat(numMatch[0])
      if (value === 'true') return true
      if (value === 'false') return false
      if (value === 'null') return null
      try { return JSON.parse(value) } catch { /* not JSON */ }
      return value
    }

    // Pass 2: JSON block  "Field": 0.9
    const jsonRegex = new RegExp(`"${escapedField}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, 'i')
    const jsonMatch = text.match(jsonRegex)
    if (jsonMatch) return parseFloat(jsonMatch[1])

    // Pass 3: loose  Field: 0.9  or  Field=0.9
    const looseRegex = new RegExp(`${escapedField}\\s*[:=]\\s*(-?\\d+(?:\\.\\d+)?)`, 'i')
    const looseMatch = text.match(looseRegex)
    if (looseMatch) return parseFloat(looseMatch[1])

  } catch (e) {
    console.warn('extractFieldFromText error', e)
  }
  return null
}

// Replaces a field value in place (surgical slice-replace preserving prefix/format), or appends.
function updateFieldInText(text: string, fieldPath: string, newValue: any): string {
  try {
    const escapedField = fieldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    // Pass 1: markdown bold (optional bullet + optional descriptor)
    const mdRegex = new RegExp(
      `^(\\s*(?:-\\s+)?\\*\\*${escapedField}(?:\\s*\\([^)]*\\))?:\\*\\*\\s*)(.+?)(\\s*)$`,
      'im'
    )
    const mdMatch = text.match(mdRegex)
    if (mdMatch) {
      return (
        text.slice(0, mdMatch.index!) +
        mdMatch[1] +
        String(newValue) +
        mdMatch[3] +
        text.slice(mdMatch.index! + mdMatch[0].length)
      )
    }

    // Pass 2: JSON block  "Field": 0.9
    const jsonRegex = new RegExp(`("${escapedField}"\\s*:\\s*)(-?\\d+(?:\\.\\d+)?)`, 'i')
    const jsonMatch = text.match(jsonRegex)
    if (jsonMatch) {
      return (
        text.slice(0, jsonMatch.index!) +
        jsonMatch[1] +
        String(newValue) +
        text.slice(jsonMatch.index! + jsonMatch[0].length)
      )
    }

    // Pass 3: loose  Field: 0.9  or  Field=0.9
    const looseRegex = new RegExp(`(${escapedField}\\s*[:=]\\s*)(-?\\d+(?:\\.\\d+)?)`, 'i')
    const looseMatch = text.match(looseRegex)
    if (looseMatch) {
      return (
        text.slice(0, looseMatch.index!) +
        looseMatch[1] +
        String(newValue) +
        text.slice(looseMatch.index! + looseMatch[0].length)
      )
    }

    // Fallback: append
    const needsSeparator = !text.endsWith('\n')
    return text + (needsSeparator ? '\n' : '') + `**${fieldPath}:** ${newValue}`

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

// Extracts the raw string value of a field without numeric coercion.
// Handles the same formats as extractFieldFromText pass 1: optional bullet + optional descriptor.
function extractRawField(text: string, fieldPath: string): string | null {
  const escapedField = fieldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = text.match(new RegExp(
    `^\\s*(?:-\\s+)?\\*\\*${escapedField}(?:\\s*\\([^)]*\\))?:\\*\\*\\s*(.+?)\\s*$`,
    'im'
  ))
  return match ? match[1].trim() : null
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
          },
          {
            name: 'resolve_interaction', title: 'Resolve Interaction', version: '0.1.1',
            description: 'Determine the outcome of an entity interaction via weighted probability. Reads a numeric Weight-1 field from entity_a and a numeric Weight-2 field from entity_b (field may appear as plain "**Weight-1:** 0.9", bulleted "- **Weight-1 (descriptor):** 0.9", or JSON block format). Computes P(success) = (W1×0.7)−(W2×0.3), clamps to [0,1], rolls against it, and returns a boolean outcome with delta_value. If successful and entity_a has a numeric State-Level field, increments it by delta_value.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                entity_a_id: { type: 'string', description: 'Lore key of the acting entity — must have a numeric Weight-1 field', minLength: 1 },
                entity_b_id: { type: 'string', description: 'Lore key of the opposing entity — must have a numeric Weight-2 field', minLength: 1 },
                action_type: { type: 'string', description: 'Label for the action being attempted (e.g. "consume", "resist", "hunt")', minLength: 1 }
              },
              required: ['entity_a_id', 'entity_b_id', 'action_type'], additionalProperties: false
            },
            examples: [{ arguments: { entity_a_id: 'character:predator', entity_b_id: 'character:prey', action_type: 'consume' } }]
          },
          {
            name: 'analyze_utility', title: 'Analyze Utility', version: '2.0.0',
            description: 'Quantify an entity\'s suitability for a specific Fernveil narrative pathway. Scans ALL numeric lore fields, applies vector-specific weighting with proportional redistribution for missing fields, and returns a per-field breakdown, composite score (0–100), grade (S/A/B/C/D/F), and projected yield narrative.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                entity_id: { type: 'string', description: 'Lore key of the entity to analyse', minLength: 1 },
                utility_vector: {
                  type: 'string',
                  enum: ['GASTRIC', 'BUTCHERY', 'INCUBATION', 'SCULPTURE', 'PARASITISM', 'THRALL', 'DISTRIBUTED'],
                  description: 'Narrative pathway: GASTRIC=prolonged internal processing, BUTCHERY=harvest yield, INCUBATION=brood hosting, SCULPTURE=living artwork, PARASITISM=neural hijack, THRALL=permanent conditioning, DISTRIBUTED=industrial output'
                },
                entity_role: {
                  type: 'string',
                  enum: ['subject', 'actor'],
                  default: 'subject',
                  description: '"subject" evaluates prey-oriented fields; "actor" evaluates predator-drive fields (Weight-1, Aggression, Hunger, etc.)'
                }
              },
              required: ['entity_id', 'utility_vector'], additionalProperties: false
            },
            examples: [{ arguments: { entity_id: 'character:target', utility_vector: 'GASTRIC' } }]
          },
          {
            name: 'map_integration', title: 'Map Integration', version: '0.1.0',
            description: 'Permanently transfer [Transferable]-tagged traits from a source entity to a target entity on a state-merge event. integration_depth (0.0–1.0) controls the fraction of available traits transferred.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                source_id: { type: 'string', description: 'Lore key of the source entity (traits are read from here)', minLength: 1 },
                target_id: { type: 'string', description: 'Lore key of the target entity (traits are written here)', minLength: 1 },
                integration_depth: { type: 'number', minimum: 0, maximum: 1, description: 'Fraction of Transferable traits to integrate (0.0 = none, 1.0 = all)' }
              },
              required: ['source_id', 'target_id', 'integration_depth'], additionalProperties: false
            },
            examples: [{ arguments: { source_id: 'character:donor', target_id: 'character:recipient', integration_depth: 0.75 } }]
          },
          {
            name: 'thread_tick', title: 'Thread Tick', version: '0.1.0',
            description: 'Advance a named timeline thread by one tick. Decrements the **Timeline-Value:** field on every entity whose lore contains **Thread:** <thread_id>. Then performs a global sync: finds entities on other threads that share a Current-Date with the ticked entities and returns their status.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                thread_id: { type: 'string', description: 'Thread identifier matching the **Thread:** field in entity lore', minLength: 1 }
              },
              required: ['thread_id'], additionalProperties: false
            },
            examples: [{ arguments: { thread_id: 'thread-alpha' } }]
          },
          {
            name: 'get_relationship', title: 'Get Relationship', version: '0.1.0',
            description: 'Scan two entity lore entries for relationship fields (Affinity, Debt, Threat-Level, Faction) and bidirectional cross-references. Returns structured relationship data, or null with a creation suggestion if no data exists.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                entity_a: { type: 'string', description: 'Lore key of the first entity', minLength: 1 },
                entity_b: { type: 'string', description: 'Lore key of the second entity', minLength: 1 }
              },
              required: ['entity_a', 'entity_b'], additionalProperties: false
            },
            examples: [{ arguments: { entity_a: 'character:alice', entity_b: 'character:bob' } }]
          },
          {
            name: 'get_faction_standing', title: 'Get Faction Standing', version: '0.1.0',
            description: 'Query an entity\'s standing within a faction: membership status, rank, reputation score, outstanding obligations, and current threat-level. Reads both entity and faction entries.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                entity_key: { type: 'string', description: 'Lore key of the entity', minLength: 1 },
                faction_key: { type: 'string', description: 'Lore key of the faction', minLength: 1 }
              },
              required: ['entity_key', 'faction_key'], additionalProperties: false
            },
            examples: [{ arguments: { entity_key: 'character:alice', faction_key: 'faction:guild' } }]
          },
          {
            name: 'get_entity_knowledge', title: 'Get Entity Knowledge', version: '0.1.0',
            description: 'Return what one entity canonically knows about a topic. Checks Knows/Knowledge/Awareness fields on the entity entry. Critical for preventing narrator from having entities reference things they should not know.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                entity_key: { type: 'string', description: 'Lore key of the querying entity', minLength: 1 },
                topic: { type: 'string', description: 'Topic to check knowledge of (entity key, event name, or keyword)', minLength: 1 }
              },
              required: ['entity_key', 'topic'], additionalProperties: false
            },
            examples: [{ arguments: { entity_key: 'character:scout', topic: 'location:hidden-base' } }]
          },
          {
            name: 'get_location_occupants', title: 'Get Location Occupants', version: '0.1.0',
            description: 'Scan all lore entries for a Location field matching the given key. Returns an array of entity keys currently at that location with their status summaries.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                location_key: { type: 'string', description: 'Lore key of the location to scan for occupants', minLength: 1 }
              },
              required: ['location_key'], additionalProperties: false
            },
            examples: [{ arguments: { location_key: 'location:market-square' } }]
          },
          {
            name: 'get_reachable_locations', title: 'Get Reachable Locations', version: '0.1.0',
            description: 'Read an origin location\'s Exits or Connections field and return all reachable location keys with danger level, travel cost, and requirements.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                origin_key: { type: 'string', description: 'Lore key of the origin location', minLength: 1 }
              },
              required: ['origin_key'], additionalProperties: false
            },
            examples: [{ arguments: { origin_key: 'location:town-gate' } }]
          },
          {
            name: 'sense_environment', title: 'Sense Environment', version: '0.1.0',
            description: 'Read location lore and filter environmental details through an entity\'s sensory attributes (Perception, Night-Vision, Tracking). Low Perception hides [hidden]/[concealed] lines and [threat]/[danger] lines below 0.4.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                location_key: { type: 'string', description: 'Lore key of the location to sense', minLength: 1 },
                entity_key: { type: 'string', description: 'Lore key of the sensing entity', minLength: 1 }
              },
              required: ['location_key', 'entity_key'], additionalProperties: false
            },
            examples: [{ arguments: { location_key: 'location:dark-cavern', entity_key: 'character:scout' } }]
          },
          {
            name: 'get_inventory', title: 'Get Inventory', version: '0.1.0',
            description: 'Return a structured inventory from an entity lore entry, parsing the Inventory/Items field into item keys and quantities.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                entity_key: { type: 'string', description: 'Lore key of the entity whose inventory to retrieve', minLength: 1 }
              },
              required: ['entity_key'], additionalProperties: false
            },
            examples: [{ arguments: { entity_key: 'character:merchant' } }]
          },
          {
            name: 'transfer_item', title: 'Transfer Item', version: '0.1.0',
            description: 'Move one or more units of an item between two entity inventories. Validates availability in the source entity, then updates both entries. Inventory format: "item-key×qty, item-key×qty".',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                from_entity: { type: 'string', description: 'Lore key of the entity giving the item', minLength: 1 },
                to_entity: { type: 'string', description: 'Lore key of the entity receiving the item', minLength: 1 },
                item_key: { type: 'string', description: 'Identifier of the item to transfer', minLength: 1 },
                quantity: { type: 'integer', minimum: 1, default: 1, description: 'Number of units to transfer' }
              },
              required: ['from_entity', 'to_entity', 'item_key'], additionalProperties: false
            },
            examples: [{ arguments: { from_entity: 'character:merchant', to_entity: 'character:player', item_key: 'sword', quantity: 1 } }]
          },
          {
            name: 'activate_scene', title: 'Activate Scene', version: '0.1.0',
            description: 'Set a scene as active in system:active-scene and hydrate all related entities and location in a single call. Returns description, present entities, available choices, and previously active scene.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                scene_key: { type: 'string', description: 'Lore key of the scene to activate', minLength: 1 }
              },
              required: ['scene_key'], additionalProperties: false
            },
            examples: [{ arguments: { scene_key: 'scene:tavern-confrontation' } }]
          },
          {
            name: 'present_choices', title: 'Present Choices', version: '0.1.0',
            description: 'Read a scene\'s choice lines (format: "- id: description [requires: item] [min-weight: N]") and filter against an entity\'s current inventory and Weight-1. Returns valid and blocked choices.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                scene_key: { type: 'string', description: 'Lore key of the scene containing the choice tree', minLength: 1 },
                entity_key: { type: 'string', description: 'Lore key of the entity making the choice', minLength: 1 }
              },
              required: ['scene_key', 'entity_key'], additionalProperties: false
            },
            examples: [{ arguments: { scene_key: 'scene:tavern-confrontation', entity_key: 'character:player' } }]
          },
          {
            name: 'commit_choice', title: 'Commit Choice', version: '0.1.0',
            description: 'Apply all consequences of a committed choice lore entry: reads Outcome-Seed, State-Change, and Next-Choices fields, updates entity Status and appends to Choice-History. Returns outcome seed and newly unlocked choices.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                choice_id: { type: 'string', description: 'Lore key of the choice entry (e.g. "choice:accept-quest")', minLength: 1 },
                entity_key: { type: 'string', description: 'Lore key of the entity committing the choice', minLength: 1 }
              },
              required: ['choice_id', 'entity_key'], additionalProperties: false
            },
            examples: [{ arguments: { choice_id: 'choice:accept-quest', entity_key: 'character:player' } }]
          },
          {
            name: 'get_choice_history', title: 'Get Choice History', version: '0.1.0',
            description: 'Return the entity\'s logged path through branching narratives from its Choice-History field, parsed into choice IDs and timestamps.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                entity_key: { type: 'string', description: 'Lore key of the entity whose history to retrieve', minLength: 1 }
              },
              required: ['entity_key'], additionalProperties: false
            },
            examples: [{ arguments: { entity_key: 'character:player' } }]
          },
          {
            name: 'advance_state_stage', title: 'Advance State Stage', version: '0.1.0',
            description: 'Advance an entity to the next stage in its configured state machine. Increments State-Stage, decrements Stage-Timer if present, and returns the new stage, remaining stages, and Stage-N-Description for narrator use.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                entity_key: { type: 'string', description: 'Lore key of the entity to advance', minLength: 1 }
              },
              required: ['entity_key'], additionalProperties: false
            },
            examples: [{ arguments: { entity_key: 'character:transforming-entity' } }]
          },
          {
            name: 'process_stage_batch', title: 'Process Stage Batch', version: '0.1.0',
            description: 'Tick ALL entities at a given location that have a State-Stage field. Skips entities already at terminal stage. Returns an array of stage changes and a list of skipped entities.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                location_key: { type: 'string', description: 'Lore key of the location whose entities to advance', minLength: 1 }
              },
              required: ['location_key'], additionalProperties: false
            },
            examples: [{ arguments: { location_key: 'location:processing-chamber' } }]
          },
          {
            name: 'generate_entity', title: 'Generate Entity', version: '0.1.0',
            description: 'Create a new entity instance from a named archetype lore entry. Populates fields from the template, applies location modifier (danger-level → Weight-1 boost), and persists to a timestamped key.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                archetype_key: { type: 'string', description: 'Lore key of the archetype template (e.g. "archetype:guard")', minLength: 1 },
                location_key: { type: 'string', description: 'Optional lore key of the spawn location', minLength: 1 }
              },
              required: ['archetype_key'], additionalProperties: false
            },
            examples: [{ arguments: { archetype_key: 'archetype:guard', location_key: 'location:market-square' } }]
          },
          {
            name: 'roll_encounter', title: 'Roll Encounter', version: '0.1.0',
            description: 'Read a location\'s Encounter-Table field ("archetype:weight, archetype:weight"), roll against a threat_level modifier, and return a generated entity instance at that location.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                location_key: { type: 'string', description: 'Lore key of the location with an Encounter-Table field', minLength: 1 },
                threat_level: { type: 'integer', minimum: 1, maximum: 10, default: 5, description: 'Threat modifier (1=trivial, 10=extreme). Biases rolls toward higher-weight entries.' }
              },
              required: ['location_key'], additionalProperties: false
            },
            examples: [{ arguments: { location_key: 'location:dark-forest', threat_level: 7 } }]
          },
          {
            name: 'get_thread_comparison', title: 'Get Thread Comparison', version: '0.1.0',
            description: 'Compare two named timeline threads: return entity counts, average Timeline-Value per thread, timeline offset, and overlap of shared Current-Date and Location values.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                thread_a: { type: 'string', description: 'Identifier of the first timeline thread', minLength: 1 },
                thread_b: { type: 'string', description: 'Identifier of the second timeline thread', minLength: 1 }
              },
              required: ['thread_a', 'thread_b'], additionalProperties: false
            },
            examples: [{ arguments: { thread_a: 'thread-alpha', thread_b: 'thread-beta' } }]
          },
          {
            name: 'check_convergence', title: 'Check Convergence', version: '0.1.0',
            description: 'Determine whether two timeline threads can intersect by checking for shared Current-Date or Location values across their entities. Returns boolean can_converge with framing text and overlap lists.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                thread_a: { type: 'string', description: 'Identifier of the first timeline thread', minLength: 1 },
                thread_b: { type: 'string', description: 'Identifier of the second timeline thread', minLength: 1 }
              },
              required: ['thread_a', 'thread_b'], additionalProperties: false
            },
            examples: [{ arguments: { thread_a: 'thread-alpha', thread_b: 'thread-beta' } }]
          },
          {
            name: 'get_sensory_profile', title: 'Get Sensory Profile', version: '0.1.0',
            description: 'Return structured sensory data for an entity: temperature, scent, texture, sound signature, and visual descriptors. Reads entity fields first, then falls back to the species/type lore entry.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                entity_key: { type: 'string', description: 'Lore key of the entity to profile', minLength: 1 }
              },
              required: ['entity_key'], additionalProperties: false
            },
            examples: [{ arguments: { entity_key: 'character:hunter' } }]
          },
          {
            name: 'get_compatibility', title: 'Get Compatibility', version: '0.1.0',
            description: 'Check whether two entities can interact via a given interaction type. Validates size ratio (Size field), Weight-1/Weight-2 thresholds, and environment overlap. Returns boolean compatible, constraints list, and risk level.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                entity_a: { type: 'string', description: 'Lore key of the first entity (typically the acting entity)', minLength: 1 },
                entity_b: { type: 'string', description: 'Lore key of the second entity (typically the target)', minLength: 1 },
                interaction_type: { type: 'string', description: 'Label for the interaction being checked (e.g. "consume", "carry", "trade", "merge")', minLength: 1 }
              },
              required: ['entity_a', 'entity_b', 'interaction_type'], additionalProperties: false
            },
            examples: [{ arguments: { entity_a: 'character:predator', entity_b: 'character:prey', interaction_type: 'consume' } }]
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

        const newValue = parseFloat((currentValue + parsed.data.increment).toPrecision(10))
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
            const newValue = parseFloat((currentValue + delta).toPrecision(10))
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

      if (toolName === 'resolve_interaction') {
        const schema = z.object({
          entity_a_id: z.string().min(1),
          entity_b_id: z.string().min(1),
          action_type: z.string().min(1),
        })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const keyA = parsed.data.entity_a_id.trim().toLowerCase()
        const keyB = parsed.data.entity_b_id.trim().toLowerCase()
        const actionType = parsed.data.action_type

        const [rawA, rawB] = await Promise.all([kvGet(c, keyA), kvGet(c, keyB)])
        if (!rawA) return c.json(makeError(id, -32602, `Entity "${keyA}" not found`, null), 200)
        if (!rawB) return c.json(makeError(id, -32602, `Entity "${keyB}" not found`, null), 200)

        const { text: textA, meta: metaA } = parseKvEntry(rawA)
        const { text: textB } = parseKvEntry(rawB)

        console.log('[resolve_interaction] textA field sample:', textA.match(/(Weight-1)[^\n]*/i)?.[0] ?? 'NO MATCH')
        console.log('[resolve_interaction] textB field sample:', textB.match(/(Weight-2)[^\n]*/i)?.[0] ?? 'NO MATCH')

        const w1Raw = extractFieldFromText(textA, 'Weight-1')
        const w2Raw = extractFieldFromText(textB, 'Weight-2')

        console.log('[resolve_interaction] w1Raw:', w1Raw, 'w2Raw:', w2Raw)

        if (typeof w1Raw !== 'number') return c.json(makeError(id, -32602, `Entity "${keyA}" missing numeric **Weight-1:** field (got: ${JSON.stringify(w1Raw)})`, null), 200)
        if (typeof w2Raw !== 'number') return c.json(makeError(id, -32602, `Entity "${keyB}" missing numeric **Weight-2:** field (got: ${JSON.stringify(w2Raw)})`, null), 200)

        const probability = Math.max(0, Math.min(1, (w1Raw * 0.7) - (w2Raw * 0.3)))
        const roll = Math.random()
        const success = roll < probability
        const delta_value = success ? Math.max(1, Math.round(probability * 10)) : 0

        if (success && delta_value > 0) {
          const currentStateLevel = extractFieldFromText(textA, 'State-Level')
          if (typeof currentStateLevel === 'number') {
            const updatedTextA = updateFieldInText(textA, 'State-Level', currentStateLevel + delta_value)
            await pushHistory(c, keyA, rawA)
            const now = new Date().toISOString()
            const version = typeof metaA.version === 'number' ? metaA.version + 1 : 1
            await kvPut(c, keyA, JSON.stringify({
              text: updatedTextA,
              meta: { version, updatedAt: now, createdAt: metaA.createdAt ?? now, lastAction: actionType }
            }))
            loreDB[keyA] = updatedTextA
          }
        }

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: `${actionType}: ${success ? 'SUCCESS' : 'FAILURE'} (roll ${roll.toFixed(3)} vs P=${probability.toFixed(3)}) — delta_value: ${delta_value}` }],
          metadata: { entity_a_id: keyA, entity_b_id: keyB, action_type: actionType, weight_1: w1Raw, weight_2: w2Raw, probability: Math.round(probability * 1000) / 1000, roll: Math.round(roll * 1000) / 1000 },
          success,
          delta_value
        }), 200)
      }

      if (toolName === 'analyze_utility') {
        const schema = z.object({
          entity_id: z.string().min(1),
          utility_vector: z.enum(['GASTRIC', 'BUTCHERY', 'INCUBATION', 'SCULPTURE', 'PARASITISM', 'THRALL', 'DISTRIBUTED']),
          entity_role: z.enum(['subject', 'actor']).default('subject'),
        })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const key = parsed.data.entity_id.trim().toLowerCase()
        const vector = parsed.data.utility_vector
        const entityRole = parsed.data.entity_role

        const raw = await kvGet(c, key)
        if (!raw) return c.json(makeError(id, -32602, `Entity "${key}" not found`, null), 200)

        const { text } = parseKvEntry(raw)

        // Scan ALL numeric fields — no early exit
        type ParsedField = { originalName: string; value: number }
        const parsedFields = new Map<string, ParsedField>()
        // Allow comma-formatted integers (e.g. "135,000 kcal") — commas stripped before parse
        const fieldScanRegex = /\*\*([^*\n]+?):\*\*\s*([\d,]+\.?\d*)/g
        let fMatch: RegExpExecArray | null
        while ((fMatch = fieldScanRegex.exec(text)) !== null) {
          const originalName = fMatch[1].trim()
          const normalizedKey = originalName.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase()
          if (!parsedFields.has(normalizedKey)) {
            parsedFields.set(normalizedKey, { originalName, value: parseFloat(fMatch[2].replace(/,/g, '')) })
          }
        }

        type FieldWeight = { field: string; weight: number; inverted?: boolean }

        const SUBJECT_VECTORS: Record<string, FieldWeight[]> = {
          GASTRIC: [
            { field: 'tenderness-index', weight: 0.25 },
            { field: 'fat-marbling-index', weight: 0.20 },
            { field: 'sensory-receptivity', weight: 0.20 },
            { field: 'weight-2', weight: 0.15 },
            { field: 'compliance-potential', weight: 0.10 },
            { field: 'cortisol-level', weight: 0.10, inverted: true },
          ],
          BUTCHERY: [
            { field: 'caloric-yield-estimate', weight: 0.30 },
            { field: 'fat-marbling-index', weight: 0.25 },
            { field: 'tenderness-index', weight: 0.15 },
            { field: 'cortisol-level', weight: 0.15, inverted: true },
            { field: 'weight-2', weight: 0.10 },
            { field: 'sensory-receptivity', weight: 0.05 },
          ],
          INCUBATION: [
            { field: 'compliance-potential', weight: 0.25 },
            { field: 'weight-2', weight: 0.20 },
            { field: 'fat-marbling-index', weight: 0.15 },
            { field: 'cortisol-level', weight: 0.15, inverted: true },
            { field: 'sensory-receptivity', weight: 0.15 },
            { field: 'tenderness-index', weight: 0.10 },
          ],
          SCULPTURE: [
            { field: 'sensory-receptivity', weight: 0.30 },
            { field: 'compliance-potential', weight: 0.25 },
            { field: 'tenderness-index', weight: 0.15 },
            { field: 'fat-marbling-index', weight: 0.15 },
            { field: 'cortisol-level', weight: 0.10, inverted: true },
            { field: 'weight-2', weight: 0.05 },
          ],
          PARASITISM: [
            { field: 'weight-2', weight: 0.30 },
            { field: 'compliance-potential', weight: 0.25 },
            { field: 'sensory-receptivity', weight: 0.20 },
            { field: 'cortisol-level', weight: 0.10, inverted: true },
            { field: 'tenderness-index', weight: 0.10 },
            { field: 'fat-marbling-index', weight: 0.05 },
          ],
          THRALL: [
            { field: 'compliance-potential', weight: 0.35 },
            { field: 'cortisol-level', weight: 0.20, inverted: true },
            { field: 'weight-2', weight: 0.20 },
            { field: 'sensory-receptivity', weight: 0.10 },
            { field: 'tenderness-index', weight: 0.10 },
            { field: 'fat-marbling-index', weight: 0.05 },
          ],
          DISTRIBUTED: [
            { field: 'caloric-yield-estimate', weight: 0.40 },
            { field: 'fat-marbling-index', weight: 0.25 },
            { field: 'tenderness-index', weight: 0.15 },
            { field: 'cortisol-level', weight: 0.10, inverted: true },
            { field: 'weight-2', weight: 0.10 },
          ],
        }

        const ACTOR_WEIGHTS: FieldWeight[] = [
          { field: 'weight-1', weight: 0.30 },
          { field: 'aggression', weight: 0.20 },
          { field: 'hunger', weight: 0.20 },
          { field: 'patience', weight: 0.15 },
          { field: 'metabolic-satiation', weight: 0.10, inverted: true },
          { field: 'anatomical-integration', weight: 0.03 },
          { field: 'state-level', weight: 0.02 },
        ]

        const CANONICAL_NAMES: Record<string, string> = {
          'weight-1': 'Weight-1 (Predator Drive)',
          'weight-2': 'Weight-2 (Prey Vulnerability)',
          'fat-marbling-index': 'Fat-Marbling-Index',
          'tenderness-index': 'Tenderness-Index',
          'sensory-receptivity': 'Sensory-Receptivity',
          'compliance-potential': 'Compliance-Potential',
          'cortisol-level': 'Cortisol-Level',
          'caloric-yield-estimate': 'Caloric-Yield-Estimate',
          'metabolic-satiation': 'Metabolic-Satiation',
          'anatomical-integration': 'Anatomical-Integration',
          'state-level': 'State-Level',
          'aggression': 'Aggression',
          'hunger': 'Hunger',
          'patience': 'Patience',
        }

        const weightingTable: FieldWeight[] = entityRole === 'actor' ? ACTOR_WEIGHTS : SUBJECT_VECTORS[vector]

        const presentEntries: Array<{ fw: FieldWeight; field: ParsedField }> = []
        const missingFields: string[] = []

        for (const fw of weightingTable) {
          const found = parsedFields.get(fw.field)
          if (found !== undefined) {
            presentEntries.push({ fw, field: found })
          } else {
            missingFields.push(CANONICAL_NAMES[fw.field] ?? fw.field)
          }
        }

        if (presentEntries.length === 0) {
          return c.json(makeResult(id, {
            content: [{ type: 'text', text: `Utility analysis for "${key}" (${vector}): Grade F — 0/100` }],
            entity_id: key,
            vector,
            entity_role: entityRole,
            grade: 'F',
            composite_score: 0,
            fields_analyzed: [],
            missing_fields: weightingTable.map(fw => CANONICAL_NAMES[fw.field] ?? fw.field),
            breakdown: [],
            projected_yield: 'No quantifiable metrics found. Entity cannot be evaluated mechanically.'
          }), 200)
        }

        // Redistribute weights proportionally across present fields (FR4)
        const totalPresentWeight = presentEntries.reduce((sum, { fw }) => sum + fw.weight, 0)

        type BreakdownEntry = {
          field: string; raw_value: number; weight: number; effective_value: number; note?: string; contribution: number
        }

        const breakdown: BreakdownEntry[] = []
        let compositeSum = 0

        // Fields with large absolute ranges are normalized to [0,1] before weighting
        const FIELD_NORMALIZERS: Record<string, number> = {
          'caloric-yield-estimate': 200000,
        }

        for (const { fw, field } of presentEntries) {
          const rawValue = field.value
          const redistributedWeight = fw.weight / totalPresentWeight
          const normFactor = FIELD_NORMALIZERS[fw.field]
          const normalizedValue = normFactor ? Math.min(1, rawValue / normFactor) : rawValue
          const isInverted = fw.inverted ?? false
          const effectiveValue = isInverted ? Math.max(0, 1.0 - normalizedValue) : normalizedValue
          const contribution = Math.round(effectiveValue * redistributedWeight * 100 * 100) / 100
          const entry: BreakdownEntry = {
            field: field.originalName,
            raw_value: rawValue,
            weight: Math.round(redistributedWeight * 1000) / 1000,
            effective_value: Math.round(effectiveValue * 1000) / 1000,
            contribution,
          }
          if (isInverted) entry.note = `INVERTED: (1.0 - ${rawValue})`
          breakdown.push(entry)
          compositeSum += contribution
        }

        const compositeScore = Math.min(100, Math.max(0, Math.round(compositeSum)))

        const grade =
          compositeScore >= 90 ? 'S'
          : compositeScore >= 75 ? 'A'
          : compositeScore >= 55 ? 'B'
          : compositeScore >= 35 ? 'C'
          : compositeScore >= 15 ? 'D'
          : 'F'

        const VECTOR_NARRATIVES: Record<string, Record<string, string>> = {
          GASTRIC: {
            S: 'Exceptional gastric candidate — prime-grade tissue with pristine compliance metrics and minimal baseline stress; prolonged enzymatic integration expected over 5–8 days with optimal yield.',
            A: 'Excellent gastric yield — soft, receptive tissue with strong compliance; smooth multi-day internal processing anticipated with minimal resistance.',
            B: 'Viable gastric integration — adequate tissue quality and moderate compliance; standard processing timeline with some resistance expected.',
            C: 'Marginal gastric candidate — suboptimal tissue metrics or elevated stress levels; significant preparation required before reliable integration.',
            D: 'Poor gastric fit — significant resistance factors or insufficient tissue quality; last-resort classification only.',
            F: 'Not viable for gastric integration — critical metric deficiencies preclude this pathway.',
          },
          BUTCHERY: {
            S: 'Prime yield candidate — exceptional caloric density and marbling; harvest output will be exceptional across all material categories with negligible taint.',
            A: 'Choice yield — high caloric density with excellent marbling; clean harvest expected with minimal cortisol taint.',
            B: 'Standard yield — acceptable caloric output and marbling; workable harvest with normal processing overhead.',
            C: 'Below-standard yield — low caloric density or elevated cortisol taint; additional processing required to reclaim usable material.',
            D: 'Marginal harvest — poor material metrics; yield will be minimal and heavily tainted.',
            F: 'Not viable for butchery — insufficient material quality for any yield pathway.',
          },
          INCUBATION: {
            S: 'Ideal incubation host — exceptional compliance and pliability with pristine stress response; clutch viability projected at maximum with full brood consciousness enrichment.',
            A: 'Excellent host candidate — high compliance and adequate nutrient reserves; brood development expected to proceed without complications.',
            B: 'Viable incubation host — moderate compliance and sufficient pliability; clutch viability acceptable but not optimal.',
            C: 'Marginal host — elevated stress or insufficient compliance; clutch success uncertain without substantial preparation.',
            D: 'Poor host — critical compliance or stress deficiencies; brood viability severely compromised.',
            F: 'Not viable for incubation — host metrics preclude clutch viability.',
          },
          SCULPTURE: {
            S: 'Exceptional sculpture candidate — consciousness persistence and compliance metrics are pristine; the work will endure indefinitely as a living masterpiece of supreme expressive quality.',
            A: 'Excellent sculptural material — strong awareness and acceptance; high-quality enduring artwork anticipated.',
            B: 'Viable sculpture — adequate consciousness and compliance; functional artwork produced, though not remarkable.',
            C: 'Marginal sculptural candidate — insufficient awareness or acceptance; the piece may not sustain its intended expression.',
            D: 'Poor sculptural material — critical deficiencies in consciousness or compliance undermine the work.',
            F: 'Not viable for sculpture — insufficient metrics to sustain living artwork.',
          },
          PARASITISM: {
            S: 'Ideal hijack substrate — identity extremely displaceable with pristine compliance; neural transition expected to be seamless and immediate with full sensory inheritance.',
            A: 'Excellent hijack candidate — high vulnerability and compliance; displacement expected with minimal residual identity resistance.',
            B: 'Viable hijack substrate — adequate vulnerability; displacement feasible with standard conditioning effort.',
            C: 'Marginal hijack candidate — resistance factors present; extended conditioning required before reliable displacement.',
            D: 'Poor hijack substrate — significant identity coherence or resistance; low probability of successful takeover.',
            F: 'Not viable for neural hijack — entity metrics preclude consciousness displacement.',
          },
          THRALL: {
            S: 'Exceptional thrall candidate — compliance and stress metrics are pristine; permanent conditioning expected immediately and will hold indefinitely without reinforcement.',
            A: 'Excellent thrall material — high compliance with manageable resistance; conditioning will hold long-term with minimal maintenance.',
            B: 'Viable thrall candidate — moderate compliance and durability; conditioning achievable with standard investment.',
            C: 'Marginal thrall material — compliance deficiencies or chronic stress complicate conditioning; periodic reinforcement required.',
            D: 'Poor thrall candidate — insufficient compliance or durability for reliable permanent conditioning.',
            F: 'Not viable for enthrallment — entity metrics preclude sustainable conditioning.',
          },
          DISTRIBUTED: {
            S: 'Prime industrial substrate — exceptional caloric density and renderable yield; batch output will be maximum with minimal waste and pristine material quality throughout.',
            A: 'Choice industrial material — high caloric output and excellent marbling ratio; efficient batch processing expected with clean output.',
            B: 'Standard industrial yield — adequate caloric and marbling metrics; workable batch with normal processing overhead.',
            C: 'Below-standard industrial yield — low caloric density or taint factors significantly reduce batch quality.',
            D: 'Marginal industrial input — poor yield metrics; batch contribution will be minimal and tainted.',
            F: 'Not viable for distributed processing — insufficient material metrics for industrial use.',
          },
        }

        const projectedYield = entityRole === 'actor'
          ? `Actor capability assessment complete. Grade ${grade} indicates ${compositeScore >= 75 ? 'strong' : compositeScore >= 55 ? 'adequate' : compositeScore >= 35 ? 'limited' : 'marginal'} predation drive for ${vector} pathway.`
          : (VECTOR_NARRATIVES[vector]?.[grade] ?? 'Utility assessment complete.')

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: `Utility analysis for "${key}" (${vector}): Grade ${grade} — ${compositeScore}/100` }],
          entity_id: key,
          vector,
          entity_role: entityRole,
          grade,
          composite_score: compositeScore,
          fields_analyzed: breakdown.map(b => b.field),
          missing_fields: missingFields,
          breakdown,
          projected_yield: projectedYield,
        }), 200)
      }

      if (toolName === 'map_integration') {
        const schema = z.object({
          source_id: z.string().min(1),
          target_id: z.string().min(1),
          integration_depth: z.number().min(0).max(1)
        })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const sourceKey = parsed.data.source_id.trim().toLowerCase()
        const targetKey = parsed.data.target_id.trim().toLowerCase()
        const depth = parsed.data.integration_depth

        const [rawSource, rawTarget] = await Promise.all([kvGet(c, sourceKey), kvGet(c, targetKey)])
        if (!rawSource) return c.json(makeError(id, -32602, `Source entity "${sourceKey}" not found`, null), 200)
        if (!rawTarget) return c.json(makeError(id, -32602, `Target entity "${targetKey}" not found`, null), 200)

        const { text: sourceText } = parseKvEntry(rawSource)
        const { text: targetText, meta: targetMeta } = parseKvEntry(rawTarget)

        const transferableLines: string[] = []
        for (const line of sourceText.split('\n')) {
          if (/\[Transferable\]/i.test(line) || /^\*\*Transferable-/i.test(line)) {
            transferableLines.push(line.trim())
          }
        }

        if (transferableLines.length === 0) {
          return c.json(makeResult(id, {
            content: [{ type: 'text', text: `No [Transferable] traits found in "${sourceKey}".` }],
            metadata: { source_id: sourceKey, target_id: targetKey, integration_depth: depth },
            updated_traits: []
          }), 200)
        }

        const transferCount = Math.floor(transferableLines.length * depth)
        if (transferCount === 0) {
          return c.json(makeResult(id, {
            content: [{ type: 'text', text: `integration_depth ${depth} yields 0 traits from ${transferableLines.length} available in "${sourceKey}".` }],
            metadata: { source_id: sourceKey, target_id: targetKey, integration_depth: depth, total_transferable: transferableLines.length },
            updated_traits: []
          }), 200)
        }

        const traitsToTransfer = transferableLines.slice(0, transferCount)
        const separator = targetText.endsWith('\n') ? '' : '\n'
        const integrationBlock = `\n**Integrated-From:** ${sourceKey} (depth: ${depth})\n` + traitsToTransfer.join('\n')
        const updatedTargetText = targetText + separator + integrationBlock

        await pushHistory(c, targetKey, rawTarget)
        const now = new Date().toISOString()
        const version = typeof targetMeta.version === 'number' ? targetMeta.version + 1 : 1
        await kvPut(c, targetKey, JSON.stringify({
          text: updatedTargetText,
          meta: { version, updatedAt: now, createdAt: targetMeta.createdAt ?? now }
        }))
        loreDB[targetKey] = updatedTargetText

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: `Integrated ${traitsToTransfer.length} trait(s) from "${sourceKey}" into "${targetKey}" at depth ${depth}.` }],
          metadata: { source_id: sourceKey, target_id: targetKey, integration_depth: depth, total_transferable: transferableLines.length, transferred_count: traitsToTransfer.length, version },
          updated_traits: traitsToTransfer
        }), 200)
      }

      if (toolName === 'thread_tick') {
        const schema = z.object({ thread_id: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const threadId = parsed.data.thread_id.trim()
        const allKeys = await kvList(c)

        type ThreadEntity = { key: string; raw: string; text: string; meta: Record<string, unknown> }
        const threadEntities: ThreadEntity[] = []
        for (const key of allKeys) {
          const raw = await kvGet(c, key)
          if (!raw) continue
          const { text, meta } = parseKvEntry(raw)
          const threadField = extractRawField(text, 'Thread')
          if (threadField?.toLowerCase() === threadId.toLowerCase()) {
            threadEntities.push({ key, raw, text, meta })
          }
        }

        const now = new Date().toISOString()
        const local_shifts: Array<{ key: string; old_value: number; new_value: number; status_change: boolean }> = []

        for (const entity of threadEntities) {
          const timelineValue = extractFieldFromText(entity.text, 'Timeline-Value')
          if (typeof timelineValue !== 'number') continue
          const newValue = timelineValue - 1
          const updatedText = updateFieldInText(entity.text, 'Timeline-Value', newValue)
          await pushHistory(c, entity.key, entity.raw)
          const version = typeof entity.meta.version === 'number' ? entity.meta.version + 1 : 1
          await kvPut(c, entity.key, JSON.stringify({
            text: updatedText,
            meta: { version, updatedAt: now, createdAt: entity.meta.createdAt ?? now, thread_tick: threadId }
          }))
          loreDB[entity.key] = updatedText
          local_shifts.push({ key: entity.key, old_value: timelineValue, new_value: newValue, status_change: timelineValue > 0 && newValue <= 0 })
        }

        const affectedDates = new Set<string>()
        for (const entity of threadEntities) {
          const d = extractRawField(entity.text, 'Current-Date')
          if (d) affectedDates.add(d)
        }

        const threadEntityKeys = new Set(threadEntities.map(e => e.key))
        const global_snapshot: Array<{ key: string; thread: string; current_date: string; status: string }> = []

        if (affectedDates.size > 0) {
          for (const key of allKeys) {
            if (threadEntityKeys.has(key)) continue
            const raw = await kvGet(c, key)
            if (!raw) continue
            const { text } = parseKvEntry(raw)
            const entityThread = extractRawField(text, 'Thread')
            const entityDate = extractRawField(text, 'Current-Date')
            if (entityThread && entityDate && affectedDates.has(entityDate)) {
              global_snapshot.push({
                key,
                thread: entityThread,
                current_date: entityDate,
                status: extractRawField(text, 'Status') ?? 'unknown'
              })
            }
          }
        }

        const summaryText = local_shifts.length === 0
          ? `No entities with **Timeline-Value:** found for thread "${threadId}".`
          : `Thread "${threadId}" ticked: ${local_shifts.length} entity/entities decremented. ${global_snapshot.length} global entity/entities on shared dates.`

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: summaryText }],
          metadata: { thread_id: threadId, entities_ticked: local_shifts.length, global_entities: global_snapshot.length },
          local_shifts,
          global_snapshot
        }), 200)
      }

      // ── get_relationship ─────────────────────────────────────────────────────
      if (toolName === 'get_relationship') {
        const schema = z.object({ entity_a: z.string().min(1), entity_b: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const keyA = parsed.data.entity_a.trim().toLowerCase()
        const keyB = parsed.data.entity_b.trim().toLowerCase()
        const [rawA, rawB] = await Promise.all([kvGet(c, keyA), kvGet(c, keyB)])
        if (!rawA) return c.json(makeError(id, -32602, `Entity "${keyA}" not found`, null), 200)
        if (!rawB) return c.json(makeError(id, -32602, `Entity "${keyB}" not found`, null), 200)

        const { text: textA } = parseKvEntry(rawA)
        const { text: textB } = parseKvEntry(rawB)
        const affinity = extractFieldFromText(textA, 'Affinity')
        const debt = extractFieldFromText(textA, 'Debt')
        const threatLevel = extractFieldFromText(textA, 'Threat-Level')
        const factionA = extractRawField(textA, 'Faction')
        const factionB = extractRawField(textB, 'Faction')
        const factionOverlap = factionA && factionB && factionA.toLowerCase() === factionB.toLowerCase() ? [factionA] : []
        const nameB = keyB.split(':').pop() ?? keyB
        const nameA = keyA.split(':').pop() ?? keyA
        const aMentionsB = textA.toLowerCase().includes(nameB.toLowerCase())
        const bMentionsA = textB.toLowerCase().includes(nameA.toLowerCase())
        const hasData = typeof affinity === 'number' || typeof debt === 'number' || aMentionsB || bMentionsA || factionOverlap.length > 0

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: hasData ? `Relationship data found between "${keyA}" and "${keyB}".` : `No relationship data found between "${keyA}" and "${keyB}".` }],
          metadata: { retrieved: 2, written: 0 },
          relationship: hasData ? {
            entity_a: keyA, entity_b: keyB,
            affinity: typeof affinity === 'number' ? affinity : null,
            debt: typeof debt === 'number' ? debt : null,
            threat_level: typeof threatLevel === 'number' ? threatLevel : null,
            faction_overlap: factionOverlap,
            cross_references: { a_mentions_b: aMentionsB, b_mentions_a: bMentionsA }
          } : null,
          suggestion: hasData ? null : `No relationship data. Create one with set_lore key="relationship:${nameA}-${nameB}".`
        }), 200)
      }

      // ── get_faction_standing ──────────────────────────────────────────────────
      if (toolName === 'get_faction_standing') {
        const schema = z.object({ entity_key: z.string().min(1), faction_key: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const entityKey = parsed.data.entity_key.trim().toLowerCase()
        const factionKey = parsed.data.faction_key.trim().toLowerCase()
        const [rawEntity, rawFaction] = await Promise.all([kvGet(c, entityKey), kvGet(c, factionKey)])
        if (!rawEntity) return c.json(makeError(id, -32602, `Entity "${entityKey}" not found`, null), 200)
        if (!rawFaction) return c.json(makeError(id, -32602, `Faction "${factionKey}" not found`, null), 200)

        const { text: entityText } = parseKvEntry(rawEntity)
        const { text: factionText } = parseKvEntry(rawFaction)
        const rank = extractRawField(entityText, 'Rank')
        const reputation = extractFieldFromText(entityText, 'Reputation')
        const debt = extractFieldFromText(entityText, 'Debt')
        const threatLevel = extractFieldFromText(entityText, 'Threat-Level')
        const entityNamePart = entityKey.split(':').pop() ?? entityKey
        const factionNamePart = (factionKey.split(':').pop() ?? '').toLowerCase()
        const isMember = factionText.toLowerCase().includes(entityNamePart.toLowerCase()) ||
          (extractRawField(entityText, 'Faction') ?? '').toLowerCase().includes(factionNamePart)

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: `Standing of "${entityKey}" in "${factionKey}": ${isMember ? 'member' : 'non-member'}${rank ? `, rank: ${rank}` : ''}.` }],
          metadata: { retrieved: 2, written: 0 },
          standing: {
            entity_key: entityKey, faction_key: factionKey, is_member: isMember,
            rank: rank ?? null,
            reputation: typeof reputation === 'number' ? reputation : null,
            debt: typeof debt === 'number' ? debt : null,
            threat_level: typeof threatLevel === 'number' ? threatLevel : null,
          }
        }), 200)
      }

      // ── get_entity_knowledge ──────────────────────────────────────────────────
      if (toolName === 'get_entity_knowledge') {
        const schema = z.object({ entity_key: z.string().min(1), topic: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const entityKey = parsed.data.entity_key.trim().toLowerCase()
        const topic = parsed.data.topic.trim().toLowerCase()
        const raw = await kvGet(c, entityKey)
        if (!raw) return c.json(makeError(id, -32602, `Entity "${entityKey}" not found`, null), 200)

        const { text } = parseKvEntry(raw)
        const knowsField = extractRawField(text, 'Knows') ?? extractRawField(text, 'Knowledge') ?? extractRawField(text, 'Awareness')
        const knownViaField = knowsField ? knowsField.toLowerCase().includes(topic) : false
        const knownInText = text.toLowerCase().includes(topic)
        const excerpts: string[] = []
        if (knownInText) {
          const lower = text.toLowerCase()
          let idx = 0
          while (idx < text.length && excerpts.length < 3) {
            const found = lower.indexOf(topic, idx)
            if (found === -1) break
            const start = Math.max(0, found - 20)
            const end = Math.min(text.length, found + topic.length + 40)
            excerpts.push(text.slice(start, end).trim())
            idx = found + topic.length
          }
        }

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: knownInText ? `"${entityKey}" has knowledge of "${topic}".` : `"${entityKey}" has no knowledge of "${topic}".` }],
          metadata: { retrieved: 1, written: 0 },
          known: knownInText, known_via_field: knownViaField, topic, excerpts
        }), 200)
      }

      // ── get_location_occupants ────────────────────────────────────────────────
      if (toolName === 'get_location_occupants') {
        const schema = z.object({ location_key: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const locationKey = parsed.data.location_key.trim().toLowerCase()
        const allKeys = await kvList(c)
        const occupants: Array<{ key: string; status: string | null }> = []
        for (const key of allKeys) {
          const raw = await kvGet(c, key)
          if (!raw) continue
          const { text } = parseKvEntry(raw)
          const locField = extractRawField(text, 'Location')
          if (locField && locField.trim().toLowerCase() === locationKey) {
            occupants.push({ key, status: extractRawField(text, 'Status') ?? null })
          }
        }

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: occupants.length > 0 ? `${occupants.length} occupant(s) at "${locationKey}": ${occupants.map(o => o.key).join(', ')}.` : `No occupants found at "${locationKey}".` }],
          metadata: { retrieved: allKeys.length, written: 0 },
          location_key: locationKey, occupants
        }), 200)
      }

      // ── get_reachable_locations ───────────────────────────────────────────────
      if (toolName === 'get_reachable_locations') {
        const schema = z.object({ origin_key: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const originKey = parsed.data.origin_key.trim().toLowerCase()
        const rawOrigin = await kvGet(c, originKey)
        if (!rawOrigin) return c.json(makeError(id, -32602, `Location "${originKey}" not found`, null), 200)

        const { text } = parseKvEntry(rawOrigin)
        const exitsRaw = extractRawField(text, 'Exits') ?? extractRawField(text, 'Connections') ?? extractRawField(text, 'Routes')
        const exitKeys = exitsRaw ? exitsRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : []

        const locations = await Promise.all(exitKeys.map(async (key) => {
          const exitRaw = await kvGet(c, key)
          const exitText = exitRaw ? parseKvEntry(exitRaw).text : null
          const dangerLevel = exitText ? extractFieldFromText(exitText, 'Danger-Level') : null
          const travelCost = exitText ? extractFieldFromText(exitText, 'Travel-Cost') : null
          const requirements = exitText ? extractRawField(exitText, 'Requirements') : null
          return {
            key, exists: exitRaw !== null,
            danger_level: typeof dangerLevel === 'number' ? dangerLevel : null,
            travel_cost: typeof travelCost === 'number' ? travelCost : null,
            requirements: requirements ?? null,
          }
        }))

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: locations.length > 0 ? `${locations.length} reachable location(s) from "${originKey}": ${locations.map(l => l.key).join(', ')}.` : `No exits defined for "${originKey}".` }],
          metadata: { retrieved: 1 + exitKeys.length, written: 0 },
          origin_key: originKey, locations
        }), 200)
      }

      // ── sense_environment ─────────────────────────────────────────────────────
      if (toolName === 'sense_environment') {
        const schema = z.object({ location_key: z.string().min(1), entity_key: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const locationKey = parsed.data.location_key.trim().toLowerCase()
        const entityKey = parsed.data.entity_key.trim().toLowerCase()
        const [rawLoc, rawEntity] = await Promise.all([kvGet(c, locationKey), kvGet(c, entityKey)])
        if (!rawLoc) return c.json(makeError(id, -32602, `Location "${locationKey}" not found`, null), 200)
        if (!rawEntity) return c.json(makeError(id, -32602, `Entity "${entityKey}" not found`, null), 200)

        const { text: locText } = parseKvEntry(rawLoc)
        const { text: entityText } = parseKvEntry(rawEntity)
        const perception = extractFieldFromText(entityText, 'Perception')
        const nightVision = extractFieldFromText(entityText, 'Night-Vision')
        const tracking = extractFieldFromText(entityText, 'Tracking')
        const perceptionScore = typeof perception === 'number' ? perception : 0.5

        const visibleDetails: string[] = []
        const hiddenDetails: string[] = []
        for (const line of locText.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed) continue
          const isHidden = /\[hidden\]|\[concealed\]|\[obscured\]/i.test(line)
          const isThreat = /\[threat\]|\[danger\]|\[hostile\]/i.test(line)
          if ((isHidden && perceptionScore < 0.7) || (isThreat && perceptionScore < 0.4)) {
            hiddenDetails.push(trimmed)
          } else {
            visibleDetails.push(trimmed)
          }
        }

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: `"${entityKey}" senses "${locationKey}" (perception: ${perceptionScore.toFixed(2)}). ${visibleDetails.length} visible detail(s), ${hiddenDetails.length} hidden.` }],
          metadata: { retrieved: 2, written: 0 },
          entity_key: entityKey, location_key: locationKey, perception_score: perceptionScore,
          night_vision: typeof nightVision === 'number' ? nightVision : null,
          tracking: typeof tracking === 'number' ? tracking : null,
          visible_details: visibleDetails,
          hidden_count: hiddenDetails.length,
          missed_threats: hiddenDetails.filter(l => /\[threat\]|\[danger\]/i.test(l)).length
        }), 200)
      }

      // ── get_inventory ─────────────────────────────────────────────────────────
      if (toolName === 'get_inventory') {
        const schema = z.object({ entity_key: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const entityKey = parsed.data.entity_key.trim().toLowerCase()
        const raw = await kvGet(c, entityKey)
        if (!raw) return c.json(makeError(id, -32602, `Entity "${entityKey}" not found`, null), 200)

        const { text } = parseKvEntry(raw)
        const invRaw = extractRawField(text, 'Inventory') ?? extractRawField(text, 'Items') ?? extractRawField(text, 'Carried-Items')
        const items: Array<{ item: string; quantity: number; condition: string | null }> = []
        if (invRaw) {
          for (const entry of invRaw.split(',').map(s => s.trim()).filter(Boolean)) {
            const m = entry.match(/^(.+?)\s*[x:×]\s*(\d+)(?:\s*\[([^\]]+)\])?$/)
            if (m) items.push({ item: m[1].trim(), quantity: parseInt(m[2]), condition: m[3] ?? null })
            else items.push({ item: entry, quantity: 1, condition: null })
          }
        }

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: items.length > 0 ? `Inventory for "${entityKey}": ${items.map(i => `${i.item}×${i.quantity}`).join(', ')}.` : `No inventory found for "${entityKey}".` }],
          metadata: { retrieved: 1, written: 0 },
          entity_key: entityKey, items, raw_inventory: invRaw ?? null
        }), 200)
      }

      // ── transfer_item ─────────────────────────────────────────────────────────
      if (toolName === 'transfer_item') {
        const schema = z.object({
          from_entity: z.string().min(1), to_entity: z.string().min(1),
          item_key: z.string().min(1), quantity: z.number().int().min(1).default(1),
        })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const fromKey = parsed.data.from_entity.trim().toLowerCase()
        const toKey = parsed.data.to_entity.trim().toLowerCase()
        const itemKey = parsed.data.item_key.trim()
        const qty = parsed.data.quantity
        const [rawFrom, rawTo] = await Promise.all([kvGet(c, fromKey), kvGet(c, toKey)])
        if (!rawFrom) return c.json(makeError(id, -32602, `Entity "${fromKey}" not found`, null), 200)
        if (!rawTo) return c.json(makeError(id, -32602, `Entity "${toKey}" not found`, null), 200)

        const { text: fromText, meta: fromMeta } = parseKvEntry(rawFrom)
        const { text: toText, meta: toMeta } = parseKvEntry(rawTo)

        const parseInvStr = (raw: string): Array<{ item: string; quantity: number }> =>
          raw.split(',').map(s => s.trim()).filter(Boolean).map(entry => {
            const m = entry.match(/^(.+?)\s*[x:×]\s*(\d+)$/)
            return m ? { item: m[1].trim(), quantity: parseInt(m[2]) } : { item: entry, quantity: 1 }
          })

        const fromInvFieldName = extractRawField(fromText, 'Inventory') ? 'Inventory' : extractRawField(fromText, 'Items') ? 'Items' : 'Inventory'
        const toInvFieldName = extractRawField(toText, 'Inventory') ? 'Inventory' : extractRawField(toText, 'Items') ? 'Items' : 'Inventory'
        const fromInvRaw = extractRawField(fromText, fromInvFieldName) ?? ''
        const fromItems = parseInvStr(fromInvRaw)
        const itemIdx = fromItems.findIndex(i => i.item.toLowerCase() === itemKey.toLowerCase())

        if (itemIdx === -1) {
          return c.json(makeResult(id, { content: [{ type: 'text', text: `Item "${itemKey}" not found in "${fromKey}"'s inventory.` }], metadata: { retrieved: 2, written: 0 }, transferred: false }), 200)
        }
        if (fromItems[itemIdx].quantity < qty) {
          return c.json(makeResult(id, { content: [{ type: 'text', text: `Insufficient quantity: "${fromKey}" has ${fromItems[itemIdx].quantity}× "${itemKey}", requested ${qty}.` }], metadata: { retrieved: 2, written: 0 }, transferred: false }), 200)
        }

        fromItems[itemIdx].quantity -= qty
        const newFromItems = fromItems.filter(i => i.quantity > 0)
        const newFromInvStr = newFromItems.map(i => `${i.item}×${i.quantity}`).join(', ')

        const toInvRaw = extractRawField(toText, toInvFieldName) ?? ''
        const toItems = parseInvStr(toInvRaw)
        const toIdx = toItems.findIndex(i => i.item.toLowerCase() === itemKey.toLowerCase())
        if (toIdx >= 0) toItems[toIdx].quantity += qty
        else toItems.push({ item: itemKey, quantity: qty })
        const newToInvStr = toItems.map(i => `${i.item}×${i.quantity}`).join(', ')

        const newFromText = updateFieldInText(fromText, fromInvFieldName, newFromInvStr)
        const newToText = updateFieldInText(toText, toInvFieldName, newToInvStr)

        const now = new Date().toISOString()
        await Promise.all([pushHistory(c, fromKey, rawFrom), pushHistory(c, toKey, rawTo)])
        const fromVersion = typeof fromMeta.version === 'number' ? fromMeta.version + 1 : 1
        const toVersion = typeof toMeta.version === 'number' ? toMeta.version + 1 : 1
        await Promise.all([
          kvPut(c, fromKey, JSON.stringify({ text: newFromText, meta: { version: fromVersion, updatedAt: now, createdAt: fromMeta.createdAt ?? now } })),
          kvPut(c, toKey, JSON.stringify({ text: newToText, meta: { version: toVersion, updatedAt: now, createdAt: toMeta.createdAt ?? now } })),
        ])
        loreDB[fromKey] = newFromText
        loreDB[toKey] = newToText

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: `Transferred ${qty}× "${itemKey}" from "${fromKey}" to "${toKey}".` }],
          metadata: { retrieved: 2, written: 2 },
          transferred: true, item_key: itemKey, quantity: qty, from_entity: fromKey, to_entity: toKey
        }), 200)
      }

      // ── activate_scene ────────────────────────────────────────────────────────
      if (toolName === 'activate_scene') {
        const schema = z.object({ scene_key: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const sceneKey = parsed.data.scene_key.trim().toLowerCase()
        const rawScene = await kvGet(c, sceneKey)
        if (!rawScene) return c.json(makeError(id, -32602, `Scene "${sceneKey}" not found`, null), 200)

        const { text: sceneText } = parseKvEntry(rawScene)
        const entitiesRaw = extractRawField(sceneText, 'Entities') ?? extractRawField(sceneText, 'Present-Entities')
        const locationRef = extractRawField(sceneText, 'Location')
        const timelineRef = extractRawField(sceneText, 'Timeline')
        const description = extractRawField(sceneText, 'Description') ?? sceneText.split('\n').find(l => l.trim() && !l.startsWith('**'))?.trim() ?? ''
        const choicesRaw = extractRawField(sceneText, 'Choices')
        const availableChoices = choicesRaw ? choicesRaw.split(',').map(s => s.trim()).filter(Boolean) : []
        const entityKeys = entitiesRaw ? entitiesRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : []
        const keysToFetch = [...entityKeys, ...(locationRef ? [locationRef.trim().toLowerCase()] : [])]

        const batchData: Record<string, any> = {}
        if (keysToFetch.length > 0) {
          const rawValues = await Promise.all(keysToFetch.map(k => kvGet(c, k)))
          keysToFetch.forEach((k, i) => { batchData[k] = rawValues[i] ? parseKvEntry(rawValues[i]!).text : null })
        }

        const existingActive = await kvGet(c, 'system:active-scene')
        const now = new Date().toISOString()
        const activeText = `**Active-Scene:** ${sceneKey}\n**Activated-At:** ${now}`
        await kvPut(c, 'system:active-scene', JSON.stringify({ text: activeText, meta: { version: 1, updatedAt: now, createdAt: now } }))
        loreDB['system:active-scene'] = activeText

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: `Scene "${sceneKey}" activated. ${entityKeys.length} entity/entities hydrated, ${availableChoices.length} choice branch(es) available.` }],
          metadata: { retrieved: 1 + keysToFetch.length, written: 1 },
          scene_key: sceneKey, description, location: locationRef ?? null, timeline: timelineRef ?? null,
          present_entities: entityKeys, entity_data: batchData, available_choices: availableChoices,
          previously_active: existingActive ? parseKvEntry(existingActive).text : null
        }), 200)
      }

      // ── present_choices ───────────────────────────────────────────────────────
      if (toolName === 'present_choices') {
        const schema = z.object({ scene_key: z.string().min(1), entity_key: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const sceneKey = parsed.data.scene_key.trim().toLowerCase()
        const entityKey = parsed.data.entity_key.trim().toLowerCase()
        const [rawScene, rawEntity] = await Promise.all([kvGet(c, sceneKey), kvGet(c, entityKey)])
        if (!rawScene) return c.json(makeError(id, -32602, `Scene "${sceneKey}" not found`, null), 200)
        if (!rawEntity) return c.json(makeError(id, -32602, `Entity "${entityKey}" not found`, null), 200)

        const { text: sceneText } = parseKvEntry(rawScene)
        const { text: entityText } = parseKvEntry(rawEntity)
        const entityWeight1 = extractFieldFromText(entityText, 'Weight-1') ?? 0
        const entityInvRaw = extractRawField(entityText, 'Inventory') ?? extractRawField(entityText, 'Items') ?? ''
        const entityStatus = extractRawField(entityText, 'Status') ?? ''

        const validChoices: Array<{ id: string; description: string; requires: string | null }> = []
        const blockedChoices: Array<{ id: string; description: string; blocked_reason: string }> = []

        for (const line of sceneText.split('\n').filter(l => /^\s*-\s+\S+:/.test(l))) {
          const m = line.match(/^\s*-\s+(\S+):\s*(.+?)(?:\s*\[requires:\s*([^\]]+)\])?(?:\s*\[min-weight:\s*([\d.]+)\])?$/)
          if (!m) continue
          const [, choiceId, desc, requires, minWeightStr] = m
          const minWeight = minWeightStr ? parseFloat(minWeightStr) : null
          let blockedReason: string | null = null
          if (requires && !entityInvRaw.toLowerCase().includes(requires.toLowerCase())) {
            blockedReason = `Requires item: ${requires}`
          } else if (minWeight !== null && typeof entityWeight1 === 'number' && entityWeight1 < minWeight) {
            blockedReason = `Requires Weight-1 ≥ ${minWeight} (entity has ${entityWeight1})`
          }
          if (blockedReason) blockedChoices.push({ id: choiceId, description: desc.trim(), blocked_reason: blockedReason })
          else validChoices.push({ id: choiceId, description: desc.trim(), requires: requires ?? null })
        }

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: `${validChoices.length} valid choice(s) for "${entityKey}" in "${sceneKey}". ${blockedChoices.length} blocked.` }],
          metadata: { retrieved: 2, written: 0 },
          entity_key: entityKey, scene_key: sceneKey, valid_choices: validChoices, blocked_choices: blockedChoices,
          entity_status: entityStatus, entity_weight_1: typeof entityWeight1 === 'number' ? entityWeight1 : null,
        }), 200)
      }

      // ── commit_choice ─────────────────────────────────────────────────────────
      if (toolName === 'commit_choice') {
        const schema = z.object({ choice_id: z.string().min(1), entity_key: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const choiceId = parsed.data.choice_id.trim().toLowerCase()
        const entityKey = parsed.data.entity_key.trim().toLowerCase()
        const [rawChoice, rawEntity] = await Promise.all([kvGet(c, choiceId), kvGet(c, entityKey)])
        if (!rawChoice) return c.json(makeError(id, -32602, `Choice "${choiceId}" not found`, null), 200)
        if (!rawEntity) return c.json(makeError(id, -32602, `Entity "${entityKey}" not found`, null), 200)

        const { text: choiceText } = parseKvEntry(rawChoice)
        const { text: entityText, meta: entityMeta } = parseKvEntry(rawEntity)
        const outcomeSeed = extractRawField(choiceText, 'Outcome-Seed') ?? extractRawField(choiceText, 'Narrative-Seed') ?? ''
        const stateChange = extractRawField(choiceText, 'State-Change')
        const nextChoicesRaw = extractRawField(choiceText, 'Next-Choices') ?? extractRawField(choiceText, 'Unlocks')
        const nextChoices = nextChoicesRaw ? nextChoicesRaw.split(',').map(s => s.trim()).filter(Boolean) : []

        const now = new Date().toISOString()
        let newEntityText = stateChange ? updateFieldInText(entityText, 'Status', stateChange) : entityText
        const existingHistory = extractRawField(newEntityText, 'Choice-History') ?? ''
        const historyEntry = `${choiceId}@${now}`
        newEntityText = updateFieldInText(newEntityText, 'Choice-History', existingHistory ? `${existingHistory}, ${historyEntry}` : historyEntry)

        await pushHistory(c, entityKey, rawEntity)
        const entityVersion = typeof entityMeta.version === 'number' ? entityMeta.version + 1 : 1
        await kvPut(c, entityKey, JSON.stringify({ text: newEntityText, meta: { version: entityVersion, updatedAt: now, createdAt: entityMeta.createdAt ?? now, last_choice: choiceId } }))
        loreDB[entityKey] = newEntityText

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: `Choice "${choiceId}" committed for "${entityKey}".${stateChange ? ` State → ${stateChange}.` : ''} ${nextChoices.length} new choice(s) unlocked.` }],
          metadata: { retrieved: 2, written: 1 },
          choice_id: choiceId, entity_key: entityKey, outcome_seed: outcomeSeed,
          state_change: stateChange ?? null, next_choices: nextChoices
        }), 200)
      }

      // ── get_choice_history ────────────────────────────────────────────────────
      if (toolName === 'get_choice_history') {
        const schema = z.object({ entity_key: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const entityKey = parsed.data.entity_key.trim().toLowerCase()
        const raw = await kvGet(c, entityKey)
        if (!raw) return c.json(makeError(id, -32602, `Entity "${entityKey}" not found`, null), 200)

        const { text } = parseKvEntry(raw)
        const historyRaw = extractRawField(text, 'Choice-History')
        const history: Array<{ choice_id: string; timestamp: string | null }> = []
        if (historyRaw) {
          for (const entry of historyRaw.split(',').map(s => s.trim()).filter(Boolean)) {
            const parts = entry.split('@')
            history.push({ choice_id: parts[0].trim(), timestamp: parts[1] ?? null })
          }
        }

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: history.length > 0 ? `Choice history for "${entityKey}": ${history.length} committed choice(s).` : `No choice history found for "${entityKey}".` }],
          metadata: { retrieved: 1, written: 0 },
          entity_key: entityKey, history, raw_history: historyRaw ?? null
        }), 200)
      }

      // ── advance_state_stage ───────────────────────────────────────────────────
      if (toolName === 'advance_state_stage') {
        const schema = z.object({ entity_key: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const entityKey = parsed.data.entity_key.trim().toLowerCase()
        const raw = await kvGet(c, entityKey)
        if (!raw) return c.json(makeError(id, -32602, `Entity "${entityKey}" not found`, null), 200)

        const { text, meta } = parseKvEntry(raw)
        const currentStage = extractFieldFromText(text, 'State-Stage')
        if (typeof currentStage !== 'number') {
          return c.json(makeResult(id, { content: [{ type: 'text', text: `Entity "${entityKey}" has no numeric State-Stage field.` }], metadata: { retrieved: 1, written: 0 }, advanced: false }), 200)
        }

        const totalStages = extractFieldFromText(text, 'State-Total')
        const total = typeof totalStages === 'number' ? totalStages : null
        if (total !== null && currentStage >= total) {
          return c.json(makeResult(id, { content: [{ type: 'text', text: `Entity "${entityKey}" is already at final stage ${currentStage}/${total}.` }], metadata: { retrieved: 1, written: 0 }, advanced: false, current_stage: currentStage, total_stages: total, is_terminal: true }), 200)
        }

        const newStage = currentStage + 1
        let updatedText = updateFieldInText(text, 'State-Stage', newStage)
        const stageTimer = extractFieldFromText(text, 'Stage-Timer')
        if (typeof stageTimer === 'number') {
          updatedText = updateFieldInText(updatedText, 'Stage-Timer', Math.max(0, stageTimer - 1))
        }
        const stageDescriptor = extractRawField(text, `Stage-${newStage}-Description`) ?? extractRawField(text, 'Stage-Description') ?? null
        const isTerminal = total !== null && newStage >= total

        await pushHistory(c, entityKey, raw)
        const now = new Date().toISOString()
        const version = typeof meta.version === 'number' ? meta.version + 1 : 1
        await kvPut(c, entityKey, JSON.stringify({ text: updatedText, meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now } }))
        loreDB[entityKey] = updatedText

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: `Advancing "${entityKey}" to stage ${newStage}${total ? `/${total}` : ''}. ${isTerminal ? '[TERMINAL STAGE]' : ''}` }],
          metadata: { retrieved: 1, written: 1 },
          entity_key: entityKey, old_stage: currentStage, new_stage: newStage, total_stages: total,
          is_terminal: isTerminal, stage_descriptor: stageDescriptor, advanced: true
        }), 200)
      }

      // ── process_stage_batch ───────────────────────────────────────────────────
      if (toolName === 'process_stage_batch') {
        const schema = z.object({ location_key: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const locationKey = parsed.data.location_key.trim().toLowerCase()
        const allKeys = await kvList(c)
        const now = new Date().toISOString()
        const outcomes: Array<{ key: string; old_stage: number; new_stage: number; is_terminal: boolean }> = []
        const skipped: Array<{ key: string; reason: string }> = []

        for (const key of allKeys) {
          const raw = await kvGet(c, key)
          if (!raw) continue
          const { text, meta } = parseKvEntry(raw)
          const locField = extractRawField(text, 'Location')
          if (!locField || locField.trim().toLowerCase() !== locationKey) continue

          const currentStage = extractFieldFromText(text, 'State-Stage')
          if (typeof currentStage !== 'number') { skipped.push({ key, reason: 'no State-Stage field' }); continue }
          const totalStages = extractFieldFromText(text, 'State-Total')
          const total = typeof totalStages === 'number' ? totalStages : null
          if (total !== null && currentStage >= total) { skipped.push({ key, reason: `already at terminal stage ${currentStage}/${total}` }); continue }

          const newStage = currentStage + 1
          let updatedText = updateFieldInText(text, 'State-Stage', newStage)
          const stageTimer = extractFieldFromText(text, 'Stage-Timer')
          if (typeof stageTimer === 'number') updatedText = updateFieldInText(updatedText, 'Stage-Timer', Math.max(0, stageTimer - 1))

          await pushHistory(c, key, raw)
          const version = typeof meta.version === 'number' ? meta.version + 1 : 1
          await kvPut(c, key, JSON.stringify({ text: updatedText, meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now } }))
          loreDB[key] = updatedText
          outcomes.push({ key, old_stage: currentStage, new_stage: newStage, is_terminal: total !== null && newStage >= total })
        }

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: `Processed ${outcomes.length} entity/entities at "${locationKey}". ${skipped.length} skipped.` }],
          metadata: { retrieved: allKeys.length, written: outcomes.length },
          location_key: locationKey, outcomes, skipped
        }), 200)
      }

      // ── generate_entity ───────────────────────────────────────────────────────
      if (toolName === 'generate_entity') {
        const schema = z.object({ archetype_key: z.string().min(1), location_key: z.string().optional() })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const archetypeKey = parsed.data.archetype_key.trim().toLowerCase()
        const locationKey = parsed.data.location_key?.trim().toLowerCase()
        const rawArchetype = await kvGet(c, archetypeKey)
        if (!rawArchetype) return c.json(makeError(id, -32602, `Archetype "${archetypeKey}" not found`, null), 200)

        const { text: archetypeText } = parseKvEntry(rawArchetype)
        let entityText = archetypeText
        let retrieved = 1

        if (locationKey) {
          const rawLoc = await kvGet(c, locationKey)
          retrieved++
          if (rawLoc) {
            const locDanger = extractFieldFromText(parseKvEntry(rawLoc).text, 'Danger-Level')
            if (typeof locDanger === 'number') {
              const currentW1 = extractFieldFromText(entityText, 'Weight-1')
              if (typeof currentW1 === 'number') {
                entityText = updateFieldInText(entityText, 'Weight-1', Math.min(1, parseFloat((currentW1 + locDanger * 0.05).toPrecision(6))))
              }
            }
          }
          entityText = updateFieldInText(entityText, 'Location', locationKey)
        }

        const now = new Date().toISOString()
        entityText = updateFieldInText(entityText, 'Generated-At', now)
        entityText = updateFieldInText(entityText, 'Archetype', archetypeKey)
        const newEntityKey = `entity:${(archetypeKey.split(':').pop() ?? 'entity')}-${Date.now()}`
        await kvPut(c, newEntityKey, JSON.stringify({ text: entityText, meta: { version: 1, updatedAt: now, createdAt: now, generated_from: archetypeKey } }))
        loreDB[newEntityKey] = entityText

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: `Generated entity "${newEntityKey}" from archetype "${archetypeKey}"${locationKey ? ` at "${locationKey}"` : ''}.` }],
          metadata: { retrieved, written: 1 },
          entity_key: newEntityKey, archetype_key: archetypeKey, location_key: locationKey ?? null, entity_text: entityText
        }), 200)
      }

      // ── roll_encounter ────────────────────────────────────────────────────────
      if (toolName === 'roll_encounter') {
        const schema = z.object({
          location_key: z.string().min(1),
          threat_level: z.number().int().min(1).max(10).default(5),
        })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const locationKey = parsed.data.location_key.trim().toLowerCase()
        const threatLevel = parsed.data.threat_level
        const rawLoc = await kvGet(c, locationKey)
        if (!rawLoc) return c.json(makeError(id, -32602, `Location "${locationKey}" not found`, null), 200)

        const { text: locText } = parseKvEntry(rawLoc)
        const tableRaw = extractRawField(locText, 'Encounter-Table')
        if (!tableRaw) {
          return c.json(makeResult(id, { content: [{ type: 'text', text: `No Encounter-Table field found on "${locationKey}".` }], metadata: { retrieved: 1, written: 0 }, rolled: false }), 200)
        }

        const entries: Array<{ key: string; weight: number }> = []
        for (const part of tableRaw.split(',').map(s => s.trim()).filter(Boolean)) {
          const m = part.match(/^(.+?)\s*:\s*(\d+)$/)
          if (m) entries.push({ key: m[1].trim(), weight: parseInt(m[2]) })
          else entries.push({ key: part, weight: 1 })
        }
        if (entries.length === 0) {
          return c.json(makeResult(id, { content: [{ type: 'text', text: `Empty encounter table on "${locationKey}".` }], metadata: { retrieved: 1, written: 0 }, rolled: false }), 200)
        }

        // Higher threat_level biases toward heavier-weight entries
        const sorted = [...entries].sort((a, b) => b.weight - a.weight)
        const bias = (threatLevel - 5) * 0.1
        const adjusted = sorted.map((e, i) => ({ ...e, w: Math.max(0.1, e.weight * (1 + bias * (sorted.length - i) / sorted.length)) }))
        const total = adjusted.reduce((s, e) => s + e.w, 0)
        let roll = Math.random() * total, cum = 0, selected = adjusted[0]
        for (const e of adjusted) { cum += e.w; if (roll <= cum) { selected = e; break } }

        const archetypeKey = selected.key.startsWith('archetype:') ? selected.key : `archetype:${selected.key}`
        const rawArchetype = await kvGet(c, archetypeKey)
        if (!rawArchetype) {
          return c.json(makeResult(id, { content: [{ type: 'text', text: `Rolled "${selected.key}" but archetype "${archetypeKey}" not found.` }], metadata: { retrieved: 2, written: 0 }, rolled: true, selected_archetype: selected.key, entity_key: null }), 200)
        }

        const { text: archetypeText } = parseKvEntry(rawArchetype)
        const now = new Date().toISOString()
        let entityText = updateFieldInText(archetypeText, 'Location', locationKey)
        entityText = updateFieldInText(entityText, 'Generated-At', now)
        const newEntityKey = `entity:${(selected.key.split(':').pop() ?? 'encounter')}-${Date.now()}`
        await kvPut(c, newEntityKey, JSON.stringify({ text: entityText, meta: { version: 1, updatedAt: now, createdAt: now, rolled_encounter: true, threat_level: threatLevel } }))
        loreDB[newEntityKey] = entityText

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: `Encounter rolled at "${locationKey}" (threat: ${threatLevel}): generated "${newEntityKey}" from "${archetypeKey}".` }],
          metadata: { retrieved: 2, written: 1 },
          rolled: true, location_key: locationKey, threat_level: threatLevel,
          selected_archetype: archetypeKey, entity_key: newEntityKey, entity_text: entityText
        }), 200)
      }

      // ── get_thread_comparison ─────────────────────────────────────────────────
      if (toolName === 'get_thread_comparison') {
        const schema = z.object({ thread_a: z.string().min(1), thread_b: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const threadA = parsed.data.thread_a.trim()
        const threadB = parsed.data.thread_b.trim()
        const allKeys = await kvList(c)
        type TInfo = { key: string; timeline_value: number | null; current_date: string | null; location: string | null }
        const entitiesA: TInfo[] = [], entitiesB: TInfo[] = []

        for (const key of allKeys) {
          const raw = await kvGet(c, key)
          if (!raw) continue
          const { text } = parseKvEntry(raw)
          const tf = extractRawField(text, 'Thread')
          if (!tf) continue
          const info: TInfo = {
            key,
            timeline_value: (() => { const v = extractFieldFromText(text, 'Timeline-Value'); return typeof v === 'number' ? v : null })(),
            current_date: extractRawField(text, 'Current-Date'),
            location: extractRawField(text, 'Location'),
          }
          if (tf.trim().toLowerCase() === threadA.toLowerCase()) entitiesA.push(info)
          else if (tf.trim().toLowerCase() === threadB.toLowerCase()) entitiesB.push(info)
        }

        const avg = (arr: TInfo[]) => {
          const vals = arr.filter(e => e.timeline_value !== null).map(e => e.timeline_value!)
          return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
        }
        const avgA = avg(entitiesA), avgB = avg(entitiesB)
        const timelineOffset = avgA !== null && avgB !== null ? Math.round(Math.abs(avgA - avgB) * 10) / 10 : null

        const datesA = new Set(entitiesA.map(e => e.current_date).filter(Boolean) as string[])
        const datesB = new Set(entitiesB.map(e => e.current_date).filter(Boolean) as string[])
        const locsA = new Set(entitiesA.map(e => e.location).filter(Boolean) as string[])
        const locsB = new Set(entitiesB.map(e => e.location).filter(Boolean) as string[])

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: `Thread comparison "${threadA}" (${entitiesA.length}) vs "${threadB}" (${entitiesB.length}). Offset: ${timelineOffset ?? 'N/A'}. ${[...datesA].filter(d => datesB.has(d)).length} shared date(s), ${[...locsA].filter(l => locsB.has(l)).length} shared location(s).` }],
          metadata: { retrieved: allKeys.length, written: 0 },
          thread_a: { id: threadA, entity_count: entitiesA.length, avg_timeline: avgA !== null ? Math.round(avgA * 10) / 10 : null, entities: entitiesA },
          thread_b: { id: threadB, entity_count: entitiesB.length, avg_timeline: avgB !== null ? Math.round(avgB * 10) / 10 : null, entities: entitiesB },
          timeline_offset: timelineOffset,
          shared_dates: [...datesA].filter(d => datesB.has(d)),
          shared_locations: [...locsA].filter(l => locsB.has(l)),
        }), 200)
      }

      // ── check_convergence ─────────────────────────────────────────────────────
      if (toolName === 'check_convergence') {
        const schema = z.object({ thread_a: z.string().min(1), thread_b: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const threadA = parsed.data.thread_a.trim()
        const threadB = parsed.data.thread_b.trim()
        const allKeys = await kvList(c)
        type TInfo = { key: string; current_date: string | null; location: string | null }
        const entitiesA: TInfo[] = [], entitiesB: TInfo[] = []

        for (const key of allKeys) {
          const raw = await kvGet(c, key)
          if (!raw) continue
          const { text } = parseKvEntry(raw)
          const tf = extractRawField(text, 'Thread')
          if (!tf) continue
          const info: TInfo = { key, current_date: extractRawField(text, 'Current-Date'), location: extractRawField(text, 'Location') }
          if (tf.trim().toLowerCase() === threadA.toLowerCase()) entitiesA.push(info)
          else if (tf.trim().toLowerCase() === threadB.toLowerCase()) entitiesB.push(info)
        }

        const datesA = new Set(entitiesA.map(e => e.current_date).filter(Boolean) as string[])
        const datesB = new Set(entitiesB.map(e => e.current_date).filter(Boolean) as string[])
        const locsA = new Set(entitiesA.map(e => e.location).filter(Boolean) as string[])
        const locsB = new Set(entitiesB.map(e => e.location).filter(Boolean) as string[])
        const sharedDates = [...datesA].filter(d => datesB.has(d))
        const sharedLocations = [...locsA].filter(l => locsB.has(l))
        const canConverge = sharedDates.length > 0 || sharedLocations.length > 0

        const framing = canConverge
          ? `Threads "${threadA}" and "${threadB}" can converge via ${sharedDates.length > 0 ? `shared date(s): ${sharedDates.join(', ')}` : ''}${sharedDates.length > 0 && sharedLocations.length > 0 ? ' and ' : ''}${sharedLocations.length > 0 ? `shared location(s): ${sharedLocations.join(', ')}` : ''}.`
          : `No convergence points found between "${threadA}" and "${threadB}".`

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: framing }],
          metadata: { retrieved: allKeys.length, written: 0 },
          can_converge: canConverge, thread_a: threadA, thread_b: threadB,
          shared_dates: sharedDates, shared_locations: sharedLocations,
          entity_overlap: { a_entities: entitiesA.map(e => e.key), b_entities: entitiesB.map(e => e.key) },
          framing
        }), 200)
      }

      // ── get_sensory_profile ───────────────────────────────────────────────────
      if (toolName === 'get_sensory_profile') {
        const schema = z.object({ entity_key: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const entityKey = parsed.data.entity_key.trim().toLowerCase()
        const raw = await kvGet(c, entityKey)
        if (!raw) return c.json(makeError(id, -32602, `Entity "${entityKey}" not found`, null), 200)

        const { text } = parseKvEntry(raw)
        const speciesKey = (extractRawField(text, 'Species') ?? extractRawField(text, 'Type'))?.trim().toLowerCase() ?? null
        let speciesText = ''
        let retrieved = 1
        if (speciesKey) {
          const rawSpecies = await kvGet(c, speciesKey)
          if (rawSpecies) { speciesText = parseKvEntry(rawSpecies).text; retrieved++ }
        }

        const get = (f: string) => extractRawField(text, f) ?? (speciesText ? extractRawField(speciesText, f) : null)
        const profile = {
          temperature: get('Temperature') ?? get('Temperature-Range'),
          scent: get('Scent') ?? get('Scent-Profile'),
          texture: get('Texture') ?? get('Surface-Texture'),
          sound_signature: get('Sound-Signature') ?? get('Sound') ?? get('Audio-Signature'),
          visual_descriptors: get('Visual-Descriptors') ?? get('Appearance') ?? get('Description'),
        }
        const hasProfile = Object.values(profile).some(v => v !== null)

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: hasProfile ? `Sensory profile for "${entityKey}": ${[profile.temperature && `temp:${profile.temperature}`, profile.scent && `scent:${profile.scent}`, profile.texture && `texture:${profile.texture}`].filter(Boolean).join(', ')}.` : `No sensory profile fields found for "${entityKey}".` }],
          metadata: { retrieved, written: 0 },
          entity_key: entityKey, species: speciesKey, profile
        }), 200)
      }

      // ── get_compatibility ─────────────────────────────────────────────────────
      if (toolName === 'get_compatibility') {
        const schema = z.object({ entity_a: z.string().min(1), entity_b: z.string().min(1), interaction_type: z.string().min(1) })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const keyA = parsed.data.entity_a.trim().toLowerCase()
        const keyB = parsed.data.entity_b.trim().toLowerCase()
        const interactionType = parsed.data.interaction_type
        const [rawA, rawB] = await Promise.all([kvGet(c, keyA), kvGet(c, keyB)])
        if (!rawA) return c.json(makeError(id, -32602, `Entity "${keyA}" not found`, null), 200)
        if (!rawB) return c.json(makeError(id, -32602, `Entity "${keyB}" not found`, null), 200)

        const { text: textA } = parseKvEntry(rawA)
        const { text: textB } = parseKvEntry(rawB)
        const constraints: string[] = []
        let riskScore = 0

        const sizeA = extractFieldFromText(textA, 'Size') ?? extractFieldFromText(textA, 'Size-Class')
        const sizeB = extractFieldFromText(textB, 'Size') ?? extractFieldFromText(textB, 'Size-Class')
        let sizeRatio: number | null = null
        if (typeof sizeA === 'number' && typeof sizeB === 'number' && sizeB > 0) {
          sizeRatio = Math.round((sizeA / sizeB) * 100) / 100
          if (sizeRatio < 0.5) constraints.push(`Size ratio ${sizeRatio}: entity_a significantly smaller than entity_b`)
          if (sizeRatio > 5) { constraints.push(`Size ratio ${sizeRatio}: entity_a far exceeds entity_b capacity`); riskScore += 2 }
        }

        const w1A = extractFieldFromText(textA, 'Weight-1')
        const w2B = extractFieldFromText(textB, 'Weight-2')
        if (typeof w1A === 'number' && w1A < 0.2) { constraints.push(`Weight-1 too low (${w1A}): entity_a lacks drive`); riskScore++ }
        if (typeof w2B === 'number' && w2B > 0.9) { constraints.push(`Weight-2 very high (${w2B}): entity_b extreme resistance`); riskScore += 2 }

        const envA = extractRawField(textA, 'Environment') ?? extractRawField(textA, 'Habitat')
        const envB = extractRawField(textB, 'Environment') ?? extractRawField(textB, 'Habitat')
        if (envA && envB && !envA.toLowerCase().includes(envB.toLowerCase()) && !envB.toLowerCase().includes(envA.toLowerCase())) {
          constraints.push(`Environment mismatch: "${envA}" vs "${envB}"`); riskScore++
        }

        const blocking = constraints.filter(c => c.includes('far exceeds') || c.includes('lacks drive') || c.includes('extreme resistance'))
        const compatible = blocking.length === 0
        const riskLevel = riskScore === 0 ? 'low' : riskScore <= 2 ? 'moderate' : riskScore <= 4 ? 'high' : 'extreme'

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: `Compatibility of "${keyA}" × "${keyB}" for "${interactionType}": ${compatible ? 'COMPATIBLE' : 'INCOMPATIBLE'} (risk: ${riskLevel}). ${constraints.length} constraint(s).` }],
          metadata: { retrieved: 2, written: 0 },
          entity_a: keyA, entity_b: keyB, interaction_type: interactionType,
          compatible, risk_level: riskLevel, risk_score: riskScore, size_ratio: sizeRatio, constraints
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
