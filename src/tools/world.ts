// src/tools/world.ts
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { kvGet, kvList, kvPut, loreDB } from '../lib/kv'
import { makeResult, makeError } from '../lib/rpc'
import { applyAliases } from '../lib/aliases'
import { resolveEntityKey } from '../lib/entity-resolve'
import { parseKvEntry, extractFieldFromText, updateFieldInText, extractRawField } from '../lib/lore'
import { pushHistory, appendChangelog } from '../lib/history'
import { resolveIndexedEntities } from '../lib/indexes'
import type { ToolContext, TypedToolContext, TypedToolHandler } from './types'

// --- Schemas ---

export const threadTickSchema = z.object({ thread_id: z.string().min(1) })
export const getRelationshipSchema = z.object({
  entity_a: z.string().min(1),
  entity_b: z.string().min(1),
})
export const getFactionStandingSchema = z
  .object({
    entity_key: z.string().min(1).optional(),
    entity_name: z.string().min(1).optional(),
    faction_key: z.string().min(1).optional(),
    faction_name: z.string().min(1).optional(),
  })
  .transform((args) =>
    applyAliases(args, { entity_name: 'entity_key', faction_name: 'faction_key' }),
  )
  .pipe(
    z.object({
      entity_key: z.string().min(1),
      faction_key: z.string().min(1),
    }),
  )
export const getEntityKnowledgeSchema = z
  .object({
    entity_key: z.string().optional(),
    entity_name: z.string().optional(),
    entity_id: z.string().optional(),
    topic: z.string().min(1),
  })
  .transform((args) => applyAliases(args, { entity_name: 'entity_key' }))
  .pipe(
    z.object({
      entity_key: z.string().optional(),
      entity_id: z.string().optional(),
      topic: z.string().min(1),
    }),
  )
export const setEntityKnowledgeSchema = z.object({
  entity_id: z.string().min(1),
  topic: z.string().min(1),
  knowledge_type: z.string().default('fact'),
  acquired_at: z.string().min(1),
  detail: z.string().optional(),
  source: z.string().optional(),
  confidence: z.number().int().min(0).max(100).default(100),
})
export const learnFromEventSchema = z.object({
  entity_id: z.string().min(1),
  event_id: z.string().min(1),
})
export const migrateKnowledgeSchema = z.object({ world_id: z.string().min(1) })
export const getLocationOccupantsSchema = z
  .object({
    location_key: z.string().min(1).optional(),
    location_id: z.string().min(1).optional(),
  })
  .transform((args) => applyAliases(args, { location_id: 'location_key' }))
  .pipe(
    z.object({
      location_key: z.string().min(1),
    }),
  )
export const getReachableLocationsSchema = z.object({ origin_key: z.string().min(1) })
export const senseEnvironmentSchema = z
  .object({
    location_key: z.string().min(1),
    entity_key: z.string().min(1).optional(),
    entity_name: z.string().min(1).optional(),
  })
  .transform((args) => applyAliases(args, { entity_name: 'entity_key' }))
  .pipe(
    z.object({
      location_key: z.string().min(1),
      entity_key: z.string().min(1),
    }),
  )
export const getThreadComparisonSchema = z.object({
  thread_a: z.string().min(1),
  thread_b: z.string().min(1),
})
export const checkConvergenceSchema = z.object({
  thread_a: z.string().min(1),
  thread_b: z.string().min(1),
  world_id: z.string().min(1).optional(),
})

// --- Handlers ---

