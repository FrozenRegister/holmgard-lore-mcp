// src/tools/meta.ts
import { z } from 'zod'
import { kvGet, kvList, kvPut, getKV, loreDB } from '../lib/kv'
import { makeResult, makeError } from '../lib/rpc'
import { invalidParamsError } from '../lib/errors'
import { applyAliases } from '../lib/aliases'
import { parseKvEntry, extractFieldFromText, extractRawField } from '../lib/lore'
import { pushHistory, appendChangelog } from '../lib/history'
import { getIndexedKeys } from '../lib/indexes'
import { CHANGELOG_KEY } from '../constants'
import type { ToolContext } from './types'

export async function handle_append_event({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({
    entity_key: z.string().min(1),
    verb: z.string().min(1),
    object: z.string().optional(),
    location: z.string().optional(),
    thread: z.string().optional(),
    detail: z.string().optional(),
    at: z.string().optional(),
  })
  const normalized = applyAliases(args, { date: 'at', description: 'detail' })
  const parsed = schema.safeParse(normalized)
  if (!parsed.success) {
    return c.json(invalidParamsError(id, 'continuity_manage', parsed.error, {
      action: 'append_event', entity_key: 'character:eira-holt', verb: 'departed', object: 'marsh-end', detail: 'Household begins journey', at: '1264-05-01T00:00:00Z'
    }), 200)
  }

  const entityKey = parsed.data.entity_key.trim().toLowerCase()
  const eventsKey = `events:${entityKey}`
  const now = parsed.data.at ?? new Date().toISOString()

  const newEvent: Record<string, string> = { at: now, verb: parsed.data.verb }
  if (parsed.data.object !== undefined) newEvent.object = parsed.data.object
  if (parsed.data.location !== undefined) newEvent.location = parsed.data.location
  if (parsed.data.thread !== undefined) newEvent.thread = parsed.data.thread
  if (parsed.data.detail !== undefined) newEvent.detail = parsed.data.detail

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

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Event "${newEvent.verb}" appended to "${entityKey}"${duplicate ? ' (duplicate skipped)' : ''}.` }],
    metadata: { entity_key: entityKey, event_count: events.length, duplicate }
  }), 200)
}

export async function handle_get_event_log({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({
    entity_key: z.union([z.string().min(1), z.array(z.string().min(1))]),
    since: z.string().optional(),
    until: z.string().optional(),
    thread: z.string().optional(),
    verbs: z.array(z.string()).optional(),
    limit: z.number().int().min(1).max(500).default(50),
  })
  const parsed = schema.safeParse(args)
  if (!parsed.success) {
    return c.json(invalidParamsError(id, 'continuity_manage', parsed.error, {
      action: 'get_event_log', entity_key: 'character:eira-holt', limit: 20
    }), 200)
  }

  const keys = Array.isArray(parsed.data.entity_key) ? parsed.data.entity_key : [parsed.data.entity_key]
  const kv = getKV(c)

  const eventArrays = await Promise.all(keys.map(async (ek) => {
    const cleanKey = ek.trim().toLowerCase()
    if (!kv) return []
    try {
      const raw = await kv.get(`events:${cleanKey}`)
      if (raw) {
        const evts = JSON.parse(raw) as Array<any>
        return evts.map((e: any) => ({ ...e, entity_key: cleanKey }))
      }
    } catch {
      // silently ignore if events don't exist
    }
    return []
  }))
  let allEvents: Array<any> = eventArrays.flat()

  if (parsed.data.since) {
    const sinceMs = new Date(parsed.data.since).getTime()
    if (!isNaN(sinceMs)) allEvents = allEvents.filter(e => new Date(e.at).getTime() >= sinceMs)
  }
  if (parsed.data.until) {
    const untilMs = new Date(parsed.data.until).getTime()
    if (!isNaN(untilMs)) allEvents = allEvents.filter(e => new Date(e.at).getTime() <= untilMs)
  }
  if (parsed.data.thread) {
    const t = parsed.data.thread.toLowerCase()
    allEvents = allEvents.filter(e => e.thread?.toLowerCase() === t)
  }
  if (parsed.data.verbs && parsed.data.verbs.length > 0) {
    const verbSet = new Set(parsed.data.verbs.map((v: string) => v.toLowerCase()))
    allEvents = allEvents.filter(e => verbSet.has(e.verb.toLowerCase()))
  }

  allEvents.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  const limited = allEvents.slice(0, parsed.data.limit)

  const summaryText = limited.length > 0
    ? limited.map(e => `[${e.at}] ${e.entity_key}: ${e.verb}${e.object ? ` → ${e.object}` : ''}${e.detail ? ` (${e.detail})` : ''}`).join('\n')
    : 'No events found.'

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: summaryText }],
    metadata: { total: allEvents.length, returned: limited.length },
    events: limited
  }), 200)
}

export async function handle_recent_changes({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({
    since: z.string().optional(),
    key_prefix: z.string().optional(),
    limit: z.number().int().min(1).max(200).default(30),
  })
  const parsed = schema.safeParse(args)
  if (!parsed.success) {
    return c.json(invalidParamsError(id, 'continuity_manage', parsed.error, {
      action: 'recent_changes', key_prefix: 'character', limit: 20
    }), 200)
  }

  const kv = getKV(c)
  let entries: Array<{ key: string; version: number; updatedAt: string; op: string }> = []
  if (kv) {
    try { const raw = await kv.get(CHANGELOG_KEY); if (raw) entries = JSON.parse(raw) } catch {
      // silently ignore if changelog doesn't exist
    }
  }

  if (parsed.data.since) {
    const sinceMs = new Date(parsed.data.since).getTime()
    if (!isNaN(sinceMs)) entries = entries.filter(e => new Date(e.updatedAt).getTime() > sinceMs)
  }
  if (parsed.data.key_prefix) {
    const prefix = parsed.data.key_prefix.toLowerCase()
    entries = entries.filter(e => e.key.startsWith(prefix))
  }

  entries = [...entries].reverse().slice(0, parsed.data.limit)

  const summaryText = entries.length > 0
    ? entries.map(e => `[${e.updatedAt}] ${e.op} ${e.key} v${e.version}`).join('\n')
    : 'No changes found.'

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: summaryText }],
    metadata: { count: entries.length },
    changes: entries
  }), 200)
}

export async function handle_tag_topic({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({
    key: z.string().min(1),
    add: z.array(z.string()).optional(),
    remove: z.array(z.string()).optional(),
  })
  const parsed = schema.safeParse(args)
  if (!parsed.success) {
    return c.json(invalidParamsError(id, 'continuity_manage', parsed.error, {
      action: 'tag_topic', key: 'character:eira-holt', add: ['needs-review']
    }), 200)
  }

  const topicKey = parsed.data.key.trim().toLowerCase()
  const toAdd = parsed.data.add ?? []
  const toRemove = parsed.data.remove ?? []
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

export async function handle_find_by_tag({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({
    tags: z.array(z.string().min(1)).min(1),
    mode: z.enum(['any', 'all']).default('any'),
    with_excerpt: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).default(20),
  })
  const parsed = schema.safeParse(args)
  if (!parsed.success) {
    return c.json(invalidParamsError(id, 'continuity_manage', parsed.error, {
      action: 'find_by_tag', tags: ['needs-review'], mode: 'any'
    }), 200)
  }

  const kv = getKV(c)
  const tagKeysets: Set<string>[] = []
  for (const tag of parsed.data.tags) {
    let keys: string[] = []
    if (kv) {
      try { const r = await kv.get(`_tags:${tag.trim()}`); if (r) keys = JSON.parse(r) } catch {
        // silently ignore
      }
    }
    tagKeysets.push(new Set(keys))
  }

  let resultKeys: string[]
  if (parsed.data.mode === 'all') {
    resultKeys = tagKeysets.length > 0
      ? [...tagKeysets[0]].filter(k => tagKeysets.every(s => s.has(k)))
      : []
  } else {
    const union = new Set<string>()
    for (const s of tagKeysets) for (const k of s) union.add(k)
    resultKeys = [...union]
  }

  resultKeys = resultKeys.slice(0, parsed.data.limit)

  const results = await Promise.all(resultKeys.map(async (key) => {
    const entry: { key: string; excerpt?: string } = { key }
    if (parsed.data.with_excerpt) {
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
    : `No topics found with tag${parsed.data.tags.length > 1 ? 's' : ''} [${parsed.data.tags.join(', ')}].`

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: summaryText }],
    metadata: { tags: parsed.data.tags, mode: parsed.data.mode, count: results.length },
    results
  }), 200)
}

export async function handle_list_tags({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({
    prefix: z.string().optional(),
    with_counts: z.boolean().default(true),
    limit: z.number().int().min(1).max(500).default(200),
  })
  const parsed = schema.safeParse(args)
  if (!parsed.success) {
    return c.json(invalidParamsError(id, 'continuity_manage', parsed.error, {
      action: 'list_tags', prefix: 'needs', with_counts: true
    }), 200)
  }

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
        if (collected >= parsed.data.limit) break
        const tagName = key.name.slice('_tags:'.length)
        if (parsed.data.prefix && !tagName.startsWith(parsed.data.prefix)) continue

        if (parsed.data.with_counts) {
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

      if (collected >= parsed.data.limit) break
      cursor = result.list_complete ? undefined : result.cursor
    } while (cursor)
  } catch (e) {
    console.error('Error listing tags', e)
    return c.json(makeError(id, -32603, 'Error listing tags', { error: e instanceof Error ? e.message : String(e) }), 200)
  }

  if (parsed.data.with_counts) {
    tags.sort((a, b) => b.count - a.count)
  } else {
    tags.sort((a, b) => a.tag.localeCompare(b.tag))
  }

  const summaryText = tags.length > 0
    ? tags.map(t => `${t.tag}${parsed.data.with_counts ? ` (${t.count})` : ''}`).join(', ')
    : 'No tags found.'

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: summaryText }],
    metadata: { count: tags.length, with_counts: parsed.data.with_counts, prefix: parsed.data.prefix || null },
    tags
  }), 200)
}

export async function handle_bookmark_state({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({
    name: z.string().min(1),
    key_prefix: z.string().optional(),
    note: z.string().optional(),
  })
  const parsed = schema.safeParse(args)
  if (!parsed.success) {
    return c.json(invalidParamsError(id, 'continuity_manage', parsed.error, {
      action: 'bookmark_state', name: 'phase-9-complete', note: 'End of phase 9'
    }), 200)
  }

  const snapshotName = parsed.data.name.trim()
  const allKeys = await kvList(c)
  const scopedKeys = parsed.data.key_prefix
    ? allKeys.filter(k => k.startsWith(parsed.data.key_prefix!))
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

  const snapshot = { name: snapshotName, note: parsed.data.note ?? null, created_at: new Date().toISOString(), key_count: scopedKeys.length, manifest }
  const kv = getKV(c)
  if (kv) await kv.put(`_snapshot:${snapshotName}`, JSON.stringify(snapshot))

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Snapshot "${snapshotName}" created with ${scopedKeys.length} key(s).` }],
    metadata: { name: snapshotName, key_count: scopedKeys.length, created_at: snapshot.created_at }
  }), 200)
}

