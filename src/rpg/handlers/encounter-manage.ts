// Encounter resolution engine (#280) — rpg({ sub: "encounter", action: "..." }).
// Resolves a single 1d100 threat check (biome base + zone threat, with a
// first-pass dominance/suppression model — see resolveZoneThreat below — +
// contextual modifiers), selects a weighted encounter type, and optionally
// assigns/persists an injury. Deliberately does NOT do combat resolution,
// predator-behavior AI, or stealth/perception checks — see the issue's
// Non-Goals; those stay with combat_manage / perception_manage.
//
// Design decisions made explicitly (not fully specified by the issue —
// documented here and in the PR/changelog rather than guessed silently):
//
// - Zone "threat level" (0-100) and "dominance rank" are new optional fields
//   on world_map's zone columns (see world-map.ts's mergeZoneFields) —
//   the issue assumed query_zone already returned "resolved threat data with
//   dominance suppression", but #276 as shipped only carried shape/type/
//   predator, no numeric threat concept at all.
// - Dominance/suppression: among zones overlapping a point, the one with the
//   highest dominanceRank is "dominant" and contributes its full threatLevel;
//   every other overlapping zone is a suppressed subordinate contributing at
//   30% weight. If the selected encounter type belongs to a subordinate zone,
//   the response flags `displaced: true` / `displacedBy: <dominant predator>`.
// - Injury severity is derived from how far the 1d100 roll cleared the
//   threshold (`margin = threshold - roll`), not a second independent d20
//   "save" — this ties injury severity organically to how dangerous the
//   triggered encounter was without introducing an unexplained second
//   mechanic. Margin bands: 0-20 minor, 21-40 moderate, 41-60 severe, 61+
//   critical.
// - `encounter_types` has no default seed data (unlike biomes) — predator
//   rosters are narrative-specific per world (Calder's giant_panther/leonar
//   have no meaning for a generic fantasy world), so every world's roster is
//   narrator-authored via add_type.

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'
import { resolveZonesAt, type ResolvedZone } from './world-map'
import { getBiomeRegistry } from './biome-manage'
import { predatorPerceptionModifier, yieldStealthModifier, stealthOutcomeFromMargin, type StealthOutcome, type StealthAdvantage } from './perception-manage'

const ACTIONS = ['resolve', 'check', 'list_types', 'add_type', 'check_infection'] as const
type EncounterAction = typeof ACTIONS[number]
const ALIASES: Record<string, EncounterAction> = {
  encounter: 'resolve', trigger: 'resolve', roll_encounter: 'resolve',
  check_encounter: 'check', peek: 'check', threat_check: 'check',
  types: 'list_types', list_encounter_types: 'list_types',
  register_type: 'add_type', new_type: 'add_type', create_type: 'add_type',
  infection: 'check_infection', infection_check: 'check_infection',
}

const CATEGORIES = ['predator', 'environmental', 'system', 'passive'] as const
const AGGRESSIONS = ['curious', 'hunting', 'territorial', 'starving', 'fleeing'] as const