export const handle_thread_tick: TypedToolHandler<typeof threadTickSchema> = async ({
  c,
  id,
  args,
}: TypedToolContext<typeof threadTickSchema>): Promise<Response> => {
  const threadId = args.thread_id.trim()
  const { keys: threadKeys, rawValues: threadRawValues } = await resolveIndexedEntities(
    c,
    `_idx:thread:${threadId}`,
    'Thread',
    threadId,
  )

  // Fetch all entities for global snapshot comparison
  const allKeys = await kvList(c)
  const allRawValues = await Promise.all(allKeys.map((k) => kvGet(c, k)))

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
  const local_shifts: Array<{
    key: string
    old_value: number
    new_value: number
    status_change: boolean
  }> = []

  for (const entity of threadEntities) {
    const timelineValue = extractFieldFromText(entity.text, 'Timeline-Value')
    if (typeof timelineValue !== 'number') continue
    const newValue = timelineValue - 1
    const updatedText = updateFieldInText(entity.text, 'Timeline-Value', newValue)
    await pushHistory(c, entity.key, entity.raw)
    const version = typeof entity.meta.version === 'number' ? entity.meta.version + 1 : 1
    await kvPut(
      c,
      entity.key,
      JSON.stringify({
        text: updatedText,
        meta: {
          version,
          updatedAt: now,
          createdAt: entity.meta.createdAt ?? now,
          thread_tick: threadId,
        },
      }),
    )
    await appendChangelog(c, entity.key, version)
    loreDB[entity.key] = updatedText
    local_shifts.push({
      key: entity.key,
      old_value: timelineValue,
      new_value: newValue,
      status_change: timelineValue > 0 && newValue <= 0,
    })
  }

  const affectedDates = new Set<string>()
  for (const entity of threadEntities) {
    const d = extractRawField(entity.text, 'Current-Date')
    if (d) affectedDates.add(d)
  }

  const threadEntityKeys = new Set(threadEntities.map((e) => e.key))
  const global_snapshot: Array<{
    key: string
    thread: string
    current_date: string
    status: string
  }> = []

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
          status: extractRawField(text, 'Status') ?? 'unknown',
        })
      }
    }
  }

  const summaryText =
    local_shifts.length === 0
      ? `No entities with **Timeline-Value:** found for thread "${threadId}".`
      : `Thread "${threadId}" ticked: ${local_shifts.length} entity/entities decremented. entities_ticked: ${local_shifts.length}. ${global_snapshot.length} global entity/entities on shared dates.`

  return c.json(
    makeResult(id, {
      content: [{ type: 'text', text: summaryText }],
      metadata: {
        thread_id: threadId,
        entities_ticked: local_shifts.length,
        global_entities: global_snapshot.length,
      },
      local_shifts,
      global_snapshot,
    }),
    200,
  )
}

export const handle_get_relationship: TypedToolHandler<typeof getRelationshipSchema> = async ({
  c,
  id,
  args,
}: TypedToolContext<typeof getRelationshipSchema>): Promise<Response> => {
  const [resA, resB] = await Promise.all([
    resolveEntityKey(c, args.entity_a),
    resolveEntityKey(c, args.entity_b),
  ])
  if (!resA.raw) {
    return c.json(
      makeError(
        id,
        -32602,
        `Entity "${resA.key}" not found${resA.suggestion ? `. Did you mean "${resA.suggestion}"?` : '. Pass the full lore key, e.g. "character:eira-holt".'}`,
        { key: resA.key, did_you_mean: resA.suggestion },
      ),
      200,
    )
  }
  if (!resB.raw) {
    return c.json(
      makeError(
        id,
        -32602,
        `Entity "${resB.key}" not found${resB.suggestion ? `. Did you mean "${resB.suggestion}"?` : '. Pass the full lore key, e.g. "character:eira-holt".'}`,
        { key: resB.key, did_you_mean: resB.suggestion },
      ),
      200,
    )
  }
  const keyA = resA.key
  const keyB = resB.key
  const rawA = resA.raw
  const rawB = resB.raw

  const { text: textA } = parseKvEntry(rawA)
  const { text: textB } = parseKvEntry(rawB)
  const affinity = extractFieldFromText(textA, 'Affinity')
  const debt = extractFieldFromText(textA, 'Debt')
  const threatLevel = extractFieldFromText(textA, 'Threat-Level')
  const factionA = extractRawField(textA, 'Faction')
  const factionB = extractRawField(textB, 'Faction')
  const factionOverlap =
    factionA && factionB && factionA.toLowerCase() === factionB.toLowerCase() ? [factionA] : []
  const nameB = keyB.split(':').pop() ?? keyB
  const nameA = keyA.split(':').pop() ?? keyA
  const aMentionsB = textA.toLowerCase().includes(nameB.toLowerCase())
  const bMentionsA = textB.toLowerCase().includes(nameA.toLowerCase())
  const hasData =
    typeof affinity === 'number' ||
    typeof debt === 'number' ||
    aMentionsB ||
    bMentionsA ||
    factionOverlap.length > 0

  return c.json(
    makeResult(id, {
      content: [
        {
          type: 'text',
          text: hasData
            ? `Relationship data found between "${keyA}" and "${keyB}".`
            : `No relationship data found between "${keyA}" and "${keyB}".`,
        },
      ],
      metadata: { retrieved: 2, written: 0 },
      relationship: hasData
        ? {
            entity_a: keyA,
            entity_b: keyB,
            affinity: typeof affinity === 'number' ? affinity : null,
            debt: typeof debt === 'number' ? debt : null,
            threat_level: typeof threatLevel === 'number' ? threatLevel : null,
            faction_overlap: factionOverlap,
            cross_references: { a_mentions_b: aMentionsB, b_mentions_a: bMentionsA },
          }
        : null,
      suggestion: hasData
        ? null
        : `No relationship data. Create one with set_lore key="relationship:${nameA}-${nameB}".`,
    }),
    200,
  )
}

export const handle_get_faction_standing: TypedToolHandler<
  typeof getFactionStandingSchema
