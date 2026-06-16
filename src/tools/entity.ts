// src/tools/entity.ts
import { z } from 'zod'
import { kvGet, kvPut, kvDelete, loreDB, clearRequestCache } from '../lib/kv'
import { makeResult, makeError } from '../lib/rpc'
import { parseKvEntry, extractFieldFromText, updateFieldInText, extractConsumptionInfo, extractActiveThreads, normalizeWeight, inferFromSensoryComposite, extractRawField, parseLoreSections } from '../lib/lore'
import { pushHistory, appendChangelog } from '../lib/history'
import { getIndexedKeys, updateIndexes, resolveIndexedEntities } from '../lib/indexes'
import type { ToolContext } from './types'

export async function handle_resolve_interaction({ c, id, args }: ToolContext): Promise<Response> {
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

  const w1Raw = extractFieldFromText(textA, 'Weight-1')
  const w2Raw = extractFieldFromText(textB, 'Weight-2')

  if (typeof w1Raw !== 'number') return c.json(makeError(id, -32602, `Entity "${keyA}" missing numeric **Weight-1:** field (got: ${JSON.stringify(w1Raw)})`, null), 200)
  if (typeof w2Raw !== 'number') return c.json(makeError(id, -32602, `Entity "${keyB}" missing numeric **Weight-2:** field (got: ${JSON.stringify(w2Raw)})`, null), 200)

  const w1 = normalizeWeight(w1Raw)
  const w2 = normalizeWeight(w2Raw)
  // Formula: (W1 * 0.7) - (W2 * 0.3)
  const probability = Math.max(0, Math.min(1, (w1 * 0.7) - (w2 * 0.3)))
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
      await kvPut(c, keyA, JSON.stringify({ text: updatedTextA, meta: { version, updatedAt: now, createdAt: metaA.createdAt ?? now, lastAction: actionType } }))
      await appendChangelog(c, keyA, version)
      loreDB[keyA] = updatedTextA
      clearRequestCache(c)
    }
  }

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `${actionType}: ${success ? 'SUCCESS' : 'FAILURE'} (roll ${roll.toFixed(3)} vs P=${probability.toFixed(3)}) — delta_value: ${delta_value}` }],
    metadata: { entity_a_id: keyA, entity_b_id: keyB, action_type: actionType, weight_1: w1, weight_2: w2, weight_1_raw: w1Raw, weight_2_raw: w2Raw, probability: Math.round(probability * 1000) / 1000, roll: Math.round(roll * 1000) / 1000 },
    success,
    delta_value
  }), 200)
}

export async function handle_destroy_entity({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({ entity_key: z.string().min(1) })
  const parsed = schema.safeParse(args)
  if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

  const key = parsed.data.entity_key.trim().toLowerCase()
  const raw = await kvGet(c, key)
  if (!raw) return c.json(makeError(id, -32602, `Entity "${key}" not found`, null), 200)

  const { text } = parseKvEntry(raw)

  // Archive one last history snapshot before deletion
  await pushHistory(c, key, raw)

  // Purge from KV and indexes
  await updateIndexes(c, key, '', text)
  await kvDelete(c, key)
  await appendChangelog(c, key, 0, 'destroy')
  delete loreDB[key]
  clearRequestCache(c)

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Entity "${key}" destroyed.` }],
    metadata: { entity_key: key, destroyed: true }
  }), 200)
}

export async function handle_analyze_utility({ c, id, args }: ToolContext): Promise<Response> {
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

export async function handle_map_integration({ c, id, args }: ToolContext): Promise<Response> {
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
    meta: {
      version, updatedAt: now,
      createdAt: targetMeta.createdAt ?? now
    }
  }))
  await appendChangelog(c, targetKey, version)
  loreDB[targetKey] = updatedTargetText


  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Integrated ${traitsToTransfer.length} trait(s) from "${sourceKey}" into "${targetKey}" at depth ${depth}.` }],
    metadata: { source_id: sourceKey, target_id: targetKey, integration_depth: depth, total_transferable: transferableLines.length, transferred_count: traitsToTransfer.length, version },
    updated_traits: traitsToTransfer
  }), 200)
}