const InputSchema = z.object({
  action: z.string(),
  worldId: z.string().optional(),
  q: z.number().int().optional(),
  r: z.number().int().optional(),
  partySize: z.number().int().min(1).optional().default(1),
  timeOfDay: z.enum(['dawn', 'dusk', 'night', 'midday', 'day']).optional(),
  noiseLevel: z.enum(['loud', 'moderate', 'silent']).optional(),
  scentModifiers: z.array(z.enum(['blood', 'cooking', 'fire'])).optional().default([]),
  partyInjuries: z.array(z.string()).optional().default(['none']),
  weather: z.enum(['clear', 'rain', 'snow', 'fog']).optional(),
  includeInjuries: z.boolean().optional().default(true),
  characterIds: z.array(z.string()).optional().default([]),
  // #284 — optional stealth/perception opposed check ahead of the threat
  // roll. See perception-manage.ts for the shared modifier tables/outcome
  // bands; resolveEncounterCore short-circuits on avoided_entirely/
  // tense_moment (no confrontation, no threat roll needed at all) and
  // otherwise proceeds to the normal threshold pipeline with the stealth
  // result attached for context.
  stealthCheck: z.boolean().optional().default(false),
  stealthMode: z.enum(['active', 'passive', 'rushed', 'hiding']).optional().default('active'),
  coverType: z.string().optional(),
  windDirection: z.enum(['toward', 'away', 'crosswind', 'none']).optional().default('none'),
  distanceZone: z.enum(['core', 'edge', 'unknown']).optional().default('unknown'),
  yieldBleeding: z.boolean().optional().default(false),
  yieldCookingOrFire: z.boolean().optional().default(false),
  isNight: z.boolean().optional().default(false),
  yieldStealthBonus: z.number().optional().default(0),
  predatorPerceptionBonus: z.number().optional().default(0),
  yieldStealthRoll: z.number().int().min(1).max(20).optional(),
  // add_type
  predatorName: z.string().optional(),
  category: z.enum(CATEGORIES).optional(),
  aggression: z.enum(AGGRESSIONS).optional(),
  baseWeight: z.number().min(0).optional(),
  minThreat: z.number().min(0).max(100).optional(),
  requiresCore: z.boolean().optional(),
  description: z.string().optional(),
  // list_types
  categoryFilter: z.enum(CATEGORIES).optional(),
  // check_infection
  characterId: z.string().optional(),
  injuryId: z.string().optional(),
  hoursSinceInjury: z.number().min(0).optional(),
  treatmentReceived: z.enum(['none', 'basic', 'professional']).optional().default('none'),
})

// ── Threat modifier table (from the issue) ──────────────────────────────────

function computeModifiers(input: {
  timeOfDay?: string
  noiseLevel?: string
  scentModifiers: string[]
  partySize: number
  partyInjuries: string[]
  weather?: string
}): { total: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {}

  if (input.timeOfDay === 'dawn' || input.timeOfDay === 'dusk') breakdown.time = 5
  else if (input.timeOfDay === 'night') breakdown.time = 3
  else if (input.timeOfDay === 'midday') breakdown.time = -5

  if (input.noiseLevel === 'loud') breakdown.noise = 8
  else if (input.noiseLevel === 'moderate') breakdown.noise = 3
  else if (input.noiseLevel === 'silent') breakdown.noise = -5

  let scent = 0
  for (const s of new Set(input.scentModifiers)) {
    if (s === 'blood') scent += 15
    else if (s === 'cooking') scent += 10
    else if (s === 'fire') scent += 3
  }
  if (scent) breakdown.scent = scent

  const extraParty = Math.max(0, input.partySize - 1) * 2
  if (extraParty) breakdown.partySize = extraParty

  if (input.partyInjuries.length > 0 && input.partyInjuries.every(i => i !== 'none')) breakdown.partyInjured = 10

  if (input.weather === 'rain' || input.weather === 'snow') breakdown.weather = -5
  else if (input.weather === 'fog') breakdown.weather = 3

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0)
  return { total, breakdown }
}

// ── Zone threat + dominance/suppression (first-pass model, see file header) ─

function resolveZoneThreat(zones: ResolvedZone[]): { zoneThreat: number; dominant: ResolvedZone | null; displaced: ResolvedZone | null } {
  if (zones.length === 0) return { zoneThreat: 0, dominant: null, displaced: null }
  const sorted = [...zones].sort((a, b) => (b.dominanceRank ?? 0) - (a.dominanceRank ?? 0))
  const dominant = sorted[0]
  const subordinates = sorted.slice(1)
  let zoneThreat = dominant.threatLevel ?? 0
  for (const sub of subordinates) zoneThreat += (sub.threatLevel ?? 0) * 0.3
  const displaced = subordinates.length > 0
    ? subordinates.reduce((max, z) => (z.threatLevel ?? 0) > (max.threatLevel ?? 0) ? z : max)
    : null
  return { zoneThreat, dominant, displaced }
}

// ── Injury tables (from the issue) ──────────────────────────────────────────

type InjurySeverity = 'minor' | 'moderate' | 'severe' | 'critical'

function injurySeverityFromMargin(margin: number): InjurySeverity {
  if (margin >= 61) return 'critical'
  if (margin >= 41) return 'severe'
  if (margin >= 21) return 'moderate'
  return 'minor'
}