> = async ({
  c,
  id,
  args,
}: TypedToolContext<typeof getFactionStandingSchema>): Promise<Response> => {
  const [resEntity, resFaction] = await Promise.all([
    resolveEntityKey(c, args.entity_key),
    resolveEntityKey(c, args.faction_key),
  ])
  if (!resEntity.raw) {
    return c.json(
      makeError(
        id,
        -32602,
        `Entity "${resEntity.key}" not found${resEntity.suggestion ? `. Did you mean "${resEntity.suggestion}"?` : ''}`,
        { key: resEntity.key, did_you_mean: resEntity.suggestion },
      ),
      200,
    )
  }
  if (!resFaction.raw) {
    return c.json(
      makeError(
        id,
        -32602,
        `Faction "${resFaction.key}" not found${resFaction.suggestion ? `. Did you mean "${resFaction.suggestion}"?` : ''}`,
        { key: resFaction.key, did_you_mean: resFaction.suggestion },
      ),
      200,
    )
  }
  const entityKey = resEntity.key
  const factionKey = resFaction.key
  const rawEntity = resEntity.raw
  const rawFaction = resFaction.raw

  const { text: entityText } = parseKvEntry(rawEntity)
  const { text: factionText } = parseKvEntry(rawFaction)
  const rank = extractRawField(entityText, 'Rank')
  const reputation = extractFieldFromText(entityText, 'Reputation')
  const debt = extractFieldFromText(entityText, 'Debt')
  const threatLevel = extractFieldFromText(entityText, 'Threat-Level')
  const entityNamePart = entityKey.split(':').pop() ?? entityKey
  const factionNamePart = (factionKey.split(':').pop() ?? '').toLowerCase()
  const explicitMatch =
    factionText.toLowerCase().includes(entityNamePart.toLowerCase()) ||
    (extractRawField(entityText, 'Faction') ?? '').toLowerCase().includes(factionNamePart)
  const tagsField = (extractRawField(entityText, 'Tags') ?? '').toLowerCase()
  const tagMatch = tagsField.split(/[,\s]+/).some((t) => t.trim() === `faction:${factionNamePart}`)
  const isMember = explicitMatch || tagMatch
  const membershipSource = !isMember ? null : tagMatch && !explicitMatch ? 'tag' : 'explicit'

  return c.json(
    makeResult(id, {
      content: [
        {
          type: 'text',
          text: `Standing of "${entityKey}" in "${factionKey}": ${isMember ? 'member' : 'non-member'}${rank ? `, rank: ${rank}` : ''}.`,
        },
      ],
      metadata: { retrieved: 2, written: 0 },
      standing: {
        entity_key: entityKey,
        faction_key: factionKey,
        is_member: isMember,
        membership_source: membershipSource,
        rank: rank ?? null,
        reputation: typeof reputation === 'number' ? reputation : null,
        debt: typeof debt === 'number' ? debt : null,
        threat_level: typeof threatLevel === 'number' ? threatLevel : null,
      },
    }),
    200,
  )
}

export const handle_get_entity_knowledge: TypedToolHandler<
  typeof getEntityKnowledgeSchema
> = async ({
  c,
  id,
  args,
}: TypedToolContext<typeof getEntityKnowledgeSchema>): Promise<Response> => {
  if (!args.entity_key && !args.entity_id) {
    return c.json(makeError(id, -32602, '"entity_key" or "entity_id" is required', null), 200)
  }

  const topic = args.topic.trim().toLowerCase()

  // D1 path when entity_id is provided
  if (args.entity_id && c.env.RPG_DB) {
    const rows = (await c.env.RPG_DB.prepare(
      'SELECT * FROM entity_knowledge WHERE entity_id = ? AND topic LIKE ? AND is_current = 1 ORDER BY confidence DESC',
    )
      .bind(args.entity_id, `%${topic}%`)
      .all()) as { results: Array<Record<string, unknown>> }
    if (rows.results.length > 0) {
      return c.json(
        makeResult(id, {
          content: [
            {
              type: 'text',
              text: `"${args.entity_id}" has ${rows.results.length} knowledge record(s) matching "${topic}".`,
            },
          ],
          metadata: { retrieved: rows.results.length, written: 0, source: 'd1' },
          known: true,
          topic,
          records: rows.results,
        }),
        200,
      )
    }
    return c.json(
      makeResult(id, {
        content: [{ type: 'text', text: `"${args.entity_id}" has no D1 knowledge of "${topic}".` }],
        metadata: { retrieved: 0, written: 0, source: 'd1' },
        known: false,
        topic,
        records: [],
      }),
      200,
    )
  }

  // KV/markdown fallback path
  const entityKeyRaw = args.entity_key!
  const res = await resolveEntityKey(c, entityKeyRaw)
  if (!res.raw) {
    return c.json(
      makeError(
        id,
        -32602,
        `Entity "${res.key}" not found${res.suggestion ? `. Did you mean "${res.suggestion}"?` : ''}`,
        { key: res.key, did_you_mean: res.suggestion },
      ),
      200,
    )
  }
  const entityKey = res.key
  const raw = res.raw

  const { text } = parseKvEntry(raw)
  const knowsField =
    extractRawField(text, 'Knows') ??
    extractRawField(text, 'Knowledge') ??
    extractRawField(text, 'Awareness')
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

  return c.json(
    makeResult(id, {
      content: [
        {
          type: 'text',
          text: knownInText
            ? `"${entityKey}" has knowledge of "${topic}".`
            : `"${entityKey}" has no knowledge of "${topic}".`,
        },
      ],
      metadata: { retrieved: 1, written: 0, source: 'kv' },
      known: knownInText,
      known_via_field: knownViaField,
      topic,
      excerpts,
    }),
    200,
  )
}

