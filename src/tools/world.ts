// src/tools/world.ts
import { z } from 'zod'
import { kvGet, kvList, kvPut, loreDB } from '../lib/kv'
import { makeResult, makeError } from '../lib/rpc'
import { parseKvEntry, extractFieldFromText, updateFieldInText, extractRawField } from '../lib/lore'
import { pushHistory, appendChangelog } from '../lib/history'
import { resolveIndexedEntities } from '../lib/indexes'
import type { ToolContext } from './types'

export async function handle_thread_tick({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({ thread_id: z.string().min(1) })
  const parsed = schema.safeParse(args)
  if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

  const threadId = parsed.data.thread_id.trim()
  const { keys: threadKeys, rawValues: threadRawValues } = await resolveIndexedEntities(c, `_idx:thread:${threadId}`, 'Thread', threadId)

  // Fetch all entities for global snapshot comparison
  const allKeys = await kvList(c)
  const allRawValues = await Promise.all(allKeys.map(k => kvGet(c, k)))

  type ThreadEntity = { key: string; raw: string; text: string; meta: Record<string, unknown> }
  const threadEntities: ThreadEntity[] = []
  for (let i = 0; i < threadKeys.length; i++) {
    const raw = threadRawValues[i]
    if (!raw) continue
    const key = threadKeys[i]
    const { text, meta } = parseKvEntry(raw)
    threadEntities.push({ key, raw, text, meta })
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
    await kvPut(c, entity.key, JSON.stringify({ text: updatedText, meta: { version, updatedAt: now, createdAt: entity.meta.createdAt ?? now, thread_tick: threadId } }))
    await appendChangelog(c, entity.key, version)
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
    for (let i = 0; i < allKeys.length; i++) {
      const key = allKeys[i]
      if (threadEntityKeys.has(key)) continue
      const raw = allRawValues[i]
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
    : `Thread "${threadId}" ticked: ${local_shifts.length} entity/entities decremented. entities_ticked: ${local_shifts.length}. ${global_snapshot.length} global entity/entities on shared dates.`

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: summaryText }],
    metadata: { thread_id: threadId, entities_ticked: local_shifts.length, global_entities: global_snapshot.length },
    local_shifts,
    global_snapshot
  }), 200)
}