export async function handle_generate_entity({ c, id, args }: ToolContext): Promise<Response> {
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

export async function handle_roll_encounter({ c, id, args }: ToolContext): Promise<Response> {
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
  let tableRaw = extractRawField(locText, 'Encounter-Table')
  if (tableRaw === null) {
    const { sections } = parseLoreSections(locText, ['Encounter-Table'])
    tableRaw = sections['Encounter-Table'] ?? null
  }
  if (!tableRaw) {
    return c.json(makeResult(id, { content: [{ type: 'text', text: `No Encounter-Table field found on "${locationKey}".` }], metadata: { retrieved: 1, written: 0 }, rolled: false }), 200)
  }

  const entries: Array<{ key: string; weight: number }> = []
  for (const part of tableRaw.split(',').map(s => s.trim()).filter(Boolean)) {
    const m = part.match(/^(.+?)\s*:\s*([\d.]+)$/)
    if (m) entries.push({ key: m[1].trim(), weight: parseFloat(m[2]) })
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
  const roll = Math.random() * total
  let cum = 0, selected = adjusted[0]
  for (const e of adjusted) { cum += e.w; if (roll <= cum) { selected = e; break } }

  // New: nothing sentinel — skip archetype lookup, return clean no-encounter
  if (selected.key === 'nothing') {
    return c.json(makeResult(id, {
      content: [{ type: 'text', text: `Encounter rolled at "${locationKey}" — nothing stirs.` }],
      metadata: { retrieved: 1, written: 0 },
      rolled: true, location_key: locationKey, threat_level: threatLevel,
      selected_archetype: 'nothing', entity_key: null, nothing: true
    }), 200);
  }
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

export async function handle_advance_state_stage({ c, id, args }: ToolContext): Promise<Response> {
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
  await appendChangelog(c, entityKey, version)
  loreDB[entityKey] = updatedText
  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Advancing "${entityKey}" to Stage-${newStage}${total ? `-of-${total}` : ''}. stage ${newStage}${isTerminal ? ' [TERMINAL STAGE]' : ''}` }],
    metadata: { retrieved: 1, written: 1 },
    entity_key: entityKey, old_stage: currentStage, new_stage: newStage, total_stages: total,
    is_terminal: isTerminal, stage_descriptor: stageDescriptor, advanced: true
  }), 200)
}

export async function handle_process_stage_batch({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({ location_key: z.string().min(1) })
  const parsed = schema.safeParse(args)
  if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

  const locationKey = parsed.data.location_key.trim().toLowerCase()
  const { keys: entityKeys, rawValues } = await resolveIndexedEntities(c, `_idx:location:${locationKey}`, 'Location', locationKey)
  const now = new Date().toISOString()

  const batchResults = await Promise.all(entityKeys.map(async (key, i) => {
    const raw = rawValues[i]
    if (!raw) return null
    const { text, meta } = parseKvEntry(raw)

    const currentStage = extractFieldFromText(text, 'State-Stage')
    if (typeof currentStage !== 'number') {
      return { kind: 'skipped' as const, key, reason: 'no State-Stage field' }
    }
    const totalStages = extractFieldFromText(text, 'State-Total')
    const total = typeof totalStages === 'number' ? totalStages : null
    if (total !== null && currentStage >= total) {
      return { kind: 'skipped' as const, key, reason: `already at terminal stage ${currentStage}/${total}` }
    }

    const newStage = currentStage + 1
    let updatedText = updateFieldInText(text, 'State-Stage', newStage)
    const stageTimer = extractFieldFromText(text, 'Stage-Timer')
    if (typeof stageTimer === 'number') updatedText = updateFieldInText(updatedText, 'Stage-Timer', Math.max(0, stageTimer - 1))

    await pushHistory(c, key, raw)
    const version = typeof meta.version === 'number' ? meta.version + 1 : 1
    await kvPut(c, key, JSON.stringify({ text: updatedText, meta: { version, updatedAt: now, createdAt: meta.createdAt ?? now } }))
    await appendChangelog(c, key, version)
    loreDB[key] = updatedText
    return { kind: 'outcome' as const, key, old_stage: currentStage, new_stage: newStage, is_terminal: total !== null && newStage >= total }
  }))

  const outcomes: Array<{ key: string; old_stage: number; new_stage: number; is_terminal: boolean }> = []
  const skipped: Array<{ key: string; reason: string }> = []
  for (const r of batchResults) {
    if (!r) continue
    if (r.kind === 'outcome') outcomes.push(r as any)
    if (r.kind === 'skipped') skipped.push(r as any)
  }

  const entitiesWithStages = entityKeys.length - skipped.filter(s => s.reason === 'no State-Stage field').length
  let reason: string | undefined
  if (outcomes.length === 0) {
    if (entityKeys.length === 0) reason = 'No entities found at this location'
    else if (entitiesWithStages === 0) reason = `${entityKeys.length} entity/entities at location but none have State-Stage fields`
    else reason = `All ${skipped.length} staged entity/entities are already at terminal stage`
  }

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Processed ${outcomes.length} entity/entities at "${locationKey}". ${skipped.length} skipped.${reason ? ` Reason: ${reason}` : ''}` }],
    metadata: { retrieved: entityKeys.length, written: outcomes.length, entities_at_location: entityKeys.length, entities_with_stages: entitiesWithStages },
    location_key: locationKey, outcomes, skipped, ...(reason ? { reason } : {})
  }), 200)
}