const INJURY_TIERS: Record<InjurySeverity, { abilityModifier: number; bleedingRate: string | null; infectionRisk: string | null; recovery: string }> = {
  minor: { abilityModifier: -1, bleedingRate: null, infectionRisk: null, recovery: '1d6 hours rest' },
  moderate: { abilityModifier: -2, bleedingRate: '1_HP_per_hour', infectionRisk: 'CON_DC_14_after_24h', recovery: 'WIS_DC_14_first_aid_plus_1d3_days_rest' },
  severe: { abilityModifier: -4, bleedingRate: '1d4_HP_per_hour', infectionRisk: 'CON_DC_16_after_12h', recovery: 'surgery_plus_1d6_days_rest_permanent_scar' },
  critical: { abilityModifier: 0, bleedingRate: 'death_saves', infectionRisk: null, recovery: 'evacuation_or_death' },
}

const INJURY_FLAVOR: Record<'minor' | 'moderate' | 'severe', Array<{ type: string; ability: string; location: string; description: string }>> = {
  minor: [
    { type: 'bruising', ability: 'STR', location: 'shoulder', description: 'A glancing blow leaves a deep bruise.' },
    { type: 'scratch', ability: 'DEX', location: 'forearm', description: 'Claws rake shallow lines across the skin.' },
  ],
  moderate: [
    { type: 'deep_laceration', ability: 'DEX', location: 'forearm', description: 'A claw opens the skin to the bone. The bleeding will not stop on its own.' },
    { type: 'sprain', ability: 'STR', location: 'ankle', description: 'A hard fall wrenches the joint.' },
  ],
  severe: [
    { type: 'crushing_bite', ability: 'STR', location: 'leg', description: 'Jaws close and do not let go easily.' },
    { type: 'deep_puncture', ability: 'CON', location: 'torso', description: 'A claw drives deep before tearing free.' },
  ],
}

function describePredator(predator: string | null): string {
  if (!predator) return 'The predator'
  const words = predator.split('_').map(w => w[0].toUpperCase() + w.slice(1))
  return words.join(' ')
}

function buildInjury(severity: InjurySeverity, predator: string | null): {
  severity: InjurySeverity; type: string; ability: string; location: string; description: string
  abilityModifier: number; bleedingRate: string | null; infectionRisk: string | null; recovery: string
} {
  const tier = INJURY_TIERS[severity]
  if (severity === 'critical') {
    return {
      severity, type: 'critical_trauma', ability: 'CON', location: 'torso',
      description: `${describePredator(predator)} strikes a killing blow — only immediate stabilization can save them.`,
      ...tier,
    }
  }
  const flavors = INJURY_FLAVOR[severity]
  const flavor = flavors[Math.floor(Math.random() * flavors.length)]
  return {
    severity, type: flavor.type, ability: flavor.ability, location: flavor.location,
    description: `${describePredator(predator)}'s attack: ${flavor.description}`,
    ...tier,
  }
}

function computeInfectionStage(severity: string, hoursSinceInjury: number, treatment: string): { infected: boolean; stage: string; effect: string | null } {
  if (severity === 'minor' || severity === 'critical') return { infected: false, stage: 'none', effect: null }
  if (treatment && treatment !== 'none') return { infected: false, stage: 'treated', effect: null }
  const onsetHours = severity === 'severe' ? 12 : 24
  const sepsisHours = severity === 'severe' ? 36 : 48
  if (hoursSinceInjury >= sepsisHours) {
    return { infected: true, stage: 'sepsis', effect: '-4 to all rolls, CON save DC 18 or drop to 0 HP without immediate care' }
  }
  if (hoursSinceInjury >= onsetHours) {
    return { infected: true, stage: 'fever', effect: `-1 to all rolls, escalates to sepsis in ${sepsisHours - hoursSinceInjury}h if untreated` }
  }
  return { infected: false, stage: 'none', effect: null }
}