export async function handle_world_diff({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({
    from: z.string().min(1),
    to: z.string().optional(),
    detail: z.enum(['summary', 'fields', 'text']).default('summary'),
    key_prefix: z.string().optional(),
  })
  const parsed = schema.safeParse(args)
  if (!parsed.success) {
    return c.json(invalidParamsError(id, 'continuity_manage', parsed.error, {
      action: 'world_diff', from: 'phase-9-complete', detail: 'summary'
    }), 200)
  }

  type ManifestEntry = { version: number | null; updatedAt: string | null }
  const kv = getKV(c)
  let fromManifest: Record<string, ManifestEntry> = {}
  let fromLabel = parsed.data.from

  if (kv) {
    try {
      const rawSnap = await kv.get(`_snapshot:${parsed.data.from}`)
      if (rawSnap) { const snap = JSON.parse(rawSnap); fromManifest = snap.manifest ?? {}; fromLabel = `snapshot:${parsed.data.from} (${snap.created_at})` }
    } catch {
      // silently ignore if snapshot doesn't exist
    }
  }

  let toManifest: Record<string, ManifestEntry> = {}
  let toLabel = 'now'

  if (parsed.data.to && kv) {
    try {
      const rawSnap = await kv.get(`_snapshot:${parsed.data.to}`)
      if (rawSnap) { const snap = JSON.parse(rawSnap); toManifest = snap.manifest ?? {}; toLabel = `snapshot:${parsed.data.to} (${snap.created_at})` }
    } catch {
      // silently ignore if snapshot doesn't exist
    }
  } else if (!parsed.data.to) {
    const allKeys = await kvList(c)
    const scopedKeys = parsed.data.key_prefix ? allKeys.filter(k => k.startsWith(parsed.data.key_prefix!)) : allKeys
    const scopedRaws = await Promise.all(scopedKeys.map(k => kvGet(c, k)))
    for (let i = 0; i < scopedKeys.length; i++) {
      const r = scopedRaws[i]
      if (!r) continue
      const key = scopedKeys[i]
      const { meta } = parseKvEntry(r)
      toManifest[key] = { version: typeof meta.version === 'number' ? meta.version : null, updatedAt: typeof meta.updatedAt === 'string' ? meta.updatedAt : null }
    }
  }

  if (parsed.data.key_prefix) {
    const prefix = parsed.data.key_prefix
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

  if (parsed.data.detail !== 'summary') {
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

export async function handle_plant_setup({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    planted_in: z.string().optional(),
    tension: z.number().int().min(1).max(5).optional(),
    expected_in: z.string().optional(),
    actors: z.array(z.string()).optional(),
  })
  const normalized = applyAliases(args, { setup_id: 'id' })
  const parsed = schema.safeParse(normalized)
  if (!parsed.success) {
    return c.json(invalidParamsError(id, 'continuity_manage', parsed.error, {
      action: 'plant_setup', id: 'church-ambush-foreshadow', description: 'Church courier spotted near Marsh-end canal', tension: 3, expected_in: 'phase-10'
    }), 200)
  }

  const setupKey = `setup:${parsed.data.id.trim()}`
  const now = new Date().toISOString()
  const tension = parsed.data.tension ?? 3

  const lines = [
    `**Description:** ${parsed.data.description}`,
    `**Status:** open`,
    `**Tension:** ${tension}`,
    `**Created-At:** ${now}`,
  ]
  if (parsed.data.planted_in) lines.push(`**Planted-In:** ${parsed.data.planted_in}`)
  if (parsed.data.expected_in) lines.push(`**Expected-In:** ${parsed.data.expected_in}`)
  if (parsed.data.actors && parsed.data.actors.length > 0) lines.push(`**Actors:** ${parsed.data.actors.join(', ')}`)
  const text = lines.join('\n')

  const existingRaw = await kvGet(c, setupKey)
  if (existingRaw) await pushHistory(c, setupKey, existingRaw)
  const existingMeta = existingRaw ? parseKvEntry(existingRaw).meta : {}
  const version = typeof existingMeta.version === 'number' ? existingMeta.version + 1 : 1

  await kvPut(c, setupKey, JSON.stringify({ text, meta: { version, updatedAt: now, createdAt: existingMeta.createdAt ?? now } }))
  await appendChangelog(c, setupKey, version)
  loreDB[setupKey] = text

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Setup "${parsed.data.id}" planted (tension: ${tension}).` }],
    metadata: { key: setupKey, version, tension }
  }), 200)
}

export async function handle_pay_off_setup({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({
    id: z.string().min(1),
    resolution: z.string().min(1),
    paid_in: z.string().optional(),
    status: z.enum(['paid', 'abandoned', 'deferred']).default('paid'),
  })
  const parsed = schema.safeParse(args)
  if (!parsed.success) {
    return c.json(invalidParamsError(id, 'continuity_manage', parsed.error, {
      action: 'pay_off_setup', id: 'church-ambush-foreshadow', resolution: 'Ambush occurred at the canal crossing', status: 'paid'
    }), 200)
  }

  const setupKey = `setup:${parsed.data.id.trim()}`
  const raw = await kvGet(c, setupKey)
  if (!raw) return c.json(makeError(id, -32602, `Setup "${parsed.data.id}" not found`, null), 200)

  const { text, meta } = parseKvEntry(raw)
  let updatedText = text.replace(/(\*\*Status:\*\*\s*)(\w+)/i, `$1${parsed.data.status}`)

  const now = new Date().toISOString()
  if (!updatedText.includes('**Resolution:**')) {
    updatedText += `\n**Resolution:** ${parsed.data.resolution}`
    if (parsed.data.paid_in) updatedText += `\n**Paid-In:** ${parsed.data.paid_in}`
    updatedText += `\n**Closed-At:** ${now}`
  } else {
    updatedText = updatedText.replace(/(\*\*Resolution:\*\*\s*)([^\n]+)/i, `$1${parsed.data.resolution}`)
  }

  await pushHistory(c, setupKey, raw)
  const version = typeof meta.version === 'number' ? meta.version + 1 : 1
  await kvPut(c, setupKey, JSON.stringify({ text: updatedText, meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now } }))
  await appendChangelog(c, setupKey, version)
  loreDB[setupKey] = updatedText

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Setup "${parsed.data.id}" marked as ${parsed.data.status}.` }],
    metadata: { key: setupKey, status: parsed.data.status, version }
  }), 200)
}