export async function handle_get_relationship({ c, id, args }: ToolContext): Promise<Response> {
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

export async function handle_get_faction_standing({ c, id, args }: ToolContext): Promise<Response> {
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
  const explicitMatch = factionText.toLowerCase().includes(entityNamePart.toLowerCase()) ||
    (extractRawField(entityText, 'Faction') ?? '').toLowerCase().includes(factionNamePart)
  const tagsField = (extractRawField(entityText, 'Tags') ?? '').toLowerCase()
  const tagMatch = tagsField.split(/[,\s]+/).some(t => t.trim() === `faction:${factionNamePart}`)
  const isMember = explicitMatch || tagMatch
  const membershipSource = !isMember ? null : tagMatch && !explicitMatch ? 'tag' : 'explicit'

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Standing of "${entityKey}" in "${factionKey}": ${isMember ? 'member' : 'non-member'}${rank ? `, rank: ${rank}` : ''}.` }],
    metadata: { retrieved: 2, written: 0 },
    standing: {
      entity_key: entityKey, faction_key: factionKey, is_member: isMember,
      membership_source: membershipSource,
      rank: rank ?? null,
      reputation: typeof reputation === 'number' ? reputation : null,
      debt: typeof debt === 'number' ? debt : null,
      threat_level: typeof threatLevel === 'number' ? threatLevel : null,
    }
  }), 200)
}

export async function handle_get_entity_knowledge({ c, id, args }: ToolContext): Promise<Response> {
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

export async function handle_get_location_occupants({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({ location_key: z.string().min(1) })
  const parsed = schema.safeParse(args)
  if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

  const locationKey = parsed.data.location_key.trim().toLowerCase()

  const { keys: entityKeys, rawValues } = await resolveIndexedEntities(c, `_idx:location:${locationKey}`, 'Location', locationKey)

  const occupants: Array<{ key: string; status: string | null }> = []
  for (let i = 0; i < entityKeys.length; i++) {
    const raw = rawValues[i]
    if (!raw) continue
    const key = entityKeys[i]
    const { text } = parseKvEntry(raw)
    occupants.push({ key, status: extractRawField(text, 'Status') ?? null })
  }

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: occupants.length > 0 ? `${occupants.length} occupant(s) at "${locationKey}": ${occupants.map(o => o.key).join(', ')}.` : `No occupants found at "${locationKey}".` }],
    metadata: { retrieved: entityKeys.length, written: 0 },
    location_key: locationKey, occupants
  }), 200)
}

export async function handle_get_reachable_locations({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({ origin_key: z.string().min(1) })
  const parsed = schema.safeParse(args)
  if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

  const originKey = parsed.data.origin_key.trim().toLowerCase()
  const rawOrigin = await kvGet(c, originKey)
  if (!rawOrigin) return c.json(makeError(id, -32602, `Location "${originKey}" not found`, null), 200)

  const { text } = parseKvEntry(rawOrigin)
  const exitsRaw = extractRawField(text, 'Exits') ?? extractRawField(text, 'Connections') ?? extractRawField(text, 'Routes')
  const yamlExitKeys = [...text.matchAll(/^\s*-\s+target:\s+(\S+)/gim)].map(m => m[1].toLowerCase())
  const inlineExitKeys = exitsRaw ? exitsRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : []
  const exitKeys = yamlExitKeys.length > 0 ? yamlExitKeys : inlineExitKeys

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

export async function handle_sense_environment({ c, id, args }: ToolContext): Promise<Response> {
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

export async function handle_get_thread_comparison({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({ thread_a: z.string().min(1), thread_b: z.string().min(1) })
  const parsed = schema.safeParse(args)
  if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

  const threadA = parsed.data.thread_a.trim()
  const threadB = parsed.data.thread_b.trim()
  const { keys: keysA, rawValues: rawValuesA } = await resolveIndexedEntities(c, `_idx:thread:${threadA}`, 'Thread', threadA)
  const { keys: keysB, rawValues: rawValuesB } = await resolveIndexedEntities(c, `_idx:thread:${threadB}`, 'Thread', threadB)
  type TInfo = { key: string; timeline_value: number | null; current_date: string | null; location: string | null }
  const entitiesA: TInfo[] = [], entitiesB: TInfo[] = []

  for (let i = 0; i < keysA.length; i++) {
    const raw = rawValuesA[i]
    if (!raw) continue
    const key = keysA[i]
    const { text } = parseKvEntry(raw)
    const info: TInfo = {
      key,
      timeline_value: (() => { const v = extractFieldFromText(text, 'Timeline-Value'); return typeof v === 'number' ? v : null })(),
      current_date: extractRawField(text, 'Current-Date'),
      location: extractRawField(text, 'Location'),
    }
    entitiesA.push(info)
  }

  for (let i = 0; i < keysB.length; i++) {
    const raw = rawValuesB[i]
    if (!raw) continue
    const key = keysB[i]
    const { text } = parseKvEntry(raw)
    const info: TInfo = {
      key,
      timeline_value: (() => { const v = extractFieldFromText(text, 'Timeline-Value'); return typeof v === 'number' ? v : null })(),
      current_date: extractRawField(text, 'Current-Date'),
      location: extractRawField(text, 'Location'),
    }
    entitiesB.push(info)
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
    metadata: { retrieved: keysA.length + keysB.length, written: 0 },
    thread_a: { id: threadA, entity_count: entitiesA.length, avg_timeline: avgA !== null ? Math.round(avgA * 10) / 10 : null, entities: entitiesA },
    thread_b: { id: threadB, entity_count: entitiesB.length, avg_timeline: avgB !== null ? Math.round(avgB * 10) / 10 : null, entities: entitiesB },
    timeline_offset: timelineOffset,
    shared_dates: [...datesA].filter(d => datesB.has(d)),
    shared_locations: [...locsA].filter(l => locsB.has(l)),
  }), 200)
}

export async function handle_check_convergence({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({ thread_a: z.string().min(1), thread_b: z.string().min(1) })
  const parsed = schema.safeParse(args)
  if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

  const threadA = parsed.data.thread_a.trim()
  const threadB = parsed.data.thread_b.trim()
  const { keys: keysA, rawValues: rawValuesA } = await resolveIndexedEntities(c, `_idx:thread:${threadA}`, 'Thread', threadA)
  const { keys: keysB, rawValues: rawValuesB } = await resolveIndexedEntities(c, `_idx:thread:${threadB}`, 'Thread', threadB)
  type TInfo = { key: string; current_date: string | null; location: string | null }
  const entitiesA: TInfo[] = [], entitiesB: TInfo[] = []

  for (let i = 0; i < keysA.length; i++) {
    const raw = rawValuesA[i]
    if (!raw) continue
    const key = keysA[i]
    const { text } = parseKvEntry(raw)
    const info: TInfo = { key, current_date: extractRawField(text, 'Current-Date'), location: extractRawField(text, 'Location') }
    entitiesA.push(info)
  }

  for (let i = 0; i < keysB.length; i++) {
    const raw = rawValuesB[i]
    if (!raw) continue
    const key = keysB[i]
    const { text } = parseKvEntry(raw)
    const info: TInfo = { key, current_date: extractRawField(text, 'Current-Date'), location: extractRawField(text, 'Location') }
    entitiesB.push(info)
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
    metadata: { retrieved: keysA.length + keysB.length, written: 0 },
    can_converge: canConverge, thread_a: threadA, thread_b: threadB,
    shared_dates: sharedDates, shared_locations: sharedLocations,
    entity_overlap: { a_entities: entitiesA.map(e => e.key), b_entities: entitiesB.map(e => e.key) },
    framing
  }), 200)
}

export async function handle_get_world_state({ c, id }: ToolContext): Promise<Response> {
  const keys = await kvList(c)
  const raws = await Promise.all(keys.map(k => kvGet(c, k)))
  const threads = new Set<string>()
  const locations = new Set<string>()
  let characterCount = 0
  for (let i = 0; i < keys.length; i++) {
    const raw = raws[i]
    if (!raw) continue
    const key = keys[i]
    if (key.startsWith('character:')) characterCount++
    const { text } = parseKvEntry(raw)
    const thread = extractRawField(text, 'Thread')
    const location = extractRawField(text, 'Location')
    if (thread) threads.add(thread)
    if (location) locations.add(location)
  }
  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `World state: ${keys.length} entries, ${characterCount} characters, ${threads.size} thread(s), ${locations.size} location(s).` }],
    metadata: { retrieved: keys.length, written: 0 },
    total_entries: keys.length,
    character_count: characterCount,
    active_threads: [...threads],
    known_locations: [...locations],
  }), 200)
}
