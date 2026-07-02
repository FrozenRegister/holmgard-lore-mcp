// src/tools/scene.ts
import { z } from 'zod'
import { kvGet, kvList, kvPut, getKV, loreDB } from '../lib/kv'
import { makeResult, makeError } from '../lib/rpc'
import { invalidParamsError } from '../lib/errors'
import { parseKvEntry, extractFieldFromText, updateFieldInText, extractRawField, normalizeWeight } from '../lib/lore'
import { pushHistory, appendChangelog } from '../lib/history'
import { getIndexedKeys } from '../lib/indexes'
import type { ToolContext } from './types'

export async function handle_activate_scene({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({ scene_key: z.string().min(1) })
  const parsed = schema.safeParse(args)
  if (!parsed.success) {
    return c.json(invalidParamsError(id, 'scene_manage', parsed.error, {
      action: 'activate', scene_key: 'scene:tribunal-summons'
    }), 200)
  }

  const sceneKey = parsed.data.scene_key.trim().toLowerCase()
  const rawScene = await kvGet(c, sceneKey)
  if (!rawScene) return c.json(makeError(id, -32602, `Scene "${sceneKey}" not found`, null), 200)

  const { text: sceneText } = parseKvEntry(rawScene)
  const entitiesRaw = extractRawField(sceneText, 'Entities') ?? extractRawField(sceneText, 'Present-Entities')
  const locationRef = extractRawField(sceneText, 'Location')
  const timelineRef = extractRawField(sceneText, 'Timeline')
  const description = extractRawField(sceneText, 'Description') ?? sceneText.split('\n').find(l => l.trim() && !l.startsWith('**'))?.trim() ?? ''
  const choicesRaw = extractRawField(sceneText, 'Choices')
  const yamlChoiceIds = [...sceneText.matchAll(/^\s*-\s+id:\s+(\S+)/gim)].map(m => m[1])
  const inlineChoices = choicesRaw ? choicesRaw.split(',').map(s => s.trim()).filter(Boolean) : []
  const availableChoices = yamlChoiceIds.length > 0 ? yamlChoiceIds : inlineChoices
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

export async function handle_present_choices({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({ scene_key: z.string().min(1), entity_key: z.string().min(1) })
  const parsed = schema.safeParse(args)
  if (!parsed.success) {
    return c.json(invalidParamsError(id, 'scene_manage', parsed.error, {
      action: 'present_choices', scene_key: 'scene:tribunal-summons', entity_key: 'character:eira-holt'
    }), 200)
  }

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
    const choiceId = m[1].replace(/^\*+|\*+$/g, '').trim()
    const [, , desc, requires, minWeightStr] = m
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

export async function handle_commit_choice({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({ choice_id: z.string().min(1), entity_key: z.string().min(1) })
  const parsed = schema.safeParse(args)
  if (!parsed.success) {
    return c.json(invalidParamsError(id, 'scene_manage', parsed.error, {
      action: 'commit_choice', choice_id: 'negotiate', entity_key: 'character:eira-holt'
    }), 200)
  }

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
  await appendChangelog(c, entityKey, entityVersion)
  loreDB[entityKey] = newEntityText

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Choice "${choiceId}" committed for "${entityKey}".${stateChange ? ` State → ${stateChange}.` : ''} ${nextChoices.length} new choice(s) unlocked.` }],
    metadata: { retrieved: 2, written: 1 },
    choice_id: choiceId, entity_key: entityKey, outcome_seed: outcomeSeed,
    state_change: stateChange ?? null, next_choices: nextChoices
  }), 200)
}

export async function handle_get_choice_history({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({ entity_key: z.string().min(1) })
  const parsed = schema.safeParse(args)
  if (!parsed.success) {
    return c.json(invalidParamsError(id, 'scene_manage', parsed.error, {
      action: 'get_history', entity_key: 'character:eira-holt'
    }), 200)
  }

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

export async function handle_scene_brief({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({
    location_key: z.string().optional(),
    scene_key: z.string().optional(),
    include: z.object({
      events: z.number().int().min(0).optional(),
      open_setups: z.boolean().optional(),
      relationships: z.boolean().optional(),
      sensory: z.boolean().optional(),
    }).optional(),
  })
  const parsed = schema.safeParse(args)
  if (!parsed.success) {
    return c.json(invalidParamsError(id, 'scene_manage', parsed.error, {
      action: 'brief', location_key: 'location:marsh-end', include: { events: 5, open_setups: true }
    }), 200)
  }

  const include = parsed.data.include ?? {}
  const eventsCount = include.events ?? 5
  const includeSetups = include.open_setups !== false
  const includeRelationships = include.relationships !== false

  const baseKey = (parsed.data.location_key ?? parsed.data.scene_key ?? '').trim().toLowerCase()
  if (!baseKey) return c.json(makeError(id, -32602, 'Either location_key or scene_key is required', null), 200)

  const rawBase = await kvGet(c, baseKey)
  if (!rawBase) return c.json(makeError(id, -32602, `"${baseKey}" not found`, null), 200)

  const { text: baseText } = parseKvEntry(rawBase)

  const occupantKeys = await getIndexedKeys(c, `_idx:location:${baseKey}`)

  // Fallback: if index is empty, scan kvList for entities at this location
  if (occupantKeys.length === 0) {
    const allKeys = await kvList(c)
    const rawVals = await Promise.all(allKeys.map(k => kvGet(c, k)))
    for (let i = 0; i < allKeys.length; i++) {
      const r = rawVals[i]
      if (!r) continue
      const { text } = parseKvEntry(r)
      if (extractRawField(text, 'Location')?.trim().toLowerCase() === baseKey) {
        occupantKeys.push(allKeys[i])
      }
    }
  }

  const occupantRaws = await Promise.all(occupantKeys.map(k => kvGet(c, k)))
  const entityKeysMap: Map<string, string> = new Map()
  for (let i = 0; i < occupantKeys.length; i++) {
    const r = occupantRaws[i]
    if (!r) continue
    const key = occupantKeys[i]
    entityKeysMap.set(key, r)
  }
  const entityKeys = Array.from(entityKeysMap.keys())

  const kv = getKV(c)
  const occupants: Array<{ key: string; status: string | null; top_goal: string | null; events: any[] }> = []
  for (const ek of entityKeys) {
    const eRaw = entityKeysMap.get(ek)!
    const { text: eText } = parseKvEntry(eRaw)
    const topGoalMatch = eText.match(/\*\*Goal:([^:]+):\*\*\s*([^\n]+)/)
    let recentEvents: any[] = []
    if (kv && eventsCount > 0) {
      try { const evRaw = await kv.get(`events:${ek}`); if (evRaw) recentEvents = (JSON.parse(evRaw) as any[]).slice(0, eventsCount) } catch {
        // silently ignore if events don't exist
      }
    }
    occupants.push({
      key: ek,
      status: extractRawField(eText, 'Status'),
      top_goal: topGoalMatch ? `${topGoalMatch[1]}: ${topGoalMatch[2]}` : null,
      events: recentEvents
    })
  }

  const openSetups: any[] = []
  if (includeSetups) {
    const actorSet = new Set(entityKeys.map(k => k.toLowerCase()))
    const setupKeys = await getIndexedKeys(c, '_idx:prefix:setup')
    const setupRaws = await Promise.all(setupKeys.map(k => kvGet(c, k)))
    for (let i = 0; i < setupKeys.length; i++) {
      const sRaw = setupRaws[i]
      if (!sRaw) continue
      const sk = setupKeys[i]
      const { text: sText } = parseKvEntry(sRaw)
      if (extractRawField(sText, 'Status')?.toLowerCase() !== 'open') continue
      const actors = (extractRawField(sText, 'Actors') ?? '').split(',').map((s: string) => s.trim()).filter(Boolean)
      if (actors.length === 0 || actors.some((a: string) => actorSet.has(a.toLowerCase()))) {
        openSetups.push({
          id: sk.replace(/^setup:/, ''),
          description: extractRawField(sText, 'Description') ?? '',
          tension: (() => { const v = extractFieldFromText(sText, 'Tension'); return typeof v === 'number' ? v : 3 })()
        })
      }
    }
  }

  const relationships: any[] = []
  if (includeRelationships && entityKeys.length >= 2) {
    for (let i = 0; i < Math.min(entityKeys.length, 4); i++) {
      for (let j = i + 1; j < Math.min(entityKeys.length, 4); j++) {
        const rA = entityKeysMap.get(entityKeys[i])
        const rB = entityKeysMap.get(entityKeys[j])
        if (!rA || !rB) continue
        const tA = parseKvEntry(rA).text
        const affinity = extractRawField(tA, 'Affinity')
        const debt = extractRawField(tA, 'Debt')
        const threat = extractRawField(tA, 'Threat-Level')
        if (affinity || debt || threat) {
          relationships.push({ entity_a: entityKeys[i], entity_b: entityKeys[j], affinity, debt, threat_level: threat })
        }
      }
    }
  }

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Scene brief for "${baseKey}": ${occupants.length} entity/entities present. ${openSetups.length} open setup(s). ${relationships.length} relationship(s).` }],
    metadata: { location: baseKey, entity_count: occupants.length, setup_count: openSetups.length },
    location: { key: baseKey, text: baseText },
    entities: occupants,
    open_setups: openSetups,
    relationships
  }), 200)
}

