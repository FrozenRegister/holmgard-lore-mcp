// src/tools/meta.ts
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { kvGet, kvList, kvPut, getKV, loreDB } from '../lib/kv'
import { makeResult, makeError } from '../lib/rpc'
import { parseKvEntry, extractFieldFromText, extractRawField, updateFieldInText, levenshteinDistance, matchesWorld } from '../lib/lore'
import { pushHistory, appendChangelog } from '../lib/history'
import { getIndexedKeys, updateIndexes } from '../lib/indexes'
import { CHANGELOG_KEY } from '../constants'
import type { TypedToolContext } from './types'

// Event/changelog handler schemas (PR 1)
export const appendEventSchema = z.object({
  entity_key: z.string().min(1).optional(),
  verb: z.string().min(1).optional(),
  object: z.string().optional(),
  location: z.string().optional(),
  thread: z.string().optional(),
  detail: z.string().optional(),
  at: z.string().optional(),
  world_id: z.string().min(1),
  entity_id: z.string().optional(),
  date: z.string().optional(),
  description: z.string().optional(),
}).transform(args => ({
  ...args,
  entity_key: args.entity_key,
  verb: args.verb,
  at: args.at || args.date,
  detail: args.detail || args.description,
}))
  .pipe(z.object({
    entity_key: z.string().min(1),
    verb: z.string().min(1),
    object: z.string().optional(),
    location: z.string().optional(),
    thread: z.string().optional(),
    detail: z.string().optional(),
    at: z.string().optional(),
    world_id: z.string().min(1),
    entity_id: z.string().optional(),
  }))

export const canonizeSchema = z.object({ event_id: z.string().min(1) })

export const migrateEventsSchema = z.object({ world_id: z.string().min(1) })

export const getEventLogSchema = z.object({
  entity_key: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
  entity_id:  z.string().optional(),
  world_id:   z.string().optional(),
  thread_id:  z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  thread: z.string().optional(),
  verbs: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(500).default(50),
})

export const recentChangesSchema = z.object({
  since: z.string().optional(),
  key_prefix: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(30),
})

// Setup/continuity handler schemas (PR 2)
export const tagTopicSchema = z.object({
  key: z.string().min(1),
  add: z.array(z.string()).optional(),
  remove: z.array(z.string()).optional(),
})

export const findByTagSchema = z.object({
  tags: z.array(z.string().min(1)).min(1),
  mode: z.enum(['any', 'all']).default('any'),
  with_excerpt: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(20),
})

export const listTagsSchema = z.object({
  prefix: z.string().optional(),
  with_counts: z.boolean().default(true),
  limit: z.number().int().min(1).max(500).default(200),
})

export const bookmarkStateSchema = z.object({
  name: z.string().min(1),
  key_prefix: z.string().optional(),
  note: z.string().optional(),
})

export const worldDiffSchema = z.object({
  from: z.string().min(1),
  to: z.string().optional(),
  detail: z.enum(['summary', 'fields', 'text']).default('summary'),
  key_prefix: z.string().optional(),
})

export const plantSetupSchema = z.object({
  id: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  planted_in: z.string().optional(),
  tension: z.number().int().min(1).max(5).optional(),
  expected_in: z.string().optional(),
  actors: z.array(z.string()).optional(),
  setup_id: z.string().optional(),
  thread: z.string().optional(),
}).transform(args => ({
  ...args,
  id: args.id || args.setup_id,
}))
  .pipe(z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    planted_in: z.string().optional(),
    tension: z.number().int().min(1).max(5).optional(),
    expected_in: z.string().optional(),
    actors: z.array(z.string()).optional(),
    thread: z.string().optional(),
  }))

export const payOffSetupSchema = z.object({
  id: z.string().min(1),
  resolution: z.string().min(1),
  paid_in: z.string().optional(),
  status: z.enum(['paid', 'abandoned', 'deferred']).default('paid'),
})

export const listUnpaidSetupsSchema = z.object({
  actor: z.string().optional(),
  scope: z.enum(['scene', 'chapter', 'story']).optional(),
  min_tension: z.number().int().min(1).max(5).optional(),
})

export const setGoalSchema = z.object({
  entity_key: z.string().min(1).optional(),
  goal_id: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  parent: z.string().optional(),
  status: z.enum(['active', 'blocked', 'achieved', 'abandoned']).default('active'),
  obstacle: z.string().optional(),
  entity_name: z.string().optional(),
  goal_name: z.string().optional(),
  goal_description: z.string().optional(),
}).transform(args => ({
  ...args,
  entity_key: args.entity_key || args.entity_name,
  goal_id: args.goal_id || args.goal_name,
  description: args.description || args.goal_description,
}))
  .pipe(z.object({
    entity_key: z.string().min(1),
    goal_id: z.string().min(1),
    description: z.string().min(1),
    parent: z.string().optional(),
    status: z.enum(['active', 'blocked', 'achieved', 'abandoned']).default('active'),
    obstacle: z.string().optional(),
  }))

const SEVERITY_FLOOR_ALIASES: Record<string, 'info' | 'warn' | 'error'> = {
  low: 'info', medium: 'warn', moderate: 'warn', high: 'error', critical: 'error',
}

export const checkContinuitySchema = z.object({
  scope: z.string().optional(),
  // Freeform **World:** field filter (#259) — narrows cross-world KV noise
  // separately from `scope` (a key-prefix filter). Not a D1 world_id FK;
  // see matchesWorld() in lib/lore.ts.
  world: z.string().optional(),
  checks: z.array(z.enum(['dangling', 'occupancy', 'knowledge', 'inventory'])).optional(),
  severity_floor: z.string().default('info'),
  auto_fix: z.boolean().optional(),
}).transform(args => ({
  ...args,
  severity_floor: (SEVERITY_FLOOR_ALIASES[args.severity_floor] ?? args.severity_floor) as 'info' | 'warn' | 'error'
})).pipe(z.object({
  scope: z.string().optional(),
  world: z.string().optional(),
  checks: z.array(z.enum(['dangling', 'occupancy', 'knowledge', 'inventory'])).optional(),
  severity_floor: z.enum(['info', 'warn', 'error']),
  auto_fix: z.boolean().optional(),
}))