export async function handle_list_unpaid_setups({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({
    actor: z.string().optional(),
    scope: z.enum(['scene', 'chapter', 'story']).optional(),
    min_tension: z.number().int().min(1).max(5).optional(),
  })
  const parsed = schema.safeParse(args)
  if (!parsed.success) {
    return c.json(invalidParamsError(id, 'continuity_manage', parsed.error, {
      action: 'list_unpaid_setups', min_tension: 3
    }), 200)
  }

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
    if (parsed.data.min_tension !== undefined && tension < parsed.data.min_tension) continue

    const actorsRaw = extractRawField(text, 'Actors') ?? ''
    const actors = actorsRaw ? actorsRaw.split(',').map((s: string) => s.trim()).filter(Boolean) : []

    if (parsed.data.actor) {
      if (!actors.some((a: string) => a.toLowerCase().includes(parsed.data.actor!.toLowerCase()))) continue
    }

    const expectedIn = extractRawField(text, 'Expected-In')
    if (parsed.data.scope && expectedIn) {
      if (!expectedIn.toLowerCase().includes(parsed.data.scope.toLowerCase())) continue
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

export async function handle_set_goal({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({
    entity_key: z.string().min(1),
    goal_id: z.string().min(1),
    description: z.string().min(1),
    parent: z.string().optional(),
    status: z.enum(['active', 'blocked', 'achieved', 'abandoned']).default('active'),
    obstacle: z.string().optional(),
  })
  const normalized = applyAliases(args, { entity_name: 'entity_key', goal_name: 'goal_id', goal_description: 'description' })
  const parsed = schema.safeParse(normalized)
  if (!parsed.success) {
    return c.json(invalidParamsError(id, 'continuity_manage', parsed.error, {
      action: 'set_goal', entity_key: 'character:eira-holt', goal_id: 'survive-tribunal', description: 'Survive the Church tribunal in Novigrad on 15 Jun 1264'
    }), 200)
  }

  const entityKey = parsed.data.entity_key.trim().toLowerCase()
  const raw = await kvGet(c, entityKey)
  if (!raw) return c.json(makeError(id, -32602, `Entity "${entityKey}" not found`, null), 200)

  const { text, meta } = parseKvEntry(raw)
  const goalId = parsed.data.goal_id.trim()

  const parts = [parsed.data.status, parsed.data.description]
  if (parsed.data.obstacle) parts.push(`obstacle: ${parsed.data.obstacle}`)
  if (parsed.data.parent) parts.push(`parent: ${parsed.data.parent}`)
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
    content: [{ type: 'text', text: `Goal "${goalId}" set on "${entityKey}" (${parsed.data.status}).` }],
    metadata: { entity_key: entityKey, goal_id: goalId, status: parsed.data.status, version }
  }), 200)
}

const SEVERITY_FLOOR_ALIASES: Record<string, 'info' | 'warn' | 'error'> = {
  low: 'info', medium: 'warn', moderate: 'warn', high: 'error', critical: 'error',
}

export async function handle_check_continuity({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({
    scope: z.string().optional(),
    checks: z.array(z.enum(['dangling', 'occupancy', 'knowledge', 'inventory'])).optional(),
    severity_floor: z.enum(['info', 'warn', 'error']).default('info'),
  })
  const normalized = { ...args }
  if (typeof normalized.severity_floor === 'string' && normalized.severity_floor in SEVERITY_FLOOR_ALIASES) {
    normalized.severity_floor = SEVERITY_FLOOR_ALIASES[normalized.severity_floor]
  }
  const parsed = schema.safeParse(normalized)
  if (!parsed.success) {
    return c.json(invalidParamsError(id, 'continuity_manage', parsed.error, {
      action: 'check_continuity', scope: 'character', severity_floor: 'warn'
    }), 200)
  }

  const activeChecks = parsed.data.checks ?? ['dangling', 'occupancy', 'knowledge', 'inventory']
  const allKeys = await kvList(c)
  const scopedKeys = parsed.data.scope
    ? allKeys.filter(k => k.startsWith(parsed.data.scope!) || k.includes(parsed.data.scope!))
    : allKeys
  const scopedRaws = await Promise.all(scopedKeys.map(k => kvGet(c, k)))
  const allKeySet = new Set(allKeys)

  type Finding = { key: string; check: string; severity: 'info' | 'warn' | 'error'; message: string }
  const findings: Finding[] = []

  // Pre-fetch all unique location keys for the occupancy check
  const locationKeysToFetch = new Set<string>()
  if (activeChecks.includes('occupancy')) {
    for (let i = 0; i < scopedKeys.length; i++) {
      const r = scopedRaws[i]
      if (!r || !scopedKeys[i].startsWith('character:')) continue
      const { text } = parseKvEntry(r)
      const loc = extractRawField(text, 'Location')
      if (loc) locationKeysToFetch.add(loc.trim().toLowerCase())
    }
  }
  const locationResults = await Promise.all(
    Array.from(locationKeysToFetch).map(async locKey => ({
      key: locKey,
      exists: !!(await kvGet(c, locKey))
    }))
  )
  const locationExistsMap = new Map(locationResults.map(r => [r.key, r.exists]))

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
        const locationKey = locationField.trim().toLowerCase()
        if (!locationExistsMap.get(locationKey)) {
          findings.push({ key, check: 'occupancy', severity: 'warn', message: `Location field "${locationKey}" does not exist.` })
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
  const floorLevel = severityOrder[parsed.data.severity_floor]
  const filtered = findings.filter(f => severityOrder[f.severity] >= floorLevel)

  const summaryText = filtered.length > 0
    ? `${filtered.length} continuity issue(s) found:\n` + filtered.slice(0, 20).map(f => `[${f.severity.toUpperCase()}] ${f.key}: ${f.message}`).join('\n')
    : 'No continuity issues found.'

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: summaryText }],
    metadata: { scanned: scopedKeys.length, issue_count: filtered.length },
    findings: filtered
  }), 200)
}