export async function handle_render_pov({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({
    pov_entity_key: z.string().min(1),
    scene_key: z.string().optional(),
    location_key: z.string().optional(),
    include_voice_hints: z.boolean().optional(),
    reveal_threshold: z.number().min(0).max(1).optional(),
  })
  const parsed = schema.safeParse(args)
  if (!parsed.success) {
    return c.json(invalidParamsError(id, 'scene_manage', parsed.error, {
      action: 'render_pov', pov_entity_key: 'character:eira-holt', location_key: 'location:marsh-end'
    }), 200)
  }

  const povKey = parsed.data.pov_entity_key.trim().toLowerCase()
  const rawPov = await kvGet(c, povKey)
  if (!rawPov) return c.json(makeError(id, -32602, `POV entity "${povKey}" not found`, null), 200)

  const { text: povText } = parseKvEntry(rawPov)
  const perception = (() => { const v = extractFieldFromText(povText, 'Perception'); return typeof v === 'number' ? normalizeWeight(v) : 0.5 })()
  const threshold = parsed.data.reveal_threshold ?? perception

  const knowsRaw = extractRawField(povText, 'Knows') ?? extractRawField(povText, 'Knowledge') ?? ''
  const knownTopics = new Set(knowsRaw.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean))

  const baseKey = (parsed.data.location_key ?? parsed.data.scene_key ?? extractRawField(povText, 'Location') ?? '').trim().toLowerCase()
  if (!baseKey) return c.json(makeError(id, -32602, 'scene_key or location_key required, or entity must have a Location field', null), 200)

  const rawBase = await kvGet(c, baseKey)
  const baseText = rawBase ? parseKvEntry(rawBase).text : ''

  const filteredLines: string[] = []
  for (const line of baseText.split('\n')) {
    if (/\[(hidden|concealed)\]/i.test(line) && threshold < 0.7) continue
    if (/\[(threat|danger)\]/i.test(line) && threshold < 0.4) continue
    filteredLines.push(line)
  }
  const filteredBaseText = filteredLines.join('\n')

  let candidateKeys = await getIndexedKeys(c, `_idx:location:${baseKey}`)
  let candidateRaws: (string | null)[]
  if (candidateKeys.length === 0) {
    const allKeys = await kvList(c)
    const allRawValues = await Promise.all(allKeys.map(k => kvGet(c, k)))
    candidateKeys = []
    candidateRaws = []
    for (let i = 0; i < allKeys.length; i++) {
      const key = allKeys[i]
      if ((!key.startsWith('character:') && !key.startsWith('entity:')) || key === povKey) continue
      const r = allRawValues[i]
      if (!r) continue
      const { text } = parseKvEntry(r)
      if (extractRawField(text, 'Location')?.trim().toLowerCase() !== baseKey) continue
      candidateKeys.push(key)
      candidateRaws.push(r)
    }
  } else {
    candidateRaws = await Promise.all(candidateKeys.map(k => kvGet(c, k)))
  }

  const visibleEntities: Array<{ key: string; status: string | null; known: boolean }> = []
  for (let i = 0; i < candidateKeys.length; i++) {
    const key = candidateKeys[i]
    const r = candidateRaws[i]
    if (!r) continue
    const { text } = parseKvEntry(r)
    if (/\[hidden\]|\[concealed\]|\[invisible\]/i.test(text) && threshold < 0.7) continue
    const known = knownTopics.has(key) || knownTopics.has(key.split(':').pop()?.toLowerCase() ?? '')
    visibleEntities.push({ key, status: extractRawField(text, 'Status'), known })
  }

  const voiceHints = parsed.data.include_voice_hints ? {
    diction: extractRawField(povText, 'Diction') ?? extractRawField(povText, 'Voice'),
    register: extractRawField(povText, 'Register') ?? extractRawField(povText, 'Tone'),
    fixations: extractRawField(povText, 'Fixations') ?? extractRawField(povText, 'Preoccupations'),
  } : null

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `POV render for "${povKey}" at "${baseKey}": ${visibleEntities.length} visible entity/entities. Perception: ${threshold.toFixed(2)}.` }],
    metadata: { pov: povKey, location: baseKey, perception: threshold, entity_count: visibleEntities.length },
    pov_entity: povKey,
    location: { key: baseKey, filtered_text: filteredBaseText },
    visible_entities: visibleEntities,
    ...(voiceHints !== null && { voice_hints: voiceHints }),
    knowledge_scope: [...knownTopics]
  }), 200)
}