export async function handle_append_event({ c, id, args }: TypedToolContext<typeof appendEventSchema>): Promise<Response> {
  const entityKey = args.entity_key.trim().toLowerCase()
  const eventsKey = `events:${entityKey}`
  const now = args.at ?? new Date().toISOString()

  const newEvent: Record<string, string> = { at: now, verb: args.verb }
  if (args.object !== undefined) newEvent.object = args.object
  if (args.location !== undefined) newEvent.location = args.location
  if (args.thread !== undefined) newEvent.thread = args.thread
  if (args.detail !== undefined) newEvent.detail = args.detail

  // D1 primary path — world_id is now required by schema
  let d1EventId: string | null = null
  if (!c.env.RPG_DB) {
    return c.json(makeError(id, -32603, 'D1 database unavailable — cannot write event', null), 200)
  }
  const db = c.env.RPG_DB

  // Validate FK constraints before INSERT
  const worldExists = await db.prepare('SELECT id FROM worlds WHERE id = ?').bind(args.world_id).first() as { id: string } | null
  if (!worldExists) {
    return c.json(makeError(id, -32602, `World not found: ${args.world_id}`, null), 200)
  }

  // Derive entity_id from entity_key when entity_id is omitted
  if (!args.entity_id) {
    const row = await db.prepare(
      'SELECT id FROM characters WHERE lore_key = ?'
    ).bind(entityKey).first() as { id: string } | null
    if (row) {
      args.entity_id = row.id
    }
  }

  if (args.entity_id) {
    const entityExists = await db.prepare('SELECT id FROM characters WHERE id = ?').bind(args.entity_id).first() as { id: string } | null
    if (!entityExists) {
      return c.json(makeError(id, -32602, `Character not found: ${args.entity_id}`, null), 200)
    }
  }

  const eventId = randomUUID()
  const createdAt = new Date().toISOString()
  try {
    await db.prepare(
      `INSERT INTO timeline_events (id, world_id, thread_id, event_at, verb, entity_id, object_entity, location_id, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      eventId,
      args.world_id,
      args.thread ?? 'main',
      now,
      args.verb,
      args.entity_id ?? null,
      args.object ?? null,
      args.location ?? null,
      args.detail ?? null,
      createdAt,
    ).run()
    d1EventId = eventId
  } catch (err) {
    const msg = String(err)
    if (msg.includes('FOREIGN KEY')) {
      return c.json(makeError(id, -32603, `Foreign key constraint violation: ${msg}`, null), 200)
    }
    throw err
  }

  const kv = getKV(c)
  let events: typeof newEvent[] = []
  if (kv) {
    try { const r = await kv.get(eventsKey); if (r) events = JSON.parse(r) } catch {
      // silently ignore if events don't exist
    }
  }

  const nowMs = new Date(now).getTime()
  const duplicate = events.some(e => {
    const diff = Math.abs(new Date(e.at).getTime() - nowMs)
    return diff <= 1000 && e.verb === newEvent.verb && e.object === newEvent.object
  })

  if (!duplicate) {
    events.unshift(newEvent)
    if (events.length > 200) events = events.slice(0, 200)
    if (kv) await kv.put(eventsKey, JSON.stringify(events))
  }

  // Update thread index if thread is specified
  if (args.thread && !duplicate) {
    await updateIndexes(c, entityKey, `**Thread:** ${args.thread}`, null)
  }

  // #370: Auto-witness — when an event has a location, all OTHER entities at that
  // location automatically gain knowledge of this event.
  const autoWitnessed: string[] = []
  if (args.location && !duplicate) {
    try {
      const locationKey = args.location.trim().toLowerCase()
      // Find occupants at this location via D1 characters table
      const { results: occupants } = await c.env.RPG_DB!.prepare(
        'SELECT id, name FROM characters WHERE current_room_id = ? AND id != ?'
      ).bind(locationKey, args.entity_id ?? '').all()

      if (d1EventId) {
        const witnessTopic = `${args.verb}${args.object ? `:${args.object}` : ''}`
        const witnessDetail = args.detail ?? ''
        for (const occ of occupants as Array<{ id: string; name: string }>) {
          const knowledgeId = randomUUID()
          try {
            await c.env.RPG_DB!.prepare(
              `INSERT OR IGNORE INTO entity_knowledge (id, entity_id, topic, knowledge_type, source, acquired_at, detail, confidence, is_current)
               VALUES (?, ?, ?, 'fact', 'witnessed', ?, ?, 90, 1)`
            ).bind(knowledgeId, occ.id, witnessTopic, now, witnessDetail).run()
            autoWitnessed.push(occ.id)
          } catch {
            // Best-effort per occupant
          }
        }
      }
    } catch {
      // Auto-witness is best-effort
    }
  }

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Event "${newEvent.verb}" appended to "${entityKey}"${duplicate ? ' (duplicate skipped)' : ''}.` }],
    metadata: { entity_key: entityKey, event_count: events.length, duplicate, d1_event_id: d1EventId, thread: args.thread, auto_witnessed: autoWitnessed.length > 0 ? autoWitnessed : undefined }
  }), 200)
}


