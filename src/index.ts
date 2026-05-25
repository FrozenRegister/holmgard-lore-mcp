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
            name: 'resolve_interaction', title: 'Resolve Interaction', version: '0.1.0',
            description: 'Determine the outcome of an entity interaction via weighted probability. Reads Weight-1 from entity_a and Weight-2 from entity_b, computes P(success) = (W1×0.7)−(W2×0.3), rolls against it, and returns a boolean outcome with state delta. Atomically increments entity_a State-Level on success.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                entity_a_id: { type: 'string', description: 'Lore key of the acting entity (must have **Weight-1:** field)', minLength: 1 },
                entity_b_id: { type: 'string', description: 'Lore key of the opposing entity (must have **Weight-2:** field)', minLength: 1 },
                action_type: { type: 'string', description: 'Label for the action being attempted (e.g. "consume", "resist")', minLength: 1 }
              },
              required: ['entity_a_id', 'entity_b_id', 'action_type'], additionalProperties: false
            },
            examples: [{ arguments: { entity_a_id: 'character:predator', entity_b_id: 'character:prey', action_type: 'consume' } }]
          },
          {
            name: 'analyze_utility', title: 'Analyze Utility', version: '0.1.0',
            description: 'Quantify an entity\'s value against a specific objective vector. Scans the entity\'s numeric lore fields and applies vector-specific weights to produce a grade (S–D), projected yield narrative, and compatibility percentage.',
            inputSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
              properties: {
                entity_id: { type: 'string', description: 'Lore key of the entity to analyse', minLength: 1 },
                utility_vector: {
                  type: 'string',
                  enum: ['VECTOR_A', 'VECTOR_B', 'VECTOR_C', 'VECTOR_D', 'VECTOR_E'],
                  description: 'Objective vector: A=direct output, B=support/multiplier, C=precision, D=endurance, E=balanced'
                }
              },
              required: ['entity_id', 'utility_vector'], additionalProperties: false
            },
            examples: [{ arguments: { entity_id: 'character:target', utility_vector: 'VECTOR_A' } }]
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
          utility_vector: z.enum(['VECTOR_A', 'VECTOR_B', 'VECTOR_C', 'VECTOR_D', 'VECTOR_E'])
        })
        const parsed = schema.safeParse(args)
        if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

        const key = parsed.data.entity_id.trim().toLowerCase()
        const vector = parsed.data.utility_vector

        const raw = await kvGet(c, key)
        if (!raw) return c.json(makeError(id, -32602, `Entity "${key}" not found`, null), 200)

        const { text } = parseKvEntry(raw)

        const numericFields: Array<{ name: string; value: number }> = []
        const fieldRegex = /^\*\*([^:*]+):\*\*\s*(-?\d+(?:\.\d+)?)/gim
        let fMatch
        while ((fMatch = fieldRegex.exec(text)) !== null && numericFields.length < 4) {
          numericFields.push({ name: fMatch[1].trim(), value: parseFloat(fMatch[2]) })
        }

        const f = [0, 1, 2, 3].map(i => numericFields[i]?.value ?? 0)
        const vectorWeights: Record<string, [number, number, number, number]> = {
          VECTOR_A: [0.50, 0.30, 0.15, 0.05],
          VECTOR_B: [0.05, 0.50, 0.15, 0.30],
          VECTOR_C: [0.35, 0.15, 0.40, 0.10],
          VECTOR_D: [0.10, 0.20, 0.60, 0.10],
          VECTOR_E: [0.25, 0.25, 0.25, 0.25],
        }
        const weights = vectorWeights[vector]
        const maxFieldValue = Math.max(...f, 1)
        const normalizedF = f.map(v => Math.max(0, (v / maxFieldValue) * 100))
        const rawScore = weights.reduce((sum, w, i) => sum + w * normalizedF[i], 0)
        const score = Math.round(Math.min(100, Math.max(0, rawScore)))

        const grade = score >= 80 ? 'Grade S' : score >= 65 ? 'Grade A' : score >= 50 ? 'Grade B' : score >= 35 ? 'Grade C' : 'Grade D'
        const yieldLabels: Record<string, string> = {
          VECTOR_A: 'High direct output, low efficiency overhead.',
          VECTOR_B: 'Moderate yield with strong multiplier potential.',
          VECTOR_C: 'Precision yield — low variance, context-dependent.',
          VECTOR_D: 'Long-duration yield, high sustainability index.',
          VECTOR_E: 'Balanced yield across all operational domains.',
        }

        return c.json(makeResult(id, {
          content: [{ type: 'text', text: `Utility analysis for "${key}" (${vector}): ${grade} — ${score}% compatibility` }],
          metadata: { entity_id: key, utility_vector: vector, fields_analyzed: numericFields.map(f => f.name), raw_score: score },
          grade,
          projected_yield: yieldLabels[vector],
          compatibility_score: `${score}%`
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
