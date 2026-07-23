// Unit tests for src/rpg/utils/kv-to-d1.ts
// Uses the canonical elowen-thorne fixture (the most complete character in the KV namespace).

import { describe } from './support/helpers'
import { expect, it } from 'vitest'
import { parseKvCharToD1, formatD1CharToLore } from '@/rpg/utils/kv-to-d1'

const ELOWEN_LORE = [
  '# Character:Elowen "Lo" Thorne',
  "**Alias:** Lo (Zira's nickname for her), The Sky-Princess (circus moniker)",
  '**Age:** 25',
  '**Gender:** Female',
  '**Orientation:** Homosexual',
  '**Status:** Scavenger (Alive, Wounded, Determined)',
  '**Location:** Heat-Belt Fringe (Nest Cathedral boundary)',
  '**Motivation:** Everything is secondary to Zira.',
  '**Faction:** celestial-vagabonds',
  '**Alignment:** Chaotic Good',
  '',
  '## Background & History',
  'Elowen was born in the sprawling city of Hecate, the daughter of a seamstress and a dockworker.',
  'She joined The Celestial Vagabonds at 12 and quickly rose to prominence.',
  '',
  '## Interaction Weights',
  '```json',
  '{',
  '  "Weight-1": 0.45,',
  '  "Weight-2": 0.85,',
  '  "Tracking-Sense": 0.2,',
  '  "flavor": { "Weight-1": "Her determination is fierce." }',
  '}',
  '```',
  '',
  '## Mechanical Scaffolding',
  '**Weight-1 (Shaper-Drive):** 0.65',
  '**Weight-2 (Material-Resilience):** 0.45',
  '**Perception:** 0.50',
  '**Thread:** thread:elowen:start-state',
  '**Location:** location:vermi-nest-surface',
  '',
  '### State Machine',
  '**State-Stage:** 1',
  '**Stage-Timer:** 1',
  '**Stage-1-Description:** Surface Search — Elowen navigates the collapsed tunnel entrance.',
  '',
  '### Sensory Profile',
  '**Scent:** Lavender oil, chalk',
  '**Temperature:** 98.6°F',
  '',
  '### Inventory',
  '- bare-hands×1',
  '- trapeze-chalk×1',
].join('\n')

const TEST_KEY = 'character:elowen-thorne'
const TEST_ID = 'test-uuid-1234'

describe('parseKvCharToD1', () => {
  it('extracts name from # Character: header', () => {
    const row = parseKvCharToD1(TEST_KEY, ELOWEN_LORE, TEST_ID)
    expect(row.name).toContain('Elowen')
  })

  it('uses provided id', () => {
    const row = parseKvCharToD1(TEST_KEY, ELOWEN_LORE, TEST_ID)
    expect(row.id).toBe(TEST_ID)
  })

  it('stores kv_origin and origin as the KV key', () => {
    const row = parseKvCharToD1(TEST_KEY, ELOWEN_LORE, TEST_ID)
    expect(row.kv_origin).toBe(TEST_KEY)
    expect(row.origin).toBe(TEST_KEY)
  })

  it('reads current_room_id from Mechanical Scaffolding, not narrative header', () => {
    const row = parseKvCharToD1(TEST_KEY, ELOWEN_LORE, TEST_ID)
    // Scaffolding says "location:vermi-nest-surface", header says "Heat-Belt Fringe..."
    expect(row.current_room_id).toBe('location:vermi-nest-surface')
  })

  it('parses conditions from Status, dropping "Alive"', () => {
    const row = parseKvCharToD1(TEST_KEY, ELOWEN_LORE, TEST_ID)
    const conditions = JSON.parse(row.conditions) as string[]
    expect(conditions).toContain('Wounded')
    expect(conditions).toContain('Determined')
    expect(conditions).not.toContain('Alive')
  })

  it('extracts perception_float and derives perception_bonus', () => {
    const row = parseKvCharToD1(TEST_KEY, ELOWEN_LORE, TEST_ID)
    expect(row.perception_float).toBeCloseTo(0.5, 2)
    expect(row.perception_bonus).toBe(5)
  })

  it('prefers Mechanical Scaffolding weight values over Interaction Weights JSON', () => {
    const row = parseKvCharToD1(TEST_KEY, ELOWEN_LORE, TEST_ID)
    // Scaffolding: Weight-1=0.65, JSON block: Weight-1=0.45 — Scaffolding wins
    expect(row.weight_1).toBeCloseTo(0.65, 2)
    expect(row.weight_2).toBeCloseTo(0.45, 2)
  })

  it('extracts thread_id from Mechanical Scaffolding', () => {
    const row = parseKvCharToD1(TEST_KEY, ELOWEN_LORE, TEST_ID)
    expect(row.thread_id).toBe('thread:elowen:start-state')
  })

  it('extracts state_stage and stage_timer', () => {
    const row = parseKvCharToD1(TEST_KEY, ELOWEN_LORE, TEST_ID)
    expect(row.state_stage).toBe(1)
    expect(row.state_stage_timer).toBe(1)
  })

  it('extracts alias, age, gender, orientation', () => {
    const row = parseKvCharToD1(TEST_KEY, ELOWEN_LORE, TEST_ID)
    expect(row.alias).toContain('Lo')
    expect(row.age).toBe('25')
    expect(row.gender).toBe('Female')
    expect(row.orientation).toBe('Homosexual')
  })

  it('extracts faction_id and alignment', () => {
    const row = parseKvCharToD1(TEST_KEY, ELOWEN_LORE, TEST_ID)
    expect(row.faction_id).toBe('celestial-vagabonds')
    expect(row.alignment).toBe('Chaotic Good')
  })

  it('extracts background from Background & History section', () => {
    const row = parseKvCharToD1(TEST_KEY, ELOWEN_LORE, TEST_ID)
    expect(row.background).toBeTruthy()
    expect(row.background).toContain('Elowen was born')
  })

  it('puts extra JSON weights fields into resource_pools', () => {
    const row = parseKvCharToD1(TEST_KEY, ELOWEN_LORE, TEST_ID)
    const pools = JSON.parse(row.resource_pools) as Record<string, unknown>
    expect(pools['Tracking-Sense']).toBe(0.2)
    expect(pools['flavor']).toBeDefined()
  })

  it('puts sensory profile into resource_pools.sensory', () => {
    const row = parseKvCharToD1(TEST_KEY, ELOWEN_LORE, TEST_ID)
    const pools = JSON.parse(row.resource_pools) as Record<string, unknown>
    const sensory = pools['sensory'] as Record<string, string>
    expect(sensory).toBeDefined()
    expect(sensory['scent']).toContain('Lavender')
  })

  it('infers character_type as npc for non-player key', () => {
    const row = parseKvCharToD1(TEST_KEY, ELOWEN_LORE, TEST_ID)
    expect(row.character_type).toBe('npc')
  })

  it('infers character_type as pc for character:player key', () => {
    const row = parseKvCharToD1('character:player', ELOWEN_LORE, TEST_ID)
    expect(row.character_type).toBe('pc')
  })

  it('sets default stats JSON', () => {
    const row = parseKvCharToD1(TEST_KEY, ELOWEN_LORE, TEST_ID)
    const stats = JSON.parse(row.stats)
    expect(stats).toMatchObject({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 })
  })

  it('sets empty array defaults for spells and resistances', () => {
    const row = parseKvCharToD1(TEST_KEY, ELOWEN_LORE, TEST_ID)
    expect(JSON.parse(row.known_spells)).toEqual([])
    expect(JSON.parse(row.resistances)).toEqual([])
    expect(JSON.parse(row.immunities)).toEqual([])
  })
})