export async function handle_canonize({ c, id, args }: TypedToolContext<typeof canonizeSchema>): Promise<Response> {
  if (!c.env.RPG_DB) return c.json(makeError(id, -32603, 'D1 database unavailable', null), 200)
  const row = await c.env.RPG_DB.prepare('SELECT id FROM timeline_events WHERE id = ?').bind(args.event_id).first() as { id: string } | null
  if (!row) return c.json(makeError(id, -32602, `Event not found: ${args.event_id}`, null), 200)
  await c.env.RPG_DB.prepare('UPDATE timeline_events SET is_canonical = 1 WHERE id = ?').bind(args.event_id).run()
  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Event "${args.event_id}" canonized.` }],
    metadata: { event_id: args.event_id, is_canonical: true }
  }), 200)
}

export async function handle_migrate_events({ c, id, args }: TypedToolContext<typeof migrateEventsSchema>): Promise<Response> {
  if (!c.env.RPG_DB) return c.json(makeError(id, -32603, 'D1 database unavailable', null), 200)

  const kv = getKV(c)
  if (!kv) return c.json(makeError(id, -32603, 'KV unavailable', null), 200)

  let cursor: string | undefined
  let migrated = 0
  let skipped = 0
  const errors: string[] = []

  do {
    const opts: KVNamespaceListOptions = { prefix: 'events:' }
    if (cursor) opts.cursor = cursor
    const list = await kv.list(opts)
    for (const key of list.keys) {
      try {
        const raw = await kv.get(key.name)
        if (!raw) { skipped++; continue }
        const evts = JSON.parse(raw) as Array<Record<string, string>>
        for (const e of evts) {
          const eventId = randomUUID()
          const createdAt = new Date().toISOString()
          await c.env.RPG_DB.prepare(
            `INSERT OR IGNORE INTO timeline_events (id, world_id, thread_id, event_at, verb, entity_id, object_entity, location_id, detail, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            eventId,
            args.world_id,
            e.thread ?? 'main',
            e.at ?? createdAt,
            e.verb ?? 'unknown',
            null,
            e.object ?? null,
            e.location ?? null,
            e.detail ?? null,
            createdAt,
          ).run()
          migrated++
        }
      } catch (ex) {
        errors.push(`${key.name}: ${ex instanceof Error ? ex.message : String(ex)}`)
        skipped++
      }
    }
    cursor = list.list_complete ? undefined : (list as any).cursor
  } while (cursor)

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Migrated ${migrated} events from KV to D1 (${skipped} keys skipped, ${errors.length} errors).` }],
    metadata: { migrated, skipped, error_count: errors.length, errors: errors.slice(0, 10) }
  }), 200)
}

export async function handle_get_event_log({ c, id, args }: TypedToolContext<typeof getEventLogSchema>): Promise<Response> {
  if (!args.entity_key && !args.entity_id && !args.world_id) {
    return c.json(makeError(id, -32602, 'Missing required param: entity_key, entity_id, or world_id'), 200)
  }

  type EventRow = { id?: string; at: string; verb: string; entity_key?: string; entity_id?: string | null; object?: string | null; location?: string | null; thread?: string | null; detail?: string | null; source?: string }
  let allEvents: EventRow[] = []

  // D1 path when world_id or entity_id provided
  if ((args.world_id || args.entity_id) && c.env.RPG_DB) {
    const db = c.env.RPG_DB
    const parts: string[] = ['SELECT * FROM timeline_events WHERE 1=1']
    const binds: unknown[] = []
    if (args.world_id)  { parts.push('AND world_id = ?');   binds.push(args.world_id) }
    if (args.entity_id) { parts.push('AND entity_id = ?');  binds.push(args.entity_id) }
    if (args.thread_id ?? args.thread) { parts.push('AND thread_id = ?'); binds.push(args.thread_id ?? args.thread) }
    if (args.since)     { parts.push('AND event_at >= ?'); binds.push(args.since) }
    if (args.until)     { parts.push('AND event_at <= ?'); binds.push(args.until) }
    parts.push('ORDER BY event_at DESC LIMIT ?'); binds.push(args.limit)
    const rows = await db.prepare(parts.join(' ')).bind(...binds).all() as { results: Array<Record<string, unknown>> }
    for (const r of rows.results) {
      allEvents.push({ id: r.id as string, at: r.event_at as string, verb: r.verb as string, entity_id: r.entity_id as string | null, object: r.object_entity as string | null, location: r.location_id as string | null, thread: r.thread_id as string | null, detail: r.detail as string | null, source: 'd1' })
    }
  }

  // KV path (entity_key-based, for backward compat and when D1 not used)
  if (args.entity_key !== undefined) {
    const keys = Array.isArray(args.entity_key) ? args.entity_key : [args.entity_key]
    const kv = getKV(c)
    const kvArrays = await Promise.all(keys.map(async (ek) => {
      const cleanKey = ek.trim().toLowerCase()
      if (!kv) return []
      try {
        const raw = await kv.get(`events:${cleanKey}`)
        if (raw) {
          const evts = JSON.parse(raw) as Array<Record<string, string>>
          return evts.map(e => ({ ...e, entity_key: cleanKey, source: 'kv' } as EventRow))
        }
      } catch {
        // silently ignore
      }
      return []
    }))
    allEvents = [...allEvents, ...kvArrays.flat()]
  }

  // Deduplicate by at+verb when both sources are present
  const seen = new Set<string>()
  allEvents = allEvents.filter(e => {
    const key = `${e.at}|${e.verb}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (args.since && !args.world_id) {
    const sinceMs = new Date(args.since).getTime()
    if (!isNaN(sinceMs)) allEvents = allEvents.filter(e => new Date(e.at).getTime() >= sinceMs)
  }
  if (args.until && !args.world_id) {
    const untilMs = new Date(args.until).getTime()
    if (!isNaN(untilMs)) allEvents = allEvents.filter(e => new Date(e.at).getTime() <= untilMs)
  }
  if (args.thread && !args.world_id) {
    const t = args.thread.toLowerCase()
    allEvents = allEvents.filter(e => e.thread?.toLowerCase() === t)
  }
  if (args.verbs && args.verbs.length > 0) {
    const verbSet = new Set(args.verbs.map((v: string) => v.toLowerCase()))
    allEvents = allEvents.filter(e => verbSet.has(e.verb.toLowerCase()))
  }

  allEvents.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  const limited = allEvents.slice(0, args.limit)

  const summaryText = limited.length > 0
    ? limited.map(e => `[${e.at}] ${e.entity_key ?? e.entity_id ?? '?'}: ${e.verb}${e.object ? ` → ${e.object}` : ''}${e.detail ? ` (${e.detail})` : ''}`).join('\n')
    : 'No events found.'

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: summaryText }],
    metadata: { total: allEvents.length, returned: limited.length, d1_count: allEvents.filter(e => (e as any).source === 'd1').length, kv_count: allEvents.filter(e => (e as any).source === 'kv').length },
    events: limited
  }), 200)
}