export interface EncounterResolveInput {
  worldId: string
  q: number
  r: number
  partySize?: number
  timeOfDay?: string
  noiseLevel?: string
  scentModifiers?: string[]
  partyInjuries?: string[]
  weather?: string
  includeInjuries?: boolean
  characterIds?: string[]
  // "check" (issue's light version — "only checks IF an encounter triggers")
  // stops right after the roll: no encounter_types query, no type selection,
  // no injury persistence. Without this flag, a `check` call would still pay
  // for the full type-selection query even though the response discards it.
  lightweight?: boolean
  // #284 — stealth/perception opposed check, see InputSchema comment above.
  stealthCheck?: boolean
  stealthMode?: 'active' | 'passive' | 'rushed' | 'hiding'
  coverType?: string
  windDirection?: 'toward' | 'away' | 'crosswind' | 'none'
  distanceZone?: 'core' | 'edge' | 'unknown'
  yieldBleeding?: boolean
  yieldCookingOrFire?: boolean
  isNight?: boolean
  yieldStealthBonus?: number
  predatorPerceptionBonus?: number
  yieldStealthRoll?: number
}

export interface EncounterStealthResult {
  outcome: StealthOutcome
  advantage: StealthAdvantage
  yieldRoll: number
  predatorRoll: number
  yieldTotal: number
  predatorTotal: number
  margin: number
}

export interface EncounterInjuryResult {
  characterId: string | null
  injuryId: string | null
  severity: InjurySeverity
  type: string
  ability: string
  location: string
  description: string
  abilityModifier: number
  bleedingRate: string | null
  infectionRisk: string | null
  recovery: string
}

export interface EncounterResolveResult {
  worldId: string
  q: number
  r: number
  encounter: boolean
  roll: number
  threshold: number
  modifiers: Record<string, number>
  encounterType?: string | null
  predator?: string | null
  aggression?: string | null
  threatLevel?: number | null
  displaced?: boolean
  displacedBy?: string | null
  encounterDescription?: string | null
  injuries?: EncounterInjuryResult[]
  message?: string
  confrontationAvoided?: boolean
  stealthResult?: EncounterStealthResult
}