export async function handle_get_sensory_profile({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({ entity_key: z.string().min(1) })
  const parsed = schema.safeParse(args)
  if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

  const entityKey = parsed.data.entity_key.trim().toLowerCase()
  const raw = await kvGet(c, entityKey)
  if (!raw) return c.json(makeError(id, -32602, `Entity "${entityKey}" not found`, null), 200)

  const { text } = parseKvEntry(raw)
  const rawSpeciesField = (extractRawField(text, 'Species') ?? extractRawField(text, 'Type'))?.trim().toLowerCase() ?? null
  const speciesKey = rawSpeciesField
    ? (rawSpeciesField.includes(':') ? rawSpeciesField : `species:${rawSpeciesField}`)
    : null
  let speciesText = ''
  let speciesSource = ''
  let retrieved = 1
  if (speciesKey) {
    const rawSpecies = await kvGet(c, speciesKey)
    if (rawSpecies) { speciesText = parseKvEntry(rawSpecies).text; speciesSource = speciesKey; retrieved++ }
  }

  const get = (f: string) => extractRawField(text, f) ?? (speciesText ? extractRawField(speciesText, f) : null)
  const compositeRaw = extractRawField(text, 'Sensory-Profile') ?? (speciesText ? extractRawField(speciesText, 'Sensory-Profile') : null)
  const fromComposite = compositeRaw ? inferFromSensoryComposite(compositeRaw) : {}
  const fc = (k: keyof typeof fromComposite) => fromComposite[k] ?? null
  const profile = {
    temperature: get('Temperature') ?? get('Temperature-Range') ?? fc('temperature'),
    scent: get('Scent') ?? get('Scent-Profile') ?? fc('scent'),
    texture: get('Texture') ?? get('Surface-Texture') ?? fc('texture'),
    sound_signature: get('Sound-Signature') ?? get('Sound') ?? get('Audio-Signature') ?? fc('sound_signature'),
    visual_descriptors: get('Visual-Descriptors') ?? get('Appearance') ?? get('Description') ?? fc('visual_descriptors'),
  }
  const hasProfile = Object.values(profile).some(v => v !== null) || compositeRaw !== null

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: hasProfile ? `Sensory profile for "${entityKey}": ${[profile.temperature && `temp:${profile.temperature}`, profile.scent && `scent:${profile.scent}`, profile.texture && `texture:${profile.texture}`].filter(Boolean).join(', ')}.` : `No sensory profile fields found for "${entityKey}".` }],
    metadata: { retrieved, written: 0 },
    entity_key: entityKey, species: speciesKey, profile, sensory_profile_raw: compositeRaw, sensory_source: speciesSource ? `entity + fallback from ${speciesSource}` : 'entity'
  }), 200)
}