export async function handle_recent_changes({ c, id, args }: TypedToolContext<typeof recentChangesSchema>): Promise<Response> {
  const kv = getKV(c)
  let entries: Array<{ key: string; version: number; updatedAt: string; op: string }> = []
  if (kv) {
    try { const raw = await kv.get(CHANGELOG_KEY); if (raw) entries = JSON.parse(raw) } catch {
      // silently ignore if changelog doesn't exist
    }
  }

  if (args.since) {
    const sinceMs = new Date(args.since).getTime()
    if (!isNaN(sinceMs)) entries = entries.filter(e => new Date(e.updatedAt).getTime() > sinceMs)
  }
  if (args.key_prefix) {
    const prefix = args.key_prefix.toLowerCase()
    entries = entries.filter(e => e.key.startsWith(prefix))
  }

  entries = [...entries].reverse().slice(0, args.limit)

  const summaryText = entries.length > 0
    ? entries.map(e => `[${e.updatedAt}] ${e.op} ${e.key} v${e.version}`).join('\n')
    : 'No changes found.'

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: summaryText }],
    metadata: { count: entries.length },
    changes: entries
  }), 200)
}


export async function handle_tag_topic({ c, id, args }: TypedToolContext<typeof tagTopicSchema>): Promise<Response> {
  const topicKey = args.key.trim().toLowerCase()
  const toAdd = args.add ?? []
  const toRemove = args.remove ?? []
  if (toAdd.length === 0 && toRemove.length === 0) {
    return c.json(makeResult(id, { content: [{ type: 'text', text: 'No add or remove tags specified.' }], metadata: { key: topicKey, tags: [] } }), 200)
  }

  const raw = await kvGet(c, topicKey)
  if (!raw) return c.json(makeError(id, -32602, `Topic "${topicKey}" not found`, null), 200)

  const { text, meta } = parseKvEntry(raw)
  const existingTagsRaw = extractRawField(text, 'Tags')
  const existingTags = new Set<string>(
    existingTagsRaw ? existingTagsRaw.split(',').map((t: string) => t.trim()).filter(Boolean) : []
  )

  for (const tag of toAdd) existingTags.add(tag.trim())
  for (const tag of toRemove) existingTags.delete(tag.trim())
  const newTagsStr = [...existingTags].join(', ')

  let updatedText: string
  if (existingTagsRaw !== null) {
    updatedText = text.replace(/(\*\*Tags:\*\*\s*)([^\n]+)/i, `$1${newTagsStr}`)
  } else {
    updatedText = text + (text.endsWith('\n') ? '' : '\n') + `**Tags:** ${newTagsStr}`
  }

  await pushHistory(c, topicKey, raw)
  const now = new Date().toISOString()
  const version = typeof meta.version === 'number' ? meta.version + 1 : 1
  await kvPut(c, topicKey, JSON.stringify({ text: updatedText, meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now } }))
  await appendChangelog(c, topicKey, version)
  loreDB[topicKey] = updatedText

  const kv = getKV(c)
  if (kv) {
    for (const tag of toAdd) {
      const tagKey = `_tags:${tag.trim()}`
      let tagKeys: string[] = []
      try { const r = await kv.get(tagKey); if (r) tagKeys = JSON.parse(r) } catch {
        // silently ignore if tags don't exist
      }
      if (!tagKeys.includes(topicKey)) { tagKeys.push(topicKey); await kv.put(tagKey, JSON.stringify(tagKeys)) }
    }
    for (const tag of toRemove) {
      const tagKey = `_tags:${tag.trim()}`
      let tagKeys: string[] = []
      try { const r = await kv.get(tagKey); if (r) tagKeys = JSON.parse(r) } catch {
        // silently ignore if tags don't exist
      }
      tagKeys = tagKeys.filter((k: string) => k !== topicKey)
      if (tagKeys.length > 0) await kv.put(tagKey, JSON.stringify(tagKeys))
      else await kv.delete(tagKey)
    }
  }

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Tags updated for "${topicKey}": [${newTagsStr}]` }],
    metadata: { key: topicKey, tags: [...existingTags], version }
  }), 200)
}

export async function handle_find_by_tag({ c, id, args }: TypedToolContext<typeof findByTagSchema>): Promise<Response> {
  const kv = getKV(c)
  const tagKeysets: Set<string>[] = []
  for (const tag of args.tags) {
    let keys: string[] = []
    if (kv) {
      try { const r = await kv.get(`_tags:${tag.trim()}`); if (r) keys = JSON.parse(r) } catch {
        // silently ignore
      }
    }
    tagKeysets.push(new Set(keys))
  }

  let resultKeys: string[]
  if (args.mode === 'all') {
    resultKeys = tagKeysets.length > 0
      ? [...tagKeysets[0]].filter(k => tagKeysets.every(s => s.has(k)))
      : []
  } else {
    const union = new Set<string>()
    for (const s of tagKeysets) for (const k of s) union.add(k)
    resultKeys = [...union]
  }

  resultKeys = resultKeys.slice(0, args.limit)

  const results = await Promise.all(resultKeys.map(async (key) => {
    const entry: { key: string; excerpt?: string } = { key }
    if (args.with_excerpt) {
      const r = await kvGet(c, key)
      if (r) {
        const { text } = parseKvEntry(r)
        entry.excerpt = text.slice(0, 120) + (text.length > 120 ? '…' : '')
      }
    }
    return entry
  }))

  const summaryText = results.length > 0
    ? results.map(r => r.key + (r.excerpt ? `: "${r.excerpt}"` : '')).join('\n')
    : `No topics found with tag${args.tags.length > 1 ? 's' : ''} [${args.tags.join(', ')}].`

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: summaryText }],
    metadata: { tags: args.tags, mode: args.mode, count: results.length },
    results
  }), 200)
}

export async function handle_list_tags({ c, id, args }: TypedToolContext<typeof listTagsSchema>): Promise<Response> {
  const kv = getKV(c)
  const tags: Array<{ tag: string; count: number }> = []

  if (!kv) {
    return c.json(makeError(id, -32603, 'KV storage unavailable', null), 200)
  }

  try {
    let cursor: string | undefined
    let collected = 0

    do {
      const listOptions: any = { prefix: '_tags:' }
      if (cursor) listOptions.cursor = cursor
      const result: any = await kv.list(listOptions)

      for (const key of result.keys) {
        if (collected >= args.limit) break
        const tagName = key.name.slice('_tags:'.length)
        if (args.prefix && !tagName.startsWith(args.prefix)) continue

        if (args.with_counts) {
          try {
            const raw = await kv.get(key.name)
            const count = raw ? JSON.parse(raw).length : 0
            tags.push({ tag: tagName, count })
          } catch {
            tags.push({ tag: tagName, count: 0 })
          }
        } else {
          tags.push({ tag: tagName, count: 0 })
        }
        collected++
      }

      if (collected >= args.limit) break
      cursor = result.list_complete ? undefined : result.cursor
    } while (cursor)
  } catch (e) {
    console.error('Error listing tags', e)
    return c.json(makeError(id, -32603, 'Error listing tags', { error: e instanceof Error ? e.message : String(e) }), 200)
  }

  if (args.with_counts) {
    tags.sort((a, b) => b.count - a.count)
  } else {
    tags.sort((a, b) => a.tag.localeCompare(b.tag))
  }

  const summaryText = tags.length > 0
    ? tags.map(t => `${t.tag}${args.with_counts ? ` (${t.count})` : ''}`).join(', ')
    : 'No tags found.'

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: summaryText }],
    metadata: { count: tags.length, with_counts: args.with_counts, prefix: args.prefix || null },
    tags
  }), 200)
}

export async function handle_bookmark_state({ c, id, args }: TypedToolContext<typeof bookmarkStateSchema>): Promise<Response> {
  const snapshotName = args.name.trim()
  const allKeys = await kvList(c)
  const scopedKeys = args.key_prefix
    ? allKeys.filter(k => k.startsWith(args.key_prefix!))
    : allKeys

  const scopedRaws = await Promise.all(scopedKeys.map(k => kvGet(c, k)))

  const manifest: Record<string, { version: number | null; updatedAt: string | null }> = {}
  for (let i = 0; i < scopedKeys.length; i++) {
    const r = scopedRaws[i]
    if (!r) continue
    const key = scopedKeys[i]
    const { meta } = parseKvEntry(r)
    manifest[key] = {
      version: typeof meta.version === 'number' ? meta.version : null,
      updatedAt: typeof meta.updatedAt === 'string' ? meta.updatedAt : null
    }
  }

  const snapshot = { name: snapshotName, note: args.note ?? null, created_at: new Date().toISOString(), key_count: scopedKeys.length, manifest }
  const kv = getKV(c)
  if (kv) await kv.put(`_snapshot:${snapshotName}`, JSON.stringify(snapshot))

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Snapshot "${snapshotName}" created with ${scopedKeys.length} key(s).` }],
    metadata: { name: snapshotName, key_count: scopedKeys.length, created_at: snapshot.created_at }
  }), 200)
}

