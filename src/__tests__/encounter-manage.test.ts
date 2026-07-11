// Direct handler tests for encounter-manage (#280)
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach, afterEach, vi } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handleEncounterManage } from '../rpg/handlers/encounter-manage'
import { handleWorldMap } from '../rpg/handlers/world-map'
import { handleBiomeManage } from '../rpg/handlers/biome-manage'

describe('handleEncounterManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)
  const WORLD = 'world-1'

  async function createWorld(id = WORLD) {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare('INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, 'Test World', 'abc123', 100, 100, now, now).run()
  }

  it('returns guiding error for unknown action', async () => {
    const r = await handleEncounterManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  // ── resolve / check ─────────────────────────────────────────────────────

  it('resolve requires worldId, x, and y', async () => {
    const r = await handleEncounterManage(db(), { action: 'resolve', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('resolve returns encounter: false when threshold is 0 (no biome threat, no zones, no modifiers)', async () => {
    await createWorld()
    const r = await handleEncounterManage(db(), { action: 'resolve', worldId: WORLD, x: 5, y: 5 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.encounter).toBe(false)
    expect(body.threshold).toBe(0)
  })

  it('resolve guarantees an encounter when the tile biome has baseThreat 100', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'deadly_ground', baseThreat: 100 })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 5, r: 5, biome: 'deadly_ground' }] })
    const r = await handleEncounterManage(db(), { action: 'resolve', worldId: WORLD, x: 5, y: 5 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.encounter).toBe(true)
    expect(body.threshold).toBe(100)
  })

  it('resolve returns a message and null encounterType when no encounter_types are registered', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'deadly_ground', baseThreat: 100 })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 5, r: 5, biome: 'deadly_ground' }] })
    const r = await handleEncounterManage(db(), { action: 'resolve', worldId: WORLD, x: 5, y: 5 })
    const body = JSON.parse(r.content[0].text)
    expect(body.encounter).toBe(true)
    expect(body.encounterType).toBeNull()
    expect(body.message).toContain('add_type')
  })

  it('resolve excludes types whose minThreat exceeds the resolved threshold', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'deadly_ground', baseThreat: 30 })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 5, r: 5, biome: 'deadly_ground' }] })
    await handleEncounterManage(db(), { action: 'add_type', worldId: WORLD, category: 'predator', predatorName: 'unreachable', minThreat: 90 })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const r = await handleEncounterManage(db(), { action: 'resolve', worldId: WORLD, x: 5, y: 5 })
    const body = JSON.parse(r.content[0].text)
    expect(body.encounter).toBe(true)
    expect(body.encounterType).toBeNull()
  })

  it('resolve selects a registered predator type and returns encounter details', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'deadly_ground', baseThreat: 100 })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 5, r: 5, biome: 'deadly_ground' }] })
    await handleEncounterManage(db(), {
      action: 'add_type', worldId: WORLD, category: 'predator', predatorName: 'giant_panther', aggression: 'hunting', description: 'A giant panther stalks.',
    })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const r = await handleEncounterManage(db(), { action: 'resolve', worldId: WORLD, x: 5, y: 5, includeInjuries: false })
    const body = JSON.parse(r.content[0].text)
    expect(body.encounter).toBe(true)
    expect(body.encounterType).toBe('predator')
    expect(body.predator).toBe('giant_panther')
    expect(body.aggression).toBe('hunting')
    expect(body.encounterDescription).toBe('A giant panther stalks.')
    expect(body.injuries).toEqual([])
  })

  it('resolve assigns and persists an injury for a predator encounter when characterIds are given', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'deadly_ground', baseThreat: 100 })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 5, r: 5, biome: 'deadly_ground' }] })
    await handleEncounterManage(db(), { action: 'add_type', worldId: WORLD, category: 'predator', predatorName: 'giant_panther' })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const r = await handleEncounterManage(db(), { action: 'resolve', worldId: WORLD, x: 5, y: 5, characterIds: ['char-1'] })
    const body = JSON.parse(r.content[0].text)
    expect(body.injuries).toHaveLength(1)
    const injury = body.injuries[0]
    expect(injury.characterId).toBe('char-1')
    expect(injury.injuryId).toBeTruthy()
    expect(['minor', 'moderate', 'severe', 'critical']).toContain(injury.severity)

    const row = await env.RPG_DB.prepare('SELECT * FROM character_injuries WHERE id = ?').bind(injury.injuryId).first() as any
    expect(row).toBeTruthy()
    expect(row.character_id).toBe('char-1')
    expect(row.world_id).toBe(WORLD)
  })

  it('resolve does not persist an injury when no characterIds are given (generic party)', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'deadly_ground', baseThreat: 100 })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 5, r: 5, biome: 'deadly_ground' }] })
    await handleEncounterManage(db(), { action: 'add_type', worldId: WORLD, category: 'predator', predatorName: 'giant_panther' })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const r = await handleEncounterManage(db(), { action: 'resolve', worldId: WORLD, x: 5, y: 5 })
    const body = JSON.parse(r.content[0].text)
    expect(body.injuries).toHaveLength(1)
    expect(body.injuries[0].characterId).toBeNull()
    expect(body.injuries[0].injuryId).toBeNull()
  })

  it('resolve skips injuries entirely when includeInjuries is false', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'deadly_ground', baseThreat: 100 })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 5, r: 5, biome: 'deadly_ground' }] })
    await handleEncounterManage(db(), { action: 'add_type', worldId: WORLD, category: 'predator', predatorName: 'giant_panther' })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const r = await handleEncounterManage(db(), { action: 'resolve', worldId: WORLD, x: 5, y: 5, includeInjuries: false })
    const body = JSON.parse(r.content[0].text)
    expect(body.injuries).toEqual([])
  })

  it('resolve skips injuries for a non-predator encounter category', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'deadly_ground', baseThreat: 100 })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 5, r: 5, biome: 'deadly_ground' }] })
    await handleEncounterManage(db(), { action: 'add_type', worldId: WORLD, category: 'environmental', description: 'A rockslide.' })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const r = await handleEncounterManage(db(), { action: 'resolve', worldId: WORLD, x: 5, y: 5 })
    const body = JSON.parse(r.content[0].text)
    expect(body.encounterType).toBe('environmental')
    expect(body.injuries).toEqual([])
  })

  it('resolve flags displacement when the selected type belongs to a suppressed subordinate zone', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'deadly_ground', baseThreat: 100 })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 5, r: 5, biome: 'deadly_ground' }] })
    // Dominant zone (higher dominanceRank) — no registered encounter_type for it.
    await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', q: 5, r: 5, radius: 10,
      zoneType: 'territory', predatorRef: 'giant_panther', threatLevel: 40, dominanceRank: 10,
    })
    // Subordinate zone (lower dominanceRank) — the only registered type belongs here.
    await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Leonar Range', q: 5, r: 5, radius: 10,
      zoneType: 'territory', predatorRef: 'leonar', threatLevel: 20, dominanceRank: 1,
    })
    await handleEncounterManage(db(), { action: 'add_type', worldId: WORLD, category: 'predator', predatorName: 'leonar', description: 'A displaced Leonar hunts at the edge of its former range.' })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const r = await handleEncounterManage(db(), { action: 'resolve', worldId: WORLD, x: 5, y: 5, includeInjuries: false })
    const body = JSON.parse(r.content[0].text)
    expect(body.encounter).toBe(true)
    expect(body.predator).toBe('leonar')
    expect(body.displaced).toBe(true)
    expect(body.displacedBy).toBe('giant_panther')
    expect(body.threatLevel).toBe(20)
  })

  it('resolve does not flag displacement for the sole/dominant zone', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'deadly_ground', baseThreat: 100 })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 5, r: 5, biome: 'deadly_ground' }] })
    await handleWorldMap(db(), {
      action: 'suggest_poi', worldId: WORLD, query: 'Panther Range', q: 5, r: 5, radius: 10,
      zoneType: 'territory', predatorRef: 'giant_panther', threatLevel: 40, dominanceRank: 10,
    })
    await handleEncounterManage(db(), { action: 'add_type', worldId: WORLD, category: 'predator', predatorName: 'giant_panther' })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const r = await handleEncounterManage(db(), { action: 'resolve', worldId: WORLD, x: 5, y: 5, includeInjuries: false })
    const body = JSON.parse(r.content[0].text)
    expect(body.displaced).toBe(false)
    expect(body.displacedBy).toBeNull()
  })

  it('resolve falls back to the unfiltered type list when every requiresCore type fails the core check', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'deadly_ground', baseThreat: 100 })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 5, r: 5, biome: 'deadly_ground' }] })
    // requiresCore but no zone at this point matches 'silverback' at all.
    await handleEncounterManage(db(), { action: 'add_type', worldId: WORLD, category: 'predator', predatorName: 'silverback', requiresCore: true })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const r = await handleEncounterManage(db(), { action: 'resolve', worldId: WORLD, x: 5, y: 5, includeInjuries: false })
    const body = JSON.parse(r.content[0].text)
    expect(body.encounter).toBe(true)
    expect(body.predator).toBe('silverback')
  })

  it('check returns encounter/roll/threshold without selecting a type or assigning injuries', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'deadly_ground', baseThreat: 100 })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 5, r: 5, biome: 'deadly_ground' }] })
    await handleEncounterManage(db(), { action: 'add_type', worldId: WORLD, category: 'predator', predatorName: 'giant_panther' })
    const r = await handleEncounterManage(db(), { action: 'check', worldId: WORLD, x: 5, y: 5, characterIds: ['char-1'] })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.actionType).toBe('check')
    expect(body.encounter).toBe(true)
    expect(body.encounterType).toBeUndefined()
    expect(body.injuries).toBeUndefined()
    // "check" is the lightweight peek — even with characterIds given, it must
    // never persist an injury (that's resolve's job).
    const { results } = await env.RPG_DB.prepare('SELECT * FROM character_injuries WHERE character_id = ?').bind('char-1').all()
    expect(results).toEqual([])
  })

  // ── modifiers ─────────────────────────────────────────────────────────────

  it('check applies the dawn/dusk time modifier (+5)', async () => {
    await createWorld()
    const r = await handleEncounterManage(db(), { action: 'check', worldId: WORLD, x: 5, y: 5, timeOfDay: 'dawn' })
    const body = JSON.parse(r.content[0].text)
    expect(body.modifiers.time).toBe(5)
    expect(body.threshold).toBe(5)
  })

  it('check applies the midday time modifier (-5, clamped to 0 threshold)', async () => {
    await createWorld()
    const r = await handleEncounterManage(db(), { action: 'check', worldId: WORLD, x: 5, y: 5, timeOfDay: 'midday' })
    const body = JSON.parse(r.content[0].text)
    expect(body.modifiers.time).toBe(-5)
    expect(body.threshold).toBe(0)
  })

  it('check applies the loud noise modifier (+8)', async () => {
    await createWorld()
    const r = await handleEncounterManage(db(), { action: 'check', worldId: WORLD, x: 5, y: 5, noiseLevel: 'loud' })
    const body = JSON.parse(r.content[0].text)
    expect(body.modifiers.noise).toBe(8)
  })

  it('check sums multiple distinct scent modifiers', async () => {
    await createWorld()
    const r = await handleEncounterManage(db(), { action: 'check', worldId: WORLD, x: 5, y: 5, scentModifiers: ['blood', 'cooking'] })
    const body = JSON.parse(r.content[0].text)
    expect(body.modifiers.scent).toBe(25)
  })

  it('check applies +2 threat per party member beyond the first', async () => {
    await createWorld()
    const r = await handleEncounterManage(db(), { action: 'check', worldId: WORLD, x: 5, y: 5, partySize: 4 })
    const body = JSON.parse(r.content[0].text)
    expect(body.modifiers.partySize).toBe(6)
  })

  it('check applies +10 when every party member is injured', async () => {
    await createWorld()
    const r = await handleEncounterManage(db(), { action: 'check', worldId: WORLD, x: 5, y: 5, partyInjuries: ['bleeding', 'concussed'] })
    const body = JSON.parse(r.content[0].text)
    expect(body.modifiers.partyInjured).toBe(10)
  })

  it('check does not apply the injured-party modifier when at least one member is uninjured', async () => {
    await createWorld()
    const r = await handleEncounterManage(db(), { action: 'check', worldId: WORLD, x: 5, y: 5, partyInjuries: ['none', 'bleeding'] })
    const body = JSON.parse(r.content[0].text)
    expect(body.modifiers.partyInjured).toBeUndefined()
  })

  it('check applies weather modifiers (rain -5, fog +3)', async () => {
    await createWorld()
    const rain = await handleEncounterManage(db(), { action: 'check', worldId: WORLD, x: 5, y: 5, weather: 'rain' })
    expect(JSON.parse(rain.content[0].text).modifiers.weather).toBe(-5)
    const fog = await handleEncounterManage(db(), { action: 'check', worldId: WORLD, x: 5, y: 5, weather: 'fog' })
    expect(JSON.parse(fog.content[0].text).modifiers.weather).toBe(3)
  })

  // ── list_types / add_type ─────────────────────────────────────────────────

  it('list_types requires worldId', async () => {
    const r = await handleEncounterManage(db(), { action: 'list_types' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('list_types returns empty for a world with none registered', async () => {
    await createWorld()
    const r = await handleEncounterManage(db(), { action: 'list_types', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBe(0)
  })

  it('add_type requires worldId and category', async () => {
    const r = await handleEncounterManage(db(), { action: 'add_type' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('add_type registers a type with defaults applied', async () => {
    await createWorld()
    const r = await handleEncounterManage(db(), { action: 'add_type', worldId: WORLD, category: 'predator', predatorName: 'giant_panther' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.typeId).toBeTruthy()
    expect(body.predatorName).toBe('giant_panther')
  })

  it('list_types filters by categoryFilter', async () => {
    await createWorld()
    await handleEncounterManage(db(), { action: 'add_type', worldId: WORLD, category: 'predator', predatorName: 'giant_panther' })
    await handleEncounterManage(db(), { action: 'add_type', worldId: WORLD, category: 'environmental', description: 'A rockslide.' })
    const r = await handleEncounterManage(db(), { action: 'list_types', worldId: WORLD, categoryFilter: 'environmental' })
    const body = JSON.parse(r.content[0].text)
    expect(body.count).toBe(1)
    expect(body.types[0].category).toBe('environmental')
  })

  // ── check_infection ───────────────────────────────────────────────────────

  it('check_infection requires injuryId', async () => {
    const r = await handleEncounterManage(db(), { action: 'check_infection' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('check_infection returns not found for an unknown injuryId', async () => {
    const r = await handleEncounterManage(db(), { action: 'check_infection', injuryId: 'no-such-injury' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  async function createInjury(severity: string): Promise<string> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO character_injuries (id, character_id, world_id, severity, injury_type, location, ability, ability_modifier, bleeding_rate, infection_risk, recovery, description, treated, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)'
    ).bind(id, 'char-1', WORLD, severity, 'deep_laceration', 'forearm', 'DEX', -2, '1_HP_per_hour', 'CON_DC_14_after_24h', 'first_aid', 'A wound.', now, now).run()
    return id
  }

  it('check_infection reports no infection for a minor injury regardless of time', async () => {
    await createWorld()
    const injuryId = await createInjury('minor')
    const r = await handleEncounterManage(db(), { action: 'check_infection', injuryId, hoursSinceInjury: 100 })
    const body = JSON.parse(r.content[0].text)
    expect(body.infected).toBe(false)
  })

  it('check_infection reports no infection for a moderate injury before the 24h onset', async () => {
    await createWorld()
    const injuryId = await createInjury('moderate')
    const r = await handleEncounterManage(db(), { action: 'check_infection', injuryId, hoursSinceInjury: 10 })
    const body = JSON.parse(r.content[0].text)
    expect(body.infected).toBe(false)
    expect(body.stage).toBe('none')
  })

  it('check_infection reports fever stage for a moderate untreated injury after 24h', async () => {
    await createWorld()
    const injuryId = await createInjury('moderate')
    const r = await handleEncounterManage(db(), { action: 'check_infection', injuryId, hoursSinceInjury: 30 })
    const body = JSON.parse(r.content[0].text)
    expect(body.infected).toBe(true)
    expect(body.stage).toBe('fever')
    expect(body.effect).toContain('sepsis')
  })

  it('check_infection reports sepsis stage for a moderate untreated injury after 48h', async () => {
    await createWorld()
    const injuryId = await createInjury('moderate')
    const r = await handleEncounterManage(db(), { action: 'check_infection', injuryId, hoursSinceInjury: 60 })
    const body = JSON.parse(r.content[0].text)
    expect(body.infected).toBe(true)
    expect(body.stage).toBe('sepsis')
  })

  it('check_infection reports sepsis earlier (36h) for a severe injury', async () => {
    await createWorld()
    const injuryId = await createInjury('severe')
    const r = await handleEncounterManage(db(), { action: 'check_infection', injuryId, hoursSinceInjury: 36 })
    const body = JSON.parse(r.content[0].text)
    expect(body.stage).toBe('sepsis')
  })

  it('check_infection reports no infection when treatment has been received', async () => {
    await createWorld()
    const injuryId = await createInjury('moderate')
    const r = await handleEncounterManage(db(), { action: 'check_infection', injuryId, hoursSinceInjury: 60, treatmentReceived: 'basic' })
    const body = JSON.parse(r.content[0].text)
    expect(body.infected).toBe(false)
    expect(body.stage).toBe('treated')
  })

  it('check_infection reports no infection for a critical injury regardless of time', async () => {
    await createWorld()
    const injuryId = await createInjury('critical')
    const r = await handleEncounterManage(db(), { action: 'check_infection', injuryId, hoursSinceInjury: 100 })
    const body = JSON.parse(r.content[0].text)
    expect(body.infected).toBe(false)
  })

  // ── #284 — stealthCheck integration ─────────────────────────────────────

  it('resolve short-circuits with confrontationAvoided when stealth is a clean avoidance', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'deadly_ground', baseThreat: 100 })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 5, r: 5, biome: 'deadly_ground' }] })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const r = await handleEncounterManage(db(), {
      action: 'resolve', worldId: WORLD, x: 5, y: 5,
      stealthCheck: true, yieldStealthRoll: 20, stealthMode: 'hiding', distanceZone: 'edge', windDirection: 'away',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.confrontationAvoided).toBe(true)
    expect(body.encounter).toBe(false)
    expect(body.roll).toBe(0)
    expect(body.threshold).toBe(0)
    expect(body.stealthResult.outcome).toBe('avoided_entirely')
    // Short-circuits before the threat roll — no encounter type is selected.
    expect(body.encounterType).toBeUndefined()
  })

  it('check also short-circuits with confrontationAvoided/stealthResult on a tense_moment', async () => {
    await createWorld()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const r = await handleEncounterManage(db(), {
      action: 'check', worldId: WORLD, x: 5, y: 5,
      stealthCheck: true, yieldStealthRoll: 3, stealthMode: 'active', distanceZone: 'unknown', windDirection: 'none',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.confrontationAvoided).toBe(true)
    expect(body.stealthResult.outcome).toBe('tense_moment')
  })

  it('resolve continues the normal threshold pipeline and attaches stealthResult when the predator wins the opposed check', async () => {
    await createWorld()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const r = await handleEncounterManage(db(), {
      action: 'resolve', worldId: WORLD, x: 5, y: 5,
      stealthCheck: true, yieldStealthRoll: 1, stealthMode: 'rushed', distanceZone: 'core', windDirection: 'toward', yieldBleeding: true,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.confrontationAvoided).toBeUndefined()
    expect(body.stealthResult.outcome).toBe('ambushed')
    expect(body.stealthResult.advantage).toBe('predator')
    // No biome threat registered — the normal threshold pipeline still runs
    // and reports no encounter, independent of the stealth outcome.
    expect(body.encounter).toBe(false)
  })

  it('resolve attaches a full stealthResult alongside a normal triggered+selected encounter', async () => {
    await createWorld()
    await handleBiomeManage(db(), { action: 'register', worldId: WORLD, name: 'deadly_ground', baseThreat: 100 })
    await handleWorldMap(db(), { action: 'patch', worldId: WORLD, hexes: [{ q: 5, r: 5, biome: 'deadly_ground' }] })
    await handleEncounterManage(db(), { action: 'add_type', worldId: WORLD, category: 'predator', predatorName: 'giant_panther' })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const r = await handleEncounterManage(db(), {
      action: 'resolve', worldId: WORLD, x: 5, y: 5, includeInjuries: false,
      stealthCheck: true, yieldStealthRoll: 1,
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.encounter).toBe(true)
    expect(body.encounterType).toBe('predator')
    expect(body.stealthResult.outcome).toBe('predator_searching')
  })

  it('resolve without stealthCheck omits stealthResult entirely', async () => {
    await createWorld()
    const r = await handleEncounterManage(db(), { action: 'resolve', worldId: WORLD, x: 5, y: 5 })
    const body = JSON.parse(r.content[0].text)
    expect(body.stealthResult).toBeUndefined()
  })
})