describe('formatD1CharToLore', () => {
  it('renders a markdown document with D1 source footer', () => {
    const row = {
      name: 'Test Character',
      alias: 'TC',
      age: '30',
      hp: 16,
      max_hp: 16,
      ac: 12,
      level: 2,
      xp: 300,
      character_class: 'Rogue',
      race: 'Elf',
      weight_1: 0.6,
      weight_2: 0.4,
      perception_float: 0.7,
      thread_id: 'thread:test',
      state_stage: 2,
      state_stage_timer: 0,
      conditions: '["Stealthy"]',
      stats: '{"str":8,"dex":16,"con":10,"int":12,"wis":10,"cha":14}',
      resource_pools: '{}',
      background: 'A mysterious rogue.',
      alignment: 'Neutral',
      current_room_id: 'location:city-market',
    }
    const text = formatD1CharToLore(row as Record<string, unknown>)
    expect(text).toContain('# Character: Test Character')
    expect(text).toContain('*Source: D1 database (auto-redirected from legacy KV entry)*')
    expect(text).toContain('**Weight-1:** 0.6')
    expect(text).toContain('**Thread:** thread:test')
    expect(text).toContain('- Stealthy')
    expect(text).toContain('A mysterious rogue.')
  })

  // #226 Phase 2 — co-habitation host_body_id/active fields
  it('renders Host-Body and Active: false lines when set, omits them otherwise', () => {
    const passenger = {
      name: 'Bellona Keel',
      hp: 10,
      max_hp: 10,
      ac: 12,
      level: 3,
      character_class: 'Fighter',
      race: 'Human',
      stats: '{}',
      resource_pools: '{}',
      host_body_id: 'char-kat-sloane',
      active: 0,
    }
    const passengerText = formatD1CharToLore(passenger as Record<string, unknown>)
    expect(passengerText).toContain('**Host-Body:** char-kat-sloane')
    expect(passengerText).toContain('**Active:** false')

    const ordinary = {
      name: 'Ordinary Villager',
      hp: 10,
      max_hp: 10,
      ac: 10,
      level: 1,
      character_class: 'Commoner',
      race: 'Human',
      stats: '{}',
      resource_pools: '{}',
      active: 1,
    }
    const ordinaryText = formatD1CharToLore(ordinary as Record<string, unknown>)
    expect(ordinaryText).not.toContain('**Host-Body:**')
    expect(ordinaryText).not.toContain('**Active:**')
  })
})