export async function handle_world_diff({ c, id, args }: TypedToolContext<typeof worldDiffSchema>): Promise<Response> {
  type ManifestEntry = { version: number | null; updatedAt: string | null }
  const kv = getKV(c)
  let fromManifest: Record<string, ManifestEntry> = {}
  let fromLabel = args.from

  if (kv) {
    try {
      const rawSnap = await kv.get(`_snapshot:${args.from}`)
      if (rawSnap) { const snap = JSON.parse(rawSnap); fromManifest = snap.manifest ?? {}; fromLabel = `snapshot:${args.from} (${snap.created_at})` }
    } catch {
      // silently ignore if snapshot doesn't exist
    }
  }

  let toManifest: Record<string, ManifestEntry> = {}
  let toLabel = 'now'

  if (args.to && kv) {
    try {
      const rawSnap = await kv.get(`_snapshot:${args.to}`)
      if (rawSnap) { const snap = JSON.parse(rawSnap); toManifest = snap.manifest ?? {}; toLabel = `snapshot:${args.to} (${snap.created_at})` }
    } catch {
      // silently ignore if snapshot doesn't exist
    }
  } else if (!args.to) {
    const allKeys = await kvList(c)
    const scopedKeys = args.key_prefix ? allKeys.filter(k => k.startsWith(args.key_prefix!)) : allKeys
    const scopedRaws = await Promise.all(scopedKeys.map(k => kvGet(c, k)))
    for (let i = 0; i < scopedKeys.length; i++) {
      const r = scopedRaws[i]
      if (!r) continue
      const key = scopedKeys[i]
      const { meta } = parseKvEntry(r)
      toManifest[key] = { version: typeof meta.version === 'number' ? meta.version : null, updatedAt: typeof meta.updatedAt === 'string' ? meta.updatedAt : null }
    }
  }

  if (args.key_prefix) {
    const prefix = args.key_prefix
    for (const k of Object.keys(fromManifest)) if (!k.startsWith(prefix)) delete fromManifest[k]
    for (const k of Object.keys(toManifest)) if (!k.startsWith(prefix)) delete toManifest[k]
  }

  const fromKeys = new Set(Object.keys(fromManifest))
  const toKeys = new Set(Object.keys(toManifest))
  const added = [...toKeys].filter(k => !fromKeys.has(k))
  const removed = [...fromKeys].filter(k => !toKeys.has(k))

  const changed: Array<any> = []
  const sharedKeys = [...fromKeys].filter(k => toKeys.has(k))
  const changedKeys = sharedKeys.filter(k => {
    const f = fromManifest[k], t = toManifest[k]
    return f.version !== t.version || f.updatedAt !== t.updatedAt
  })

  if (args.detail !== 'summary') {
    const detailRaws = await Promise.all(changedKeys.map(k => kvGet(c, k)))
    changedKeys.forEach((k, i) => {
      const f = fromManifest[k], t = toManifest[k]
      const entry: any = { key: k, from_version: f.version, to_version: t.version, from_at: f.updatedAt, to_at: t.updatedAt }
      const r = detailRaws[i]
      if (r) entry.current_text = parseKvEntry(r).text.slice(0, 500)
      changed.push(entry)
    })
  } else {
    for (const k of changedKeys) {
      const f = fromManifest[k], t = toManifest[k]
      changed.push({ key: k, from_version: f.version, to_version: t.version, from_at: f.updatedAt, to_at: t.updatedAt })
    }
  }

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Diff "${fromLabel}" → "${toLabel}": ${added.length} added, ${removed.length} removed, ${changed.length} changed.` }],
    metadata: { from: fromLabel, to: toLabel, added_count: added.length, removed_count: removed.length, changed_count: changed.length },
    added, removed, changed
  }), 200)
}

export async function handle_plant_setup({ c, id, args }: TypedToolContext<typeof plantSetupSchema>): Promise<Response> {
  const setupKey = `setup:${args.id.trim()}`
  const now = new Date().toISOString()
  const tension = args.tension ?? 3

  const lines = [
    `**Description:** ${args.description}`,
    `**Status:** open`,
    `**Tension:** ${tension}`,
    `**Created-At:** ${now}`,
  ]
  if (args.planted_in) lines.push(`**Planted-In:** ${args.planted_in}`)
  if (args.expected_in) lines.push(`**Expected-In:** ${args.expected_in}`)
  if (args.actors && args.actors.length > 0) lines.push(`**Actors:** ${args.actors.join(', ')}`)
  if (args.thread) lines.push(`**Thread:** ${args.thread}`)
  const text = lines.join('\n')

  const existingRaw = await kvGet(c, setupKey)
  if (existingRaw) await pushHistory(c, setupKey, existingRaw)
  const existingMeta = existingRaw ? parseKvEntry(existingRaw).meta : {}
  const version = typeof existingMeta.version === 'number' ? existingMeta.version + 1 : 1

  await kvPut(c, setupKey, JSON.stringify({ text, meta: { version, updatedAt: now, createdAt: existingMeta.createdAt ?? now } }))
  await updateIndexes(c, setupKey, text, existingRaw ? parseKvEntry(existingRaw).text : null)
  await appendChangelog(c, setupKey, version)
  loreDB[setupKey] = text

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Setup "${args.id}" planted (tension: ${tension}).` }],
    metadata: { key: setupKey, version, tension }
  }), 200)
}