export const handle_set_entity_knowledge: TypedToolHandler<
  typeof setEntityKnowledgeSchema
> = async ({
  c,
  id,
  args,
}: TypedToolContext<typeof setEntityKnowledgeSchema>): Promise<Response> => {
  if (!c.env.RPG_DB) return c.json(makeError(id, -32603, 'D1 database unavailable', null), 200)

  // Validate FK constraint: entity_id must exist in characters table
  let entityExists: { id: string } | null
  try {
    entityExists = (await c.env.RPG_DB.prepare('SELECT id FROM characters WHERE id = ?')
      .bind(args.entity_id)
      .first()) as { id: string } | null
  } catch (err) {
    const msg = String(err)
    if (msg.includes('FOREIGN KEY')) {
      return c.json(makeError(id, -32603, `Foreign key constraint violation: ${msg}`, null), 200)
    }
    throw err
  }
  if (!entityExists) {
    return c.json(makeError(id, -32602, `Character not found: ${args.entity_id}`, null), 200)
  }

  const knowledgeId = randomUUID()
  try {
    await c.env.RPG_DB.prepare(
      `INSERT OR REPLACE INTO entity_knowledge (id, entity_id, topic, knowledge_type, source, acquired_at, detail, confidence, is_current)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
      .bind(
        knowledgeId,
        args.entity_id,
        args.topic,
        args.knowledge_type,
        args.source ?? null,
        args.acquired_at,
        args.detail ?? null,
        args.confidence,
      )
      .run()
  } catch (err) {
    const msg = String(err)
    if (msg.includes('FOREIGN KEY')) {
      return c.json(makeError(id, -32603, `Foreign key constraint violation: ${msg}`, null), 200)
    }
    throw err
  }

  return c.json(
    makeResult(id, {
      content: [
        { type: 'text', text: `Knowledge "${args.topic}" set for entity "${args.entity_id}".` },
      ],
      metadata: { knowledge_id: knowledgeId, entity_id: args.entity_id, topic: args.topic },
    }),
    200,
  )
}

export const handle_learn_from_event: TypedToolHandler<typeof learnFromEventSchema> = async ({
  c,
  id,
  args,
}: TypedToolContext<typeof learnFromEventSchema>): Promise<Response> => {
  if (!c.env.RPG_DB) return c.json(makeError(id, -32603, 'D1 database unavailable', null), 200)

  const event = (await c.env.RPG_DB.prepare('SELECT * FROM timeline_events WHERE id = ?')
    .bind(args.event_id)
    .first()) as Record<string, unknown> | null
  if (!event) return c.json(makeError(id, -32602, `Event not found: ${args.event_id}`, null), 200)

  // Validate FK constraint: entity_id must exist in characters table
  let entityExists: { id: string } | null
  try {
    entityExists = (await c.env.RPG_DB.prepare('SELECT id FROM characters WHERE id = ?')
      .bind(args.entity_id)
      .first()) as { id: string } | null
  } catch (err) {
    const msg = String(err)
    if (msg.includes('FOREIGN KEY')) {
      return c.json(makeError(id, -32603, `Foreign key constraint violation: ${msg}`, null), 200)
    }
    throw err
  }
  if (!entityExists) {
    return c.json(makeError(id, -32602, `Character not found: ${args.entity_id}`, null), 200)
  }

  const topic = `${event.verb}${event.object_entity ? `:${event.object_entity}` : ''}`
  const knowledgeId = randomUUID()
  try {
    await c.env.RPG_DB.prepare(
      `INSERT OR REPLACE INTO entity_knowledge (id, entity_id, topic, knowledge_type, source, acquired_at, detail, confidence, is_current)
       VALUES (?, ?, ?, 'fact', ?, ?, ?, 100, 1)`,
    )
      .bind(
        knowledgeId,
        args.entity_id,
        topic,
        args.event_id,
        event.event_at as string,
        event.detail ?? null,
      )
      .run()
  } catch (err) {
    const msg = String(err)
    if (msg.includes('FOREIGN KEY')) {
      return c.json(makeError(id, -32603, `Foreign key constraint violation: ${msg}`, null), 200)
    }
    throw err
  }

  return c.json(
    makeResult(id, {
      content: [
        {
          type: 'text',
          text: `Entity "${args.entity_id}" learned "${topic}" from event "${args.event_id}".`,
        },
      ],
      metadata: {
        knowledge_id: knowledgeId,
        entity_id: args.entity_id,
        topic,
        source: args.event_id,
      },
    }),
    200,
  )
}

export const handle_migrate_knowledge: TypedToolHandler<typeof migrateKnowledgeSchema> = async ({
  c,
  id,
  args,
}: TypedToolContext<typeof migrateKnowledgeSchema>): Promise<Response> => {
  if (!c.env.RPG_DB) return c.json(makeError(id, -32603, 'D1 database unavailable', null), 200)

  // Fetch world current_date for acquired_at default
  const ws = (await c.env.RPG_DB.prepare(
    'SELECT "current_date" FROM world_state WHERE world_id = ?',
  )
    .bind(args.world_id)
    .first()) as { current_date: string } | null
  const acquiredAt = ws?.current_date ?? new Date().toISOString().slice(0, 10)

  // Find all character KV keys and scan for Knows/Knowledge fields
  const allKeys = await kvList(c)
  const charKeys = allKeys.filter((k) => k.startsWith('character:'))
  const raws = await Promise.all(charKeys.map((k) => kvGet(c, k)))

  let migratedEntities = 0
  let totalFacts = 0

  for (let i = 0; i < charKeys.length; i++) {
    const raw = raws[i]
    if (!raw) continue
    const { text } = parseKvEntry(raw)
    const knowsRaw = extractRawField(text, 'Knows') ?? extractRawField(text, 'Knowledge')
    if (!knowsRaw) continue

    const topics = knowsRaw
      .split(',')
      .map((t: string) => t.trim())
      .filter(Boolean)
    if (topics.length === 0) continue

    // Find matching character by kv_origin or name match — best effort, skip if no D1 row
    const charKey = charKeys[i]
    const charName = charKey.replace(/^character:/, '')
    const dbChar = (await c.env
      .RPG_DB!.prepare('SELECT id FROM characters WHERE id = ? OR name LIKE ? LIMIT 1')
      .bind(charName, `%${charName}%`)
      .first()) as { id: string } | null
    if (!dbChar) continue

    migratedEntities++
    for (const topic of topics) {
      const knowledgeId = randomUUID()
      await c.env
        .RPG_DB!.prepare(
          `INSERT OR IGNORE INTO entity_knowledge (id, entity_id, topic, knowledge_type, source, acquired_at, confidence, is_current)
         VALUES (?, ?, ?, 'fact', 'kv_migration', ?, 80, 1)`,
        )
        .bind(knowledgeId, dbChar.id, topic, acquiredAt)
        .run()
      totalFacts++
    }
  }

  return c.json(
    makeResult(id, {
      content: [
        {
          type: 'text',
          text: `Migrated knowledge for ${migratedEntities} entities (${totalFacts} facts total).`,
        },
      ],
      metadata: { migrated_entities: migratedEntities, total_facts: totalFacts },
    }),
    200,
  )
}

export const handle_get_location_occupants: TypedToolHandler<
  typeof getLocationOccupantsSchema
> = async ({
  c,
  id,
  args,
}: TypedToolContext<typeof getLocationOccupantsSchema>): Promise<Response> => {
  const locationKey = args.location_key.trim().toLowerCase()

  const { keys: entityKeys, rawValues } = await resolveIndexedEntities(
    c,
    `_idx:location:${locationKey}`,
    'Location',
    locationKey,
  )

  const occupants: Array<{ key: string; status: string | null }> = []
  for (let i = 0; i < entityKeys.length; i++) {
    const raw = rawValues[i]
    if (!raw) continue
    const key = entityKeys[i]
    const { text } = parseKvEntry(raw)
    occupants.push({ key, status: extractRawField(text, 'Status') ?? null })
  }

  return c.json(
    makeResult(id, {
      content: [
        {
          type: 'text',
          text:
            occupants.length > 0
              ? `${occupants.length} occupant(s) at "${locationKey}": ${occupants.map((o) => o.key).join(', ')}.`
              : `No occupants found at "${locationKey}".`,
        },
      ],
      metadata: { retrieved: entityKeys.length, written: 0 },
      location_key: locationKey,
      occupants,
    }),
    200,
  )
}

export const handle_get_reachable_locations: TypedToolHandler<
  typeof getReachableLocationsSchema
> = async ({
  c,
  id,
  args,
}: TypedToolContext<typeof getReachableLocationsSchema>): Promise<Response> => {
  const resOrigin = await resolveEntityKey(c, args.origin_key)
  if (!resOrigin.raw) {
    return c.json(
      makeError(
        id,
        -32602,
        `Location "${resOrigin.key}" not found${resOrigin.suggestion ? `. Did you mean "${resOrigin.suggestion}"?` : ''}`,
        { key: resOrigin.key, did_you_mean: resOrigin.suggestion },
      ),
      200,
    )
  }
  const originKey = resOrigin.key
  const rawOrigin = resOrigin.raw

  const { text } = parseKvEntry(rawOrigin)
  const exitsRaw =
    extractRawField(text, 'Exits') ??
    extractRawField(text, 'Connections') ??
    extractRawField(text, 'Routes')
  const yamlExitKeys = [...text.matchAll(/^\s*-\s+target:\s+(\S+)/gim)].map((m) =>
    m[1].toLowerCase(),
  )
  const inlineExitKeys = exitsRaw
    ? exitsRaw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : []
  const exitKeys = yamlExitKeys.length > 0 ? yamlExitKeys : inlineExitKeys

  const locations = await Promise.all(
    exitKeys.map(async (key) => {
      const exitRaw = await kvGet(c, key)
      const exitText = exitRaw ? parseKvEntry(exitRaw).text : null
      const dangerLevel = exitText ? extractFieldFromText(exitText, 'Danger-Level') : null
      const travelCost = exitText ? extractFieldFromText(exitText, 'Travel-Cost') : null
      const requirements = exitText ? extractRawField(exitText, 'Requirements') : null
      return {
        key,
        exists: exitRaw !== null,
        danger_level: typeof dangerLevel === 'number' ? dangerLevel : null,
        travel_cost: typeof travelCost === 'number' ? travelCost : null,
        requirements: requirements ?? null,
      }
    }),
  )

  return c.json(
    makeResult(id, {
      content: [
        {
          type: 'text',
          text:
            locations.length > 0
              ? `${locations.length} reachable location(s) from "${originKey}": ${locations.map((l) => l.key).join(', ')}.`
              : `No exits defined for "${originKey}".`,
        },
      ],
      metadata: { retrieved: 1 + exitKeys.length, written: 0 },
      origin_key: originKey,
      locations,
    }),
    200,
  )
}

export const handle_sense_environment: TypedToolHandler<typeof senseEnvironmentSchema> = async ({
  c,
  id,
  args,
}: TypedToolContext<typeof senseEnvironmentSchema>): Promise<Response> => {
  const [resLoc, resEntity] = await Promise.all([
    resolveEntityKey(c, args.location_key),
    resolveEntityKey(c, args.entity_key),
  ])
  if (!resLoc.raw) {
    return c.json(
      makeError(
        id,
        -32602,
        `Location "${resLoc.key}" not found${resLoc.suggestion ? `. Did you mean "${resLoc.suggestion}"?` : ''}`,
        { key: resLoc.key, did_you_mean: resLoc.suggestion },
      ),
      200,
    )
  }
  if (!resEntity.raw) {
    return c.json(
      makeError(
        id,
        -32602,
        `Entity "${resEntity.key}" not found${resEntity.suggestion ? `. Did you mean "${resEntity.suggestion}"?` : ''}`,
        { key: resEntity.key, did_you_mean: resEntity.suggestion },
      ),
      200,
    )
  }
  const locationKey = resLoc.key
  const entityKey = resEntity.key
  const rawLoc = resLoc.raw
  const rawEntity = resEntity.raw

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

  return c.json(
    makeResult(id, {
      content: [
        {
          type: 'text',
          text: `"${entityKey}" senses "${locationKey}" (perception: ${perceptionScore.toFixed(2)}). ${visibleDetails.length} visible detail(s), ${hiddenDetails.length} hidden.`,
        },
      ],
      metadata: { retrieved: 2, written: 0 },
      entity_key: entityKey,
      location_key: locationKey,
      perception_score: perceptionScore,
      night_vision: typeof nightVision === 'number' ? nightVision : null,
      tracking: typeof tracking === 'number' ? tracking : null,
      visible_details: visibleDetails,
      hidden_count: hiddenDetails.length,
      missed_threats: hiddenDetails.filter((l) => /\[threat\]|\[danger\]/i.test(l)).length,
    }),
    200,
  )
}

export const handle_get_thread_comparison: TypedToolHandler<
  typeof getThreadComparisonSchema
> = async ({
  c,
  id,
  args,
}: TypedToolContext<typeof getThreadComparisonSchema>): Promise<Response> => {
  const threadA = args.thread_a.trim()
  const threadB = args.thread_b.trim()
  const { keys: keysA, rawValues: rawValuesA } = await resolveIndexedEntities(
    c,
    `_idx:thread:${threadA}`,
    'Thread',
    threadA,
  )
  const { keys: keysB, rawValues: rawValuesB } = await resolveIndexedEntities(
    c,
    `_idx:thread:${threadB}`,
    'Thread',
    threadB,
  )
  type TInfo = {
    key: string
    timeline_value: number | null
    current_date: string | null
    location: string | null
  }
  const entitiesA: TInfo[] = [],
    entitiesB: TInfo[] = []

  for (let i = 0; i < keysA.length; i++) {
    const raw = rawValuesA[i]
    if (!raw) continue
    const key = keysA[i]
    const { text } = parseKvEntry(raw)
    const info: TInfo = {
      key,
      timeline_value: (() => {
        const v = extractFieldFromText(text, 'Timeline-Value')
        return typeof v === 'number' ? v : null
      })(),
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
      timeline_value: (() => {
        const v = extractFieldFromText(text, 'Timeline-Value')
        return typeof v === 'number' ? v : null
      })(),
      current_date: extractRawField(text, 'Current-Date'),
      location: extractRawField(text, 'Location'),
    }
    entitiesB.push(info)
  }

  const avg = (arr: TInfo[]) => {
    const vals = arr.filter((e) => e.timeline_value !== null).map((e) => e.timeline_value!)
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
  }
  const avgA = avg(entitiesA),
    avgB = avg(entitiesB)
  const timelineOffset =
    avgA !== null && avgB !== null ? Math.round(Math.abs(avgA - avgB) * 10) / 10 : null

  const datesA = new Set(entitiesA.map((e) => e.current_date).filter(Boolean) as string[])
  const datesB = new Set(entitiesB.map((e) => e.current_date).filter(Boolean) as string[])
  const locsA = new Set(entitiesA.map((e) => e.location).filter(Boolean) as string[])
  const locsB = new Set(entitiesB.map((e) => e.location).filter(Boolean) as string[])

  return c.json(
    makeResult(id, {
      content: [
        {
          type: 'text',
          text: `Thread comparison "${threadA}" (${entitiesA.length}) vs "${threadB}" (${entitiesB.length}). Offset: ${timelineOffset ?? 'N/A'}. ${[...datesA].filter((d) => datesB.has(d)).length} shared date(s), ${[...locsA].filter((l) => locsB.has(l)).length} shared location(s).`,
        },
      ],
      metadata: { retrieved: keysA.length + keysB.length, written: 0 },
      thread_a: {
        id: threadA,
        entity_count: entitiesA.length,
        avg_timeline: avgA !== null ? Math.round(avgA * 10) / 10 : null,
        entities: entitiesA,
      },
      thread_b: {
        id: threadB,
        entity_count: entitiesB.length,
        avg_timeline: avgB !== null ? Math.round(avgB * 10) / 10 : null,
        entities: entitiesB,
      },
      timeline_offset: timelineOffset,
      shared_dates: [...datesA].filter((d) => datesB.has(d)),
      shared_locations: [...locsA].filter((l) => locsB.has(l)),
    }),
    200,
  )
}

export const handle_check_convergence: TypedToolHandler<typeof checkConvergenceSchema> = async ({
  c,
  id,
  args,
}: TypedToolContext<typeof checkConvergenceSchema>): Promise<Response> => {
  const threadA = args.thread_a.trim()
  const threadB = args.thread_b.trim()
  const worldId = args.world_id

  // D1-first path: when world_id is provided, query timeline_events directly
  if (worldId && c.env.RPG_DB) {
    const db = c.env.RPG_DB

    const datesA = await db
      .prepare(
        `SELECT DISTINCT DATE(event_at) as event_date, location_id
       FROM timeline_events
       WHERE world_id = ? AND thread_id = ? AND event_at IS NOT NULL`,
      )
      .bind(worldId, threadA)
      .all()

    const datesB = await db
      .prepare(
        `SELECT DISTINCT DATE(event_at) as event_date, location_id
       FROM timeline_events
       WHERE world_id = ? AND thread_id = ? AND event_at IS NOT NULL`,
      )
      .bind(worldId, threadB)
      .all()

    const dateSetA = new Set(datesA.results.map((r: any) => r.event_date).filter(Boolean))
    const dateSetB = new Set(datesB.results.map((r: any) => r.event_date).filter(Boolean))
    const locSetA = new Set(datesA.results.map((r: any) => r.location_id).filter(Boolean))
    const locSetB = new Set(datesB.results.map((r: any) => r.location_id).filter(Boolean))

    const sharedDates = [...dateSetA].filter((d) => dateSetB.has(d))
    const sharedLocations = [...locSetA].filter((l) => locSetB.has(l))
    const canConverge = sharedDates.length > 0 || sharedLocations.length > 0

    const framing = canConverge
      ? `Threads "${threadA}" and "${threadB}" can converge via ${sharedDates.length > 0 ? `shared date(s): ${sharedDates.join(', ')}` : ''}${sharedDates.length > 0 && sharedLocations.length > 0 ? ' and ' : ''}${sharedLocations.length > 0 ? `shared location(s): ${sharedLocations.join(', ')}` : ''}.`
      : `No convergence points found between "${threadA}" and "${threadB}".`

    return c.json(
      makeResult(id, {
        content: [{ type: 'text', text: framing }],
        metadata: {
          retrieved: datesA.results.length + datesB.results.length,
          written: 0,
          source: 'd1',
        },
        can_converge: canConverge,
        thread_a: threadA,
        thread_b: threadB,
        shared_dates: sharedDates,
        shared_locations: sharedLocations,
        framing,
      }),
      200,
    )
  }

  // KV fallback path: use _idx:thread indexes (populated by append_event/plant_setup)
  const { keys: keysA, rawValues: rawValuesA } = await resolveIndexedEntities(
    c,
    `_idx:thread:${threadA}`,
    'Thread',
    threadA,
  )
  const { keys: keysB, rawValues: rawValuesB } = await resolveIndexedEntities(
    c,
    `_idx:thread:${threadB}`,
    'Thread',
    threadB,
  )
  type TInfo = { key: string; current_date: string | null; location: string | null }
  const entitiesA: TInfo[] = [],
    entitiesB: TInfo[] = []

  for (let i = 0; i < keysA.length; i++) {
    const raw = rawValuesA[i]
    if (!raw) continue
    const key = keysA[i]
    const { text } = parseKvEntry(raw)
    const info: TInfo = {
      key,
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
      current_date: extractRawField(text, 'Current-Date'),
      location: extractRawField(text, 'Location'),
    }
    entitiesB.push(info)
  }

  const datesA = new Set(entitiesA.map((e) => e.current_date).filter(Boolean) as string[])
  const datesB = new Set(entitiesB.map((e) => e.current_date).filter(Boolean) as string[])
  const locsA = new Set(entitiesA.map((e) => e.location).filter(Boolean) as string[])
  const locsB = new Set(entitiesB.map((e) => e.location).filter(Boolean) as string[])
  const sharedDates = [...datesA].filter((d) => datesB.has(d))
  const sharedLocations = [...locsA].filter((l) => locsB.has(l))
  const canConverge = sharedDates.length > 0 || sharedLocations.length > 0

  const framing = canConverge
    ? `Threads "${threadA}" and "${threadB}" can converge via ${sharedDates.length > 0 ? `shared date(s): ${sharedDates.join(', ')}` : ''}${sharedDates.length > 0 && sharedLocations.length > 0 ? ' and ' : ''}${sharedLocations.length > 0 ? `shared location(s): ${sharedLocations.join(', ')}` : ''}.`
    : `No convergence points found between "${threadA}" and "${threadB}".`

  return c.json(
    makeResult(id, {
      content: [{ type: 'text', text: framing }],
      metadata: { retrieved: keysA.length + keysB.length, written: 0, source: 'kv' },
      can_converge: canConverge,
      thread_a: threadA,
      thread_b: threadB,
      shared_dates: sharedDates,
      shared_locations: sharedLocations,
      entity_overlap: {
        a_entities: entitiesA.map((e) => e.key),
        b_entities: entitiesB.map((e) => e.key),
      },
      framing,
    }),
    200,
  )
}

export async function handle_get_world_state({ c, id }: ToolContext): Promise<Response> {
  const keys = await kvList(c)
  const raws = await Promise.all(keys.map((k) => kvGet(c, k)))
  const threads = new Set<string>()
  const locations = new Set<string>()
  let characterCount = 0
  for (let i = 0; i < keys.length; i++) {
    const raw = raws[i]
    /* istanbul ignore next */
    if (!raw) continue
    const key = keys[i]
    if (key.startsWith('character:')) characterCount++
    const { text } = parseKvEntry(raw)
    const thread = extractRawField(text, 'Thread')
    const location = extractRawField(text, 'Location')
    if (thread) threads.add(thread)
    if (location) locations.add(location)
  }
  return c.json(
    makeResult(id, {
      content: [
        {
          type: 'text',
          text: `World state: ${keys.length} entries, ${characterCount} characters, ${threads.size} thread(s), ${locations.size} location(s).`,
        },
      ],
      metadata: { retrieved: keys.length, written: 0 },
      total_entries: keys.length,
      character_count: characterCount,
      active_threads: [...threads],
      known_locations: [...locations],
    }),
    200,
  )
}