export async function handle_get_compatibility({ c, id, args }: ToolContext): Promise<Response> {
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

  const _w1A = extractFieldFromText(textA, 'Weight-1')
  const _w2B = extractFieldFromText(textB, 'Weight-2')
  const w1A = typeof _w1A === 'number' ? normalizeWeight(_w1A) : null
  const w2B = typeof _w2B === 'number' ? normalizeWeight(_w2B) : null
  if (w1A !== null && w1A < 0.2) { constraints.push(`Weight-1 too low (${w1A.toFixed(2)}): entity_a lacks drive`); riskScore++ }
  if (w2B !== null && w2B > 0.9) { constraints.push(`Weight-2 very high (${w2B.toFixed(2)}): entity_b extreme resistance`); riskScore += 2 }

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

export async function handle_get_inventory({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({ entity_key: z.string().min(1) })
  const parsed = schema.safeParse(args)
  if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

  const entityKey = parsed.data.entity_key.trim().toLowerCase()
  const raw = await kvGet(c, entityKey)
  if (!raw) return c.json(makeError(id, -32602, `Entity "${entityKey}" not found`, null), 200)

  const { text } = parseKvEntry(raw)
  // Multi-line format: **Inventory:** alone on its line, items on following lines
  // Must check this first — extractRawField's \s*$ can swallow \n and grab only the first item
  let invRaw: string | null = null
  const lines = text.split('\n')
  let collecting = false
  const collected: string[] = []
  for (const line of lines) {
    if (/^\s*\*\*(?:Inventory|Items|Carried-Items):\*\*\s*$/.test(line)) { collecting = true; continue }
    if (collecting) {
      if (/^\s*\*\*\w|^\s*#{1,3}\s/.test(line)) break
      const t = line.trim()
      if (t) collected.push(t)
    }
  }
  if (collected.length > 0) {
    invRaw = collected.join(',')
  } else {
    invRaw = extractRawField(text, 'Inventory') ?? extractRawField(text, 'Items') ?? extractRawField(text, 'Carried-Items')
  }
  const items: Array<{ item: string; quantity: number; condition: string | null }> = []
  if (invRaw) {
    const entries = invRaw.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
    for (const entry of entries) {
      const m = entry.match(/^(.+?)\s*[xX:\xd7*]\s*(\d+)(?:\s*\[([^\]]+)\])?$/)
      if (m) items.push({ item: m[1].trim(), quantity: parseInt(m[2]), condition: m[3] ?? null })
      else items.push({ item: entry, quantity: 1, condition: null })
    }
  }

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: items.length > 0 ? `Inventory for "${entityKey}": ${items.map(i => `${i.item}\xd7${i.quantity}`).join(', ')}.` : `No inventory found for "${entityKey}".` }],
    metadata: { retrieved: 1, written: 0 },
    entity_key: entityKey, items, raw_inventory: invRaw ?? null
  }), 200)
}