export async function handle_pay_off_setup({ c, id, args }: TypedToolContext<typeof payOffSetupSchema>): Promise<Response> {
  const setupKey = `setup:${args.id.trim()}`
  const raw = await kvGet(c, setupKey)
  if (!raw) return c.json(makeError(id, -32602, `Setup "${args.id}" not found`, null), 200)

  const { text, meta } = parseKvEntry(raw)
  let updatedText = text.replace(/(\*\*Status:\*\*\s*)(\w+)/i, `$1${args.status}`)

  const now = new Date().toISOString()
  if (!updatedText.includes('**Resolution:**')) {
    updatedText += `\n**Resolution:** ${args.resolution}`
    if (args.paid_in) updatedText += `\n**Paid-In:** ${args.paid_in}`
    updatedText += `\n**Closed-At:** ${now}`
  } else {
    updatedText = updatedText.replace(/(\*\*Resolution:\*\*\s*)([^\n]+)/i, `$1${args.resolution}`)
  }

  await pushHistory(c, setupKey, raw)
  const version = typeof meta.version === 'number' ? meta.version + 1 : 1
  await kvPut(c, setupKey, JSON.stringify({ text: updatedText, meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now } }))
  await updateIndexes(c, setupKey, updatedText, text)
  await appendChangelog(c, setupKey, version)
  loreDB[setupKey] = updatedText

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Setup "${args.id}" marked as ${args.status}.` }],
    metadata: { key: setupKey, status: args.status, version }
  }), 200)
}

export async function handle_list_unpaid_setups({ c, id, args }: TypedToolContext<typeof listUnpaidSetupsSchema>): Promise<Response> {
  const setupKeys = await getIndexedKeys(c, '_idx:prefix:setup')
  const setupRaws = await Promise.all(setupKeys.map(k => kvGet(c, k)))
  type SetupEntry = { id: string; key: string; description: string; tension: number; planted_in: string | null; expected_in: string | null; actors: string[]; created_at: string | null }
  const openSetups: SetupEntry[] = []

  for (let i = 0; i < setupKeys.length; i++) {
    const r = setupRaws[i]
    if (!r) continue
    const key = setupKeys[i]
    const { text } = parseKvEntry(r)

    const status = extractRawField(text, 'Status')?.toLowerCase()
    if (status !== 'open') continue

    const tension = (() => { const v = extractFieldFromText(text, 'Tension'); return typeof v === 'number' ? Math.round(v) : 3 })()
    if (args.min_tension !== undefined && tension < args.min_tension) continue

    const actorsRaw = extractRawField(text, 'Actors') ?? ''
    const actors = actorsRaw ? actorsRaw.split(',').map((s: string) => s.trim()).filter(Boolean) : []

    if (args.actor) {
      if (!actors.some((a: string) => a.toLowerCase().includes(args.actor!.toLowerCase()))) continue
    }

    const expectedIn = extractRawField(text, 'Expected-In')
    if (args.scope && expectedIn) {
      if (!expectedIn.toLowerCase().includes(args.scope.toLowerCase())) continue
    }

    openSetups.push({
      id: key.replace(/^setup:/, ''),
      key,
      description: extractRawField(text, 'Description') ?? text.slice(0, 100),
      tension,
      planted_in: extractRawField(text, 'Planted-In'),
      expected_in: expectedIn,
      actors,
      created_at: extractRawField(text, 'Created-At'),
    })
  }

  openSetups.sort((a, b) => {
    if (b.tension !== a.tension) return b.tension - a.tension
    const aMs = a.created_at ? new Date(a.created_at).getTime() : 0
    const bMs = b.created_at ? new Date(b.created_at).getTime() : 0
    return aMs - bMs
  })

  const summaryText = openSetups.length > 0
    ? openSetups.map(s => `[T${s.tension}] ${s.id}: ${s.description}`).join('\n')
    : 'No open setups found.'

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: summaryText }],
    metadata: { count: openSetups.length },
    setups: openSetups
  }), 200)
}

export async function handle_set_goal({ c, id, args }: TypedToolContext<typeof setGoalSchema>): Promise<Response> {
  const entityKey = args.entity_key.trim().toLowerCase()
  const raw = await kvGet(c, entityKey)
  if (!raw) return c.json(makeError(id, -32602, `Entity "${entityKey}" not found`, null), 200)

  const { text, meta } = parseKvEntry(raw)
  const goalId = args.goal_id.trim()

  const parts = [args.status, args.description]
  if (args.obstacle) parts.push(`obstacle: ${args.obstacle}`)
  if (args.parent) parts.push(`parent: ${args.parent}`)
  const goalLine = `**Goal:${goalId}:** ${parts.join(' | ')}`

  const escapedField = `Goal:${goalId}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const existingMatch = text.match(new RegExp(`\\*\\*${escapedField}:\\*\\*[^\\n]*`, 'i'))

  const updatedText = existingMatch
    ? text.replace(existingMatch[0], goalLine)
    : text + (text.endsWith('\n') ? '' : '\n') + goalLine

  await pushHistory(c, entityKey, raw)
  const now = new Date().toISOString()
  const version = typeof meta.version === 'number' ? meta.version + 1 : 1
  await kvPut(c, entityKey, JSON.stringify({ text: updatedText, meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now } }))
  await appendChangelog(c, entityKey, version)
  loreDB[entityKey] = updatedText

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Goal "${goalId}" set on "${entityKey}" (${args.status}).` }],
    metadata: { entity_key: entityKey, goal_id: goalId, status: args.status, version }
  }), 200)
}

function normalizeLocation(locStr: string): string {
  return locStr.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

export async function handle_check_continuity({ c, id, args }: TypedToolContext<typeof checkContinuitySchema>): Promise<Response> {
  const activeChecks = args.checks ?? ['dangling', 'occupancy', 'knowledge', 'inventory']
  const allKeys = await kvList(c)
  const scopeFilteredKeys = args.scope
    ? allKeys.filter(k => k.startsWith(args.scope!) || k.includes(args.scope!))
    : allKeys
  const scopeFilteredRaws = await Promise.all(scopeFilteredKeys.map(k => kvGet(c, k)))

  // World filtering (#259) narrows which entries get scanned/reported, but
  // deliberately does NOT shrink allKeySet below — a dangling/occupancy
  // reference should still resolve against every world's keys, since the
  // referenced entity existing in another world is a different problem
  // (or no problem at all) from it not existing anywhere.
  let scopedKeys = scopeFilteredKeys
  let scopedRaws = scopeFilteredRaws
  if (args.world) {
    const keepIdx: number[] = []
    for (let i = 0; i < scopeFilteredKeys.length; i++) {
      const raw = scopeFilteredRaws[i]
      if (raw && matchesWorld(parseKvEntry(raw).text, args.world)) keepIdx.push(i)
    }
    scopedKeys = keepIdx.map(i => scopeFilteredKeys[i])
    scopedRaws = keepIdx.map(i => scopeFilteredRaws[i])
  }

  const allKeySet = new Set(allKeys)

  type Finding = { key: string; check: string; severity: 'info' | 'warn' | 'error'; message: string }
  const findings: Finding[] = []

  // Pre-fetch all unique location keys for the occupancy check
  const locationNamesToFetch = new Set<string>()
  if (activeChecks.includes('occupancy')) {
    for (let i = 0; i < scopedKeys.length; i++) {
      const r = scopedRaws[i]
      if (!r || !scopedKeys[i].startsWith('character:')) continue
      const { text } = parseKvEntry(r)
      const loc = extractRawField(text, 'Location')
      if (loc) {
        const locName = loc.replace(/^location:\s*/i, '')
        const normalized = normalizeLocation(locName)
        locationNamesToFetch.add(normalized)
      }
    }
  }
  const allLocationKeys = allKeys.filter(k => k.startsWith('location:'))
  const locationNormalizedMap = new Map<string, boolean>()
  for (const locKey of allLocationKeys) {
    const locName = locKey.replace(/^location:\s*/i, '')
    const normalized = normalizeLocation(locName)
    locationNormalizedMap.set(normalized, true)
  }

  for (let i = 0; i < scopedKeys.length; i++) {
    const r = scopedRaws[i]
    if (!r) continue
    const key = scopedKeys[i]
    const { text } = parseKvEntry(r)

    if (activeChecks.includes('dangling')) {
      const refs = text.match(/\b(character|location|item|faction|scene|archetype):[a-z0-9:_-]+/gi) ?? []
      for (const ref of refs) {
        const refKey = ref.toLowerCase()
        if (refKey !== key && !allKeySet.has(refKey)) {
          findings.push({ key, check: 'dangling', severity: 'warn', message: `References "${refKey}" which does not exist.` })
        }
      }
    }

    if (activeChecks.includes('occupancy') && key.startsWith('character:')) {
      const locationField = extractRawField(text, 'Location')
      if (locationField) {
        const locName = locationField.replace(/^location:\s*/i, '')
        const normalized = normalizeLocation(locName)
        if (!locationNormalizedMap.get(normalized)) {
          findings.push({ key, check: 'occupancy', severity: 'warn', message: `Location field "${locationField}" does not exist.` })
        }
      }
    }

    if (activeChecks.includes('inventory') && (key.startsWith('character:') || key.startsWith('entity:'))) {
      const inventoryField = extractRawField(text, 'Inventory') ?? extractRawField(text, 'Items')
      if (inventoryField) {
        const itemRefs = inventoryField.match(/\b(item|weapon|armor):[a-z0-9:_-]+/gi) ?? []
        for (const itemRef of itemRefs) {
          const itemKey = itemRef.toLowerCase()
          if (!allKeySet.has(itemKey)) {
            findings.push({ key, check: 'inventory', severity: 'info', message: `Inventory references "${itemKey}" which does not exist.` })
          }
        }
      }
    }
  }

  const severityOrder: Record<string, number> = { info: 0, warn: 1, error: 2 }
  const floorLevel = severityOrder[args.severity_floor]
  const filtered = findings.filter(f => severityOrder[f.severity] >= floorLevel)

  if (!args.auto_fix) {
    const summaryText = filtered.length > 0
      ? `${filtered.length} continuity issue(s) found:\n` + filtered.slice(0, 20).map(f => `[${f.severity.toUpperCase()}] ${f.key}: ${f.message}`).join('\n')
      : 'No continuity issues found.'

    return c.json(makeResult(id, {
      content: [{ type: 'text', text: summaryText }],
      metadata: { scanned: scopedKeys.length, issue_count: filtered.length, world: args.world ?? null },
      findings: filtered
    }), 200)
  }

  // auto_fix: dangling and occupancy findings can be repaired unambiguously
  // (test-key cleanup, single-candidate typo correction, location fallback).
  // knowledge/inventory findings need entity-by-entity judgment and are always skipped.
  type Fix = { key: string; check: string; action: string; detail: string }
  type Skip = { key: string; check: string; reason: string }
  const fixes: Fix[] = []
  const skips: Skip[] = []

  const rawByKey = new Map(scopedKeys.map((k, i) => [k, scopedRaws[i]]))
  const findingsByKey = new Map<string, Finding[]>()
  for (const f of filtered) {
    if (!findingsByKey.has(f.key)) findingsByKey.set(f.key, [])
    findingsByKey.get(f.key)!.push(f)
  }

  for (const [key, keyFindings] of findingsByKey) {
    const raw = rawByKey.get(key)
    if (!raw) continue
    const { text: originalText, meta } = parseKvEntry(raw)
    let text = originalText
    let changed = false

    for (const f of keyFindings) {
      if (f.check === 'knowledge' || f.check === 'inventory') {
        skips.push({ key, check: f.check, reason: 'requires entity-by-entity judgment' })
        continue
      }

      if (f.check === 'dangling') {
        const badRef = f.message.match(/References "([^"]+)"/)?.[1]
        if (!badRef) { skips.push({ key, check: f.check, reason: 'could not parse reference' }); continue }
        const escaped = badRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

        if (/(^|:)test[-:]/i.test(badRef)) {
          const before = text
          text = text.replace(new RegExp(escaped, 'gi'), '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
          if (text !== before) {
            changed = true
            fixes.push({ key, check: f.check, action: 'removed_test_reference', detail: `Removed test-key reference "${badRef}"` })
          } else {
            skips.push({ key, check: f.check, reason: 'reference not found in text' })
          }
          continue
        }

        const candidates = allKeys.filter(k => k !== key && levenshteinDistance(k, badRef) < 3)
        if (candidates.length === 1) {
          text = text.replace(new RegExp(escaped, 'gi'), candidates[0])
          changed = true
          fixes.push({ key, check: f.check, action: 'typo_correction', detail: `Corrected "${badRef}" → "${candidates[0]}"` })
        } else if (candidates.length > 1) {
          skips.push({ key, check: f.check, reason: `ambiguous: ${candidates.length} close matches` })
        } else {
          skips.push({ key, check: f.check, reason: 'no confident match found' })
        }
      } else if (f.check === 'occupancy') {
        const badLoc = f.message.match(/Location field "([^"]+)"/)?.[1]
        if (!badLoc) { skips.push({ key, check: f.check, reason: 'could not parse location' }); continue }

        const badLocName = badLoc.replace(/^location:\s*/i, '')
        const badLocNorm = normalizeLocation(badLocName)
        const candidates = allLocationKeys.filter(k => {
          const locName = k.replace(/^location:\s*/i, '')
          const locNorm = normalizeLocation(locName)
          return levenshteinDistance(locNorm, badLocNorm) < 3
        })
        if (candidates.length === 1) {
          text = updateFieldInText(text, 'Location', candidates[0])
          changed = true
          fixes.push({ key, check: f.check, action: 'typo_correction', detail: `Corrected Location "${badLoc}" → "${candidates[0]}"` })
        } else if (candidates.length > 1) {
          skips.push({ key, check: f.check, reason: `ambiguous: ${candidates.length} close matches` })
        } else {
          text = updateFieldInText(text, 'Location', 'location:unknown')
          changed = true
          fixes.push({ key, check: f.check, action: 'fallback_unknown', detail: `Set Location "${badLoc}" → "location:unknown"` })
        }
      }
    }

    if (changed) {
      await pushHistory(c, key, raw)
      const now = new Date().toISOString()
      const version = typeof meta.version === 'number' ? meta.version + 1 : 1
      await kvPut(c, key, JSON.stringify({ text, meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now } }))
      await appendChangelog(c, key, version)
      loreDB[key] = text
    }
  }

  const summaryText = `Auto-fix: ${fixes.length} fixed, ${skips.length} skipped (of ${filtered.length} issue(s) found).`

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: summaryText }],
    metadata: { scanned: scopedKeys.length, issue_count: filtered.length, fixed: fixes.length, skipped: skips.length },
    findings: filtered,
    fixed: fixes.length,
    skipped: skips.length,
    fixes,
    skips
  }), 200)
}