// KV character text → D1 characters row mapper.
// Pure functions — no I/O, no imports from Hono or Cloudflare runtime.

import { extractRawField, extractFieldFromText, parseLoreSections } from '../../lib/lore'

export interface D1CharInsert {
  id: string
  name: string
  stats: string
  hp: number
  max_hp: number
  ac: number
  level: number
  faction_id: string | null
  behavior: string | null
  character_type: 'pc' | 'npc' | 'enemy' | 'neutral'
  character_class: string
  race: string
  background: string | null
  alignment: string | null
  conditions: string
  resistances: string
  vulnerabilities: string
  immunities: string
  known_spells: string
  prepared_spells: string
  cantrips_known: string
  currency: string
  resource_pools: string
  xp: number
  // KV-native columns (migration 0003)
  alias: string | null
  age: string | null
  gender: string | null
  orientation: string | null
  weight_1: number
  weight_2: number
  perception_float: number
  thread_id: string | null
  state_stage: number
  state_stage_timer: number
  kv_origin: string
  current_room_id: string | null
  perception_bonus: number
  stealth_bonus: number
  origin: string
  created_at: string
  updated_at: string
}

// ── Name extraction ───────────────────────────────────────────────────────────

function parseName(text: string, kvKey: string): string {
  const firstLine = text.split('\n')[0] ?? ''
  // Match: # Character:Elowen "Lo" Thorne  or  # Elowen Thorne
  const m = firstLine.match(/^#\s*(?:Character:\s*)?(.+)/i)
  if (m) return m[1].trim()
  // Fallback: derive from key "character:elowen-thorne" → "Elowen-Thorne"
  const slug = kvKey.replace(/^character:/, '')
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

// ── Status → conditions[] ────────────────────────────────────────────────────

function parseConditions(statusStr: string | null): string[] {
  if (!statusStr) return []
  // "Scavenger (Alive, Wounded, Determined)" → strip parens/qualifiers, split
  return statusStr
    .replace(/\(([^)]*)\)/g, ',$1')  // unwrap parens into comma list
    .split(',')
    .map(s => s.trim())
    .filter(s => s && !/^alive$/i.test(s))  // drop generic "Alive"
}

// ── JSON block extraction ─────────────────────────────────────────────────────

function parseJsonBlock(text: string): Record<string, unknown> {
  const m = text.match(/```json\s*([\s\S]*?)```/i)
  if (!m) return {}
  try { return JSON.parse(m[1]) as Record<string, unknown> } catch { return {} }
}

// ── character_type heuristic ─────────────────────────────────────────────────

function inferCharacterType(key: string): 'pc' | 'npc' | 'enemy' | 'neutral' {
  const slug = key.replace(/^character:/, '')
  if (slug === 'player') return 'pc'
  if (/^guard[-_]?\d*$/.test(slug)) return 'npc'
  return 'npc'
}

// ── Main mapper ───────────────────────────────────────────────────────────────

export function parseKvCharToD1(kvKey: string, text: string, newId: string): D1CharInsert {
  const now = new Date().toISOString()

  // ── Named sections ──────────────────────────────────────────────────────────
  const { sections } = parseLoreSections(text, [
    'Mechanical Scaffolding',
    'State Machine',
    'Background & History',
    'Background',
    'History',
    'Interaction Weights',
    'Sensory Profile',
    'Inventory',
  ])

  // Combine Mechanical Scaffolding + State Machine sub-section (### headings create separate boundaries)
  const scaffolding = (sections['Mechanical Scaffolding'] ?? '') + '\n' + (sections['State Machine'] ?? '')
  const backgroundText =
    sections['Background & History'] ?? sections['Background'] ?? sections['History'] ?? ''
  const weightsText = sections['Interaction Weights'] ?? ''
  const sensoryText = sections['Sensory Profile'] ?? ''
  const inventoryText = sections['Inventory'] ?? ''

  // ── Header bold fields (top of document) ───────────────────────────────────
  const statusRaw = extractRawField(text, 'Status')
  const motivationRaw = extractRawField(text, 'Motivation')
  const aliasRaw = extractRawField(text, 'Alias')
  const ageRaw = extractRawField(text, 'Age')
  const genderRaw = extractRawField(text, 'Gender')
  const orientationRaw = extractRawField(text, 'Orientation')
  const factionRaw = extractRawField(text, 'Faction')
  const alignmentRaw = extractRawField(text, 'Alignment')
  const raceRaw = extractRawField(text, 'Race')
  const classRaw = extractRawField(text, 'Class') ?? extractRawField(text, 'Character Class')
  const levelRaw = extractFieldFromText(text, 'Level')
  const hpRaw = extractFieldFromText(text, 'HP')
  const maxHpRaw = extractFieldFromText(text, 'Max HP') ?? extractFieldFromText(text, 'Max-HP')
  const acRaw = extractFieldFromText(text, 'AC')

  // ── Mechanical Scaffolding fields ───────────────────────────────────────────
  const scafWeight1 = extractFieldFromText(scaffolding, 'Weight-1')
  const scafWeight2 = extractFieldFromText(scaffolding, 'Weight-2')
  const scafPerception = extractFieldFromText(scaffolding, 'Perception')
  const scafLocation = extractRawField(scaffolding, 'Location')
  const scafThread = extractRawField(scaffolding, 'Thread')
  const scafStage = extractFieldFromText(scaffolding, 'State-Stage')
  const scafTimer = extractFieldFromText(scaffolding, 'Stage-Timer')

  // ── Interaction Weights JSON ────────────────────────────────────────────────
  const weightsJson = parseJsonBlock(weightsText)
  const jsonWeight1 = typeof weightsJson['Weight-1'] === 'number' ? weightsJson['Weight-1'] as number : null
  const jsonWeight2 = typeof weightsJson['Weight-2'] === 'number' ? weightsJson['Weight-2'] as number : null

  // Scaffolding wins over JSON block when both present
  const weight1 = typeof scafWeight1 === 'number' ? scafWeight1 : (jsonWeight1 ?? 0)
  const weight2 = typeof scafWeight2 === 'number' ? scafWeight2 : (jsonWeight2 ?? 0)
  const perceptionFloat = typeof scafPerception === 'number' ? scafPerception : 0

  // ── Sensory profile ─────────────────────────────────────────────────────────
  const sensoryObj: Record<string, string | null> = {}
  if (sensoryText) {
    for (const field of ['Scent', 'Temperature', 'Texture', 'Sound', 'Visual']) {
      const v = extractRawField(sensoryText, field)
      if (v) sensoryObj[field.toLowerCase()] = v
    }
  }

  // ── resource_pools: everything that doesn't have a D1 column ───────────────
  const resourcePools: Record<string, unknown> = {}

  // Flavour/meta from Interaction Weights JSON (exclude Weight-1 and Weight-2 as they're handled separately)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { 'Weight-1': _, 'Weight-2': __, ...restWeights } = weightsJson
  Object.assign(resourcePools, restWeights)

  // Sensory profile
  if (Object.keys(sensoryObj).length > 0) resourcePools['sensory'] = sensoryObj

  // Raw inventory string
  if (inventoryText.trim()) resourcePools['kv_inventory'] = inventoryText.trim()

  // Stage descriptions from scaffolding
  for (let i = 1; i <= 5; i++) {
    const desc = extractRawField(scaffolding, `Stage-${i}-Description`)
    if (desc) resourcePools[`stage_${i}_description`] = desc
  }

  // ── Derived numeric fields ──────────────────────────────────────────────────
  const level = typeof levelRaw === 'number' ? Math.round(levelRaw) : 1
  const defaultHp = level * 8
  const hp = typeof hpRaw === 'number' ? Math.round(hpRaw) : defaultHp
  const maxHp = typeof maxHpRaw === 'number' ? Math.round(maxHpRaw) : defaultHp
  const ac = typeof acRaw === 'number' ? Math.round(acRaw) : 10
  const stateStage = typeof scafStage === 'number' ? Math.round(scafStage) : 1
  const stageTimer = typeof scafTimer === 'number' ? Math.round(scafTimer) : 0
  const perceptionBonus = Math.round(perceptionFloat * 10)

  // ── Conditions ──────────────────────────────────────────────────────────────
  const conditions = parseConditions(statusRaw)

  // ── Behavior: prefer Motivation, fall back to Status prose ─────────────────
  const behavior = motivationRaw ?? statusRaw ?? null

  return {
    id: newId,
    name: parseName(text, kvKey),
    stats: JSON.stringify({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }),
    hp,
    max_hp: maxHp,
    ac,
    level,
    faction_id: factionRaw ?? null,
    behavior,
    character_type: inferCharacterType(kvKey),
    character_class: classRaw ?? 'Fighter',
    race: raceRaw ?? 'Human',
    background: backgroundText ? backgroundText.slice(0, 1000) : null,
    alignment: alignmentRaw ?? null,
    conditions: JSON.stringify(conditions),
    resistances: '[]',
    vulnerabilities: '[]',
    immunities: '[]',
    known_spells: '[]',
    prepared_spells: '[]',
    cantrips_known: '[]',
    currency: '{"gold":0,"silver":0,"copper":0}',
    resource_pools: JSON.stringify(resourcePools),
    xp: 0,
    alias: aliasRaw ?? null,
    age: ageRaw ?? null,
    gender: genderRaw ?? null,
    orientation: orientationRaw ?? null,
    weight_1: weight1,
    weight_2: weight2,
    perception_float: perceptionFloat,
    thread_id: scafThread ?? null,
    state_stage: stateStage,
    state_stage_timer: stageTimer,
    kv_origin: kvKey,
    current_room_id: scafLocation ?? null,
    perception_bonus: perceptionBonus,
    stealth_bonus: 0,
    origin: kvKey,
    created_at: now,
    updated_at: now,
  }
}

// ── D1 row → markdown lore text (for get_lore auto-redirect) ─────────────────

export function formatD1CharToLore(row: Record<string, unknown>): string {
  const lines: string[] = []

  const name = row.name ?? 'Unknown'
  lines.push(`# Character: ${name}`)

  if (row.alias) lines.push(`**Alias:** ${row.alias}`)
  if (row.age) lines.push(`**Age:** ${row.age}`)
  if (row.gender) lines.push(`**Gender:** ${row.gender}`)
  if (row.orientation) lines.push(`**Orientation:** ${row.orientation}`)
  if (row.behavior) lines.push(`**Status:** ${row.behavior}`)
  if (row.faction_id) lines.push(`**Faction:** ${row.faction_id}`)
  if (row.alignment) lines.push(`**Alignment:** ${row.alignment}`)
  if (row.race) lines.push(`**Race:** ${row.race}`)
  if (row.character_class) lines.push(`**Class:** ${row.character_class}`)
  if (row.current_room_id) lines.push(`**Location:** ${row.current_room_id}`)

  lines.push('')
  lines.push('## Stats')
  try {
    const stats = typeof row.stats === 'string' ? JSON.parse(row.stats) : (row.stats ?? {})
    for (const [k, v] of Object.entries(stats as Record<string, unknown>)) {
      lines.push(`**${k.toUpperCase()}:** ${v}`)
    }
  } catch { /* skip malformed stats */ }

  lines.push('')
  lines.push('## Health')
  lines.push(`**HP:** ${row.hp} / ${row.max_hp}`)
  lines.push(`**AC:** ${row.ac}`)
  lines.push(`**Level:** ${row.level}`)
  lines.push(`**XP:** ${row.xp ?? 0}`)

  if (row.weight_1 || row.weight_2) {
    lines.push('')
    lines.push('## Interaction Weights')
    if (row.weight_1) lines.push(`**Weight-1:** ${row.weight_1}`)
    if (row.weight_2) lines.push(`**Weight-2:** ${row.weight_2}`)
    if (row.perception_float) lines.push(`**Perception:** ${row.perception_float}`)
  }

  if (row.thread_id || row.state_stage) {
    lines.push('')
    lines.push('## Mechanical Scaffolding')
    if (row.thread_id) lines.push(`**Thread:** ${row.thread_id}`)
    if (row.state_stage !== undefined) lines.push(`**State-Stage:** ${row.state_stage}`)
    if (row.state_stage_timer !== undefined) lines.push(`**Stage-Timer:** ${row.state_stage_timer}`)
  }

  const conditions = parseJsonArray(row.conditions)
  if (conditions.length > 0) {
    lines.push('')
    lines.push('## Conditions')
    for (const c of conditions) lines.push(`- ${c}`)
  }

  if (row.background) {
    lines.push('')
    lines.push('## Background')
    lines.push(String(row.background))
  }

  try {
    const pools = typeof row.resource_pools === 'string'
      ? JSON.parse(row.resource_pools)
      : (row.resource_pools ?? {})
    const keys = Object.keys(pools as object)
    if (keys.length > 0) {
      lines.push('')
      lines.push('## Resource Pools')
      for (const [k, v] of Object.entries(pools as Record<string, unknown>)) {
        lines.push(`**${k}:** ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      }
    }
  } catch { /* skip malformed pools */ }

  lines.push('')
  lines.push('---')
  lines.push('*Source: D1 database (auto-redirected from legacy KV entry)*')

  return lines.join('\n')
}

function parseJsonArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String)
  if (typeof val === 'string') {
    try { const p = JSON.parse(val); return Array.isArray(p) ? p.map(String) : [] } catch { return [] }
  }
  return []
}