// Core resolution logic, shared by handleEncounterManage's resolve/check
// actions and travel-manage.ts's optional resolveEncounter integration (#280
// — travel operates on room_nodes, which has no world_id/q/r at all, so
// callers wanting an encounter roll on travel must supply worldId/q/r
// explicitly; see travel-manage.ts for the fallback when they don't).
export async function resolveEncounterCore(db: D1Database, input: EncounterResolveInput): Promise<EncounterResolveResult> {
  const { worldId, q, r } = input
  const partySize = input.partySize ?? 1
  const partyInjuries = input.partyInjuries ?? ['none']
  const scentModifiers = input.scentModifiers ?? []
  const includeInjuries = input.includeInjuries ?? true
  const characterIds = input.characterIds ?? []
  const now = new Date().toISOString()

  let stealthResult: EncounterStealthResult | undefined
  if (input.stealthCheck) {
    const yieldRoll = input.yieldStealthRoll ?? Math.floor(Math.random() * 20) + 1
    const predatorRoll = Math.floor(Math.random() * 20) + 1
    const yieldMod = yieldStealthModifier({
      stealthMode: input.stealthMode ?? 'active', coverType: input.coverType, isNight: input.isNight ?? false, partySize,
    })
    const predatorMod = predatorPerceptionModifier({
      distanceZone: input.distanceZone ?? 'unknown', windDirection: input.windDirection ?? 'none',
      yieldBleeding: input.yieldBleeding ?? false, yieldCookingOrFire: input.yieldCookingOrFire ?? false,
    })
    const yieldTotal = yieldRoll + (input.yieldStealthBonus ?? 0) + yieldMod.total
    const predatorTotal = predatorRoll + (input.predatorPerceptionBonus ?? 0) + predatorMod.total
    const margin = yieldTotal - predatorTotal
    const { outcome, advantage } = stealthOutcomeFromMargin(margin)
    stealthResult = { outcome, advantage, yieldRoll, predatorRoll, yieldTotal, predatorTotal, margin }

    // Clean avoidance or a near-miss with no advantage either way means no
    // confrontation at all — skip the threat roll entirely rather than
    // rolling a threshold check nobody needs.
    if (outcome === 'avoided_entirely' || outcome === 'tense_moment') {
      return { worldId, q, r, encounter: false, roll: 0, threshold: 0, modifiers: {}, confrontationAvoided: true, stealthResult }
    }
  }

  const zones = await resolveZonesAt(db, worldId, q, r)
  const { zoneThreat, dominant } = resolveZoneThreat(zones)

  const registry = await getBiomeRegistry(db, worldId)
  // #320 — the RPG engine's terrain grid is now the hex-axial `hexes` table
  // (unified with the map editor, #308/#319).
  const hex = await db.prepare('SELECT biome FROM hexes WHERE world_id = ? AND q = ? AND r = ?').bind(worldId, q, r).first() as { biome: string } | null
  const biomeBase = hex ? (registry.get(hex.biome)?.baseThreat ?? 0) : 0

  const { total: modifierTotal, breakdown } = computeModifiers({
    timeOfDay: input.timeOfDay, noiseLevel: input.noiseLevel, scentModifiers, partySize, partyInjuries, weather: input.weather,
  })

  const threshold = Math.max(0, Math.min(100, biomeBase + zoneThreat + modifierTotal))
  const roll = Math.floor(Math.random() * 100) + 1
  const triggered = roll <= threshold

  if (input.lightweight || !triggered) {
    return { worldId, q, r, encounter: triggered, roll, threshold, modifiers: breakdown, stealthResult }
  }

  const { results: allTypes } = await db.prepare('SELECT * FROM encounter_types WHERE world_id = ? AND min_threat <= ?').bind(worldId, threshold).all() as
    { results: Array<{ id: string; predator_name: string | null; category: string; aggression: string; base_weight: number; min_threat: number; requires_core: number; description: string | null }> }

  if (allTypes.length === 0) {
    return {
      worldId, q, r, encounter: true, roll, threshold, modifiers: breakdown, encounterType: null, stealthResult,
      message: 'Encounter triggered but no encounter_types are registered for this threshold — use encounter.add_type to register some, or lower an existing type\'s minThreat.',
    }
  }

  const zoneByPredator = new Map(zones.filter(z => z.predator).map(z => [z.predator as string, z]))
  // requires_core types only appear when the point falls within that
  // predator's own zone; if that filters out every candidate, fall back
  // to the unfiltered list rather than reporting no encounter type at
  // all for an encounter that already triggered.
  const coreFiltered = allTypes.filter(t => !t.requires_core || (t.predator_name ? zoneByPredator.has(t.predator_name) : false))
  const types = coreFiltered.length > 0 ? coreFiltered : allTypes

  const weighted = types.map(t => {
    const zone = t.predator_name ? zoneByPredator.get(t.predator_name) : undefined
    const boost = zone?.threatLevel ? 1 + zone.threatLevel / 50 : 1
    return { type: t, weight: t.base_weight * boost }
  })
  const totalWeight = weighted.reduce((s, w) => s + w.weight, 0)
  let pick = Math.random() * totalWeight
  let selected = weighted[weighted.length - 1].type
  for (const w of weighted) {
    pick -= w.weight
    if (pick <= 0) { selected = w.type; break }
  }

  const selectedZone = selected.predator_name ? zoneByPredator.get(selected.predator_name) : undefined
  const isDisplaced = !!selectedZone && dominant !== null && selectedZone.landmarkId !== dominant.landmarkId
  const displacedBy = isDisplaced ? (dominant!.predator ?? dominant!.name) : null

  const margin = threshold - roll
  const injuries: EncounterInjuryResult[] = []
  if (includeInjuries && selected.category === 'predator') {
    const severity = injurySeverityFromMargin(margin)
    const targets: Array<string | null> = characterIds.length > 0 ? characterIds : [null]
    for (const characterId of targets) {
      const injury = buildInjury(severity, selected.predator_name)
      let injuryId: string | null = null
      if (characterId) {
        injuryId = crypto.randomUUID()
        await db.prepare(
          'INSERT INTO character_injuries (id, character_id, world_id, severity, injury_type, location, ability, ability_modifier, bleeding_rate, infection_risk, recovery, description, treated, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)'
        ).bind(injuryId, characterId, worldId, injury.severity, injury.type, injury.location, injury.ability, injury.abilityModifier, injury.bleedingRate, injury.infectionRisk, injury.recovery, injury.description, now, now).run()
      }
      injuries.push({ characterId, injuryId, ...injury })
    }
  }

  return {
    worldId, q, r, encounter: true, roll, threshold, modifiers: breakdown,
    encounterType: selected.category, predator: selected.predator_name, aggression: selected.aggression,
    threatLevel: selectedZone?.threatLevel ?? null,
    displaced: isDisplaced, displacedBy,
    encounterDescription: selected.description,
    injuries, stealthResult,
  }
}