export async function handle_transfer_item({ c, id, args }: ToolContext): Promise<Response> {
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

  const parseInvStr = (raw: string): Array<{ item: string; quantity: number; condition: string | null }> =>
    raw.split(/[,\n]/).map(s => s.trim()).filter(Boolean).map(entry => {
      const m = entry.match(/^(.+?)\s*[xX:\xd7*]\s*(\d+)(?:\s*\[([^\]]+)\])?$/)
      return m ? { item: m[1].trim(), quantity: parseInt(m[2]), condition: m[3] ?? null } : { item: entry, quantity: 1, condition: null }
    })

  const extractInvRaw = (t: string): string => {
    const tLines = t.split('\n')
    let tCollecting = false
    const tCollected: string[] = []
    for (const line of tLines) {
      if (/^\s*\*\*(?:Inventory|Items|Carried-Items):\*\*\s*$/.test(line)) { tCollecting = true; continue }
      if (tCollecting) {
        if (/^\s*\*\*\w|^\s*#{1,3}\s/.test(line)) break
        const l = line.trim()
        if (l) tCollected.push(l)
      }
    }
    if (tCollected.length > 0) return tCollected.join(',')
    return extractRawField(t, 'Inventory') ?? extractRawField(t, 'Items') ?? extractRawField(t, 'Carried-Items') ?? ''
  }

  const fromInvFieldName = extractRawField(fromText, 'Inventory') ? 'Inventory' : extractRawField(fromText, 'Items') ? 'Items' : 'Inventory'
  const toInvFieldName = extractRawField(toText, 'Inventory') ? 'Inventory' : extractRawField(toText, 'Items') ? 'Items' : 'Inventory'
  const fromInvRaw = extractInvRaw(fromText)
  const fromItems = parseInvStr(fromInvRaw)
  const itemIdx = fromItems.findIndex(i => i.item.toLowerCase() === itemKey.toLowerCase())

  if (itemIdx === -1) {
    return c.json(makeResult(id, { content: [{ type: 'text', text: `Item "${itemKey}" not found in "${fromKey}"'s inventory.` }], metadata: { retrieved: 2, written: 0 }, transferred: false }), 200)
  }
  if (fromItems[itemIdx].quantity < qty) {
    return c.json(makeResult(id, { content: [{ type: 'text', text: `Insufficient quantity: "${fromKey}" has ${fromItems[itemIdx].quantity}\xd7 "${itemKey}", requested ${qty}.` }], metadata: { retrieved: 2, written: 0 }, transferred: false }), 200)
  }

  fromItems[itemIdx].quantity -= qty
  const newFromItems = fromItems.filter(i => i.quantity > 0)
  const fmtItem = (i: { item: string; quantity: number; condition: string | null }) =>
    i.condition ? `${i.item}\xd7${i.quantity}[${i.condition}]` : `${i.item}\xd7${i.quantity}`
  const newFromInvStr = newFromItems.map(fmtItem).join(', ')

  const toInvRaw = extractRawField(toText, toInvFieldName) ?? ''
  const toItems = parseInvStr(toInvRaw)
  const toIdx = toItems.findIndex(i => i.item.toLowerCase() === itemKey.toLowerCase())
  if (toIdx >= 0) toItems[toIdx].quantity += qty
  else toItems.push({ item: itemKey, quantity: qty, condition: null })
  const newToInvStr = toItems.map(fmtItem).join(', ')

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
  await Promise.all([
    appendChangelog(c, fromKey, fromVersion),
    appendChangelog(c, toKey, toVersion),
  ])
  loreDB[fromKey] = newFromText
  loreDB[toKey] = newToText
  clearRequestCache(c)

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Transferred ${qty}\xd7 "${itemKey}" from "${fromKey}" to "${toKey}".` }],
    metadata: { retrieved: 2, written: 2 },
    transferred: true, item_key: itemKey, quantity: qty, from_entity: fromKey, to_entity: toKey
  }), 200)
}

export async function handle_list_consumption_timelines({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({
    status_filter: z.enum(['all', 'imminent', 'days-to-weeks', 'weeks-to-months', 'consumed']).default('all'),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).default(0),
  })
  const parsed = schema.safeParse(args)
  if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

  const { status_filter, limit, offset } = parsed.data

  // v0.2.0: scan ALL character:* keys via index, not just livestock/prisoner
  const characterKeys = await getIndexedKeys(c, '_idx:prefix:character')
  const paginatedKeys = characterKeys.slice(offset, offset + limit)

  const rawValues = await Promise.all(paginatedKeys.map(k => kvGet(c, k)))

  const timelines: Array<any> = []
  for (let i = 0; i < paginatedKeys.length; i++) {
    const raw = rawValues[i]
    if (!raw) continue
    const key = paginatedKeys[i]
    const { text } = parseKvEntry(raw)
    const info = extractConsumptionInfo(text)

    // Skip characters with no timeline (predators, ascended staff, etc.)
    if (!info.timeline_remaining) continue

    if (status_filter !== 'all') {
      const tl = info.timeline_remaining.toLowerCase()
      if (status_filter === 'imminent' && !tl.includes('hour') && !/\b1\s*day\b/.test(tl)) continue
      if (status_filter === 'days-to-weeks' && !tl.includes('day') && !tl.includes('week')) continue
      if (status_filter === 'weeks-to-months' && !tl.includes('week') && !tl.includes('month') && !tl.includes('year')) continue
      if (status_filter === 'consumed' && !tl.includes('consumed')) continue
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
    metadata: { count: timelines.length, total_keys: characterKeys.length, offset, limit },
    timelines
  }), 200)
}

export async function handle_list_active_threads({ c, id }: ToolContext): Promise<Response> {
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