export async function handleEncounterManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'resolve':
    case 'check': {
      if (!a.worldId || a.q === undefined || a.r === undefined) return err('"worldId", "q", and "r" are required')

      const result = await resolveEncounterCore(db, {
        worldId: a.worldId, q: a.q, r: a.r, partySize: a.partySize, timeOfDay: a.timeOfDay, noiseLevel: a.noiseLevel,
        scentModifiers: a.scentModifiers, partyInjuries: a.partyInjuries, weather: a.weather,
        includeInjuries: match.matched === 'resolve' && a.includeInjuries, characterIds: a.characterIds,
        lightweight: match.matched === 'check',
        stealthCheck: a.stealthCheck, stealthMode: a.stealthMode, coverType: a.coverType, windDirection: a.windDirection,
        distanceZone: a.distanceZone, yieldBleeding: a.yieldBleeding, yieldCookingOrFire: a.yieldCookingOrFire,
        isNight: a.isNight, yieldStealthBonus: a.yieldStealthBonus, predatorPerceptionBonus: a.predatorPerceptionBonus,
        yieldStealthRoll: a.yieldStealthRoll,
      })

      if (match.matched === 'check') {
        return ok({ success: true, actionType: 'check', worldId: result.worldId, q: result.q, r: result.r, encounter: result.encounter, roll: result.roll, threshold: result.threshold, modifiers: result.modifiers, confrontationAvoided: result.confrontationAvoided, stealthResult: result.stealthResult })
      }
      return ok({ success: true, actionType: 'resolve', ...result })
    }
    case 'list_types': {
      if (!a.worldId) return err('"worldId" is required')
      let query = 'SELECT * FROM encounter_types WHERE world_id = ?'
      const binds: unknown[] = [a.worldId]
      if (a.categoryFilter) { query += ' AND category = ?'; binds.push(a.categoryFilter) }
      const { results } = await db.prepare(query + ' ORDER BY predator_name, category').bind(...binds).all()
      return ok({ success: true, actionType: 'list_types', worldId: a.worldId, types: results, count: results.length })
    }
    case 'add_type': {
      if (!a.worldId || !a.category) return err('"worldId" and "category" are required')
      const id = crypto.randomUUID()
      await db.prepare('INSERT INTO encounter_types (id, world_id, predator_name, category, aggression, base_weight, min_threat, requires_core, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, a.worldId, a.predatorName ?? null, a.category, a.aggression ?? 'curious', a.baseWeight ?? 1.0, a.minThreat ?? 0, a.requiresCore ? 1 : 0, a.description ?? null, now, now).run()
      return ok({ success: true, actionType: 'add_type', typeId: id, worldId: a.worldId, predatorName: a.predatorName ?? null, category: a.category })
    }
    case 'check_infection': {
      if (!a.injuryId) return err('"injuryId" is required')
      const injury = await db.prepare('SELECT * FROM character_injuries WHERE id = ?').bind(a.injuryId).first() as Record<string, unknown> | null
      if (!injury) return err(`Injury not found: ${a.injuryId}`)
      const hours = a.hoursSinceInjury ?? 0
      const stage = computeInfectionStage(injury.severity as string, hours, a.treatmentReceived)
      return ok({
        success: true, actionType: 'check_infection', injuryId: a.injuryId, characterId: injury.character_id,
        severity: injury.severity, hoursSinceInjury: hours, treatmentReceived: a.treatmentReceived, ...stage,
      })
    }
  }
}
