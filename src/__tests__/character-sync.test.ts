import { describe, it, expect } from 'vitest'
import { formatD1CharToKv } from '../rpg/utils/kv-to-d1'
import { syncCharacterToKv, syncAllCharactersToKv } from '../rpg/utils/character-sync'
import { env } from './helpers'
import type { AppBindings } from '../types'

describe('Character D1 → KV Projection', () => {
  it('generates KV projection with D1-Migrated marker', () => {
    const charId = crypto.randomUUID()
    const row: Record<string, unknown> = {
      id: charId,
      name: 'Theron Blackforge',
      stats: JSON.stringify({ str: 16, dex: 12, con: 14, int: 10, wis: 13, cha: 11 }),
      hp: 45,
      max_hp: 60,
      ac: 18,
      level: 5,
      character_type: 'pc',
      character_class: 'Paladin',
      race: 'Human',
      background: 'A righteous warrior',
      alignment: 'Lawful Good',
    }

    const projection = formatD1CharToKv(row)

    expect(projection).toContain('## D1-Migrated: true')
    expect(projection).toContain(`## D1-Character-ID: ${charId}`)
    expect(projection).toContain('# Character: Theron Blackforge')
    expect(projection).toContain('**HP:** 45 / 60')
    expect(projection).toContain('**Level:** 5')
    expect(projection).toContain('*Projection: generated from D1 character record')
  })

  it('generates complete character projection with all sections', () => {
    const charId = crypto.randomUUID()
    const row: Record<string, unknown> = {
      id: charId,
      name: 'Elowen Vex',
      alias: 'The Shadow',
      age: '27',
      gender: 'Female',
      orientation: 'She/Her',
      stats: JSON.stringify({ str: 14, dex: 18, con: 13, int: 16, wis: 15, cha: 12 }),
      hp: 32,
      max_hp: 42,
      ac: 16,
      level: 6,
      xp: 12500,
      character_type: 'npc',
      character_class: 'Rogue',
      race: 'Elf',
      background: 'A skilled infiltrator',
      faction_id: 'House Vex',
      alignment: 'Neutral Evil',
      behavior: 'Alert',
      current_room_id: 'room:chamber-7',
      perception_bonus: 4,
      stealth_bonus: 2,
      weight_1: 0.6,
      weight_2: 0.4,
      perception_float: 3.5,
      thread_id: 'thread:infiltration',
      state_stage: 2,
      state_stage_timer: 240,
      conditions: JSON.stringify(['poisoned', 'hiding']),
      resource_pools: JSON.stringify({ focus: { current: 3, max: 5 }, inspiration: { current: 1, max: 1 } }),
    }

    const projection = formatD1CharToKv(row)

    expect(projection).toContain('**Alias:** The Shadow')
    expect(projection).toContain('**Age:** 27')
    expect(projection).toContain('**Gender:** Female')
    expect(projection).toContain('**Orientation:** She/Her')
    expect(projection).toContain('**Status:** Alert')
    expect(projection).toContain('**Faction:** House Vex')
    expect(projection).toContain('**Alignment:** Neutral Evil')
    expect(projection).toContain('**Race:** Elf')
    expect(projection).toContain('**Class:** Rogue')
    expect(projection).toContain('**Location:** room:chamber-7')
    expect(projection).toContain('**HP:** 32 / 42')
    expect(projection).toContain('**AC:** 16')
    expect(projection).toContain('**Level:** 6')
    expect(projection).toContain('**XP:** 12500')
    expect(projection).toContain('**Thread:** thread:infiltration')
    expect(projection).toContain('- poisoned')
    expect(projection).toContain('- hiding')
  })

  it('preserves JSON arrays in conditions and resource_pools', () => {
    const row: Record<string, unknown> = {
      id: 'char-123',
      name: 'Orm',
      stats: JSON.stringify({ str: 16, dex: 10, con: 15, int: 8, wis: 11, cha: 9 }),
      hp: 40,
      max_hp: 50,
      ac: 13,
      level: 4,
      character_type: 'npc',
      character_class: 'Barbarian',
      race: 'Orc',
      conditions: JSON.stringify(['exhausted', 'charmed', 'frightened']),
      resource_pools: JSON.stringify({ rage: { current: 2, max: 3 }, channel_divinity: { current: 1, max: 2 } }),
    }

    const projection = formatD1CharToKv(row)

    expect(projection).toContain('- exhausted')
    expect(projection).toContain('- charmed')
    expect(projection).toContain('- frightened')
    expect(projection).toContain('**rage:**')
    expect(projection).toContain('**channel_divinity:**')
  })

  it('handles characters with minimal data', () => {
    const row: Record<string, unknown> = {
      id: 'char-minimal',
      name: 'Unknown',
      stats: JSON.stringify({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }),
      hp: 1,
      max_hp: 1,
      ac: 10,
      level: 1,
      character_type: 'npc',
      character_class: 'Commoner',
      race: 'Human',
    }

    const projection = formatD1CharToKv(row)

    expect(projection).toContain('# Character: Unknown')
    expect(projection).toContain('## Stats')
    expect(projection).toContain('## Health')
  })

  it('formats stats section correctly', () => {
    const row: Record<string, unknown> = {
      id: 'char-stats',
      name: 'Stat Test',
      stats: JSON.stringify({ str: 15, dex: 18, con: 14, int: 12, wis: 16, cha: 10 }),
      hp: 20,
      max_hp: 30,
      ac: 14,
      level: 2,
      character_type: 'pc',
      character_class: 'Rogue',
      race: 'Human',
    }

    const projection = formatD1CharToKv(row)

    expect(projection).toContain('**STR:** 15')
    expect(projection).toContain('**DEX:** 18')
    expect(projection).toContain('**CON:** 14')
    expect(projection).toContain('**INT:** 12')
    expect(projection).toContain('**WIS:** 16')
    expect(projection).toContain('**CHA:** 10')
  })

  it('includes metadata footer with timestamp', () => {
    const row: Record<string, unknown> = {
      id: 'char-footer',
      name: 'Footer Test',
      stats: '{}',
      hp: 1,
      max_hp: 1,
      ac: 10,
      level: 1,
      character_type: 'npc',
      character_class: 'Commoner',
      race: 'Human',
    }

    const projection = formatD1CharToKv(row)

    expect(projection).toContain('---')
    expect(projection).toContain('*Projection: generated from D1 character record on')
  })

  it('handles all optional fields being null or undefined', () => {
    const row: Record<string, unknown> = {
      id: 'char-null-fields',
      name: 'Null Fields Test',
      stats: null,
      hp: 5,
      max_hp: 5,
      ac: 10,
      level: 1,
      character_type: 'npc',
      character_class: 'Commoner',
      race: 'Human',
      alias: null,
      age: undefined,
      gender: null,
      orientation: null,
      behavior: null,
      faction_id: null,
      alignment: null,
      background: null,
      current_room_id: null,
      weight_1: null,
      weight_2: null,
      perception_float: null,
      thread_id: null,
      state_stage: null,
      conditions: null,
      resource_pools: null,
    }

    const projection = formatD1CharToKv(row)

    // Should include basic structure even with all null fields
    expect(projection).toContain('## D1-Migrated: true')
    expect(projection).toContain('# Character: Null Fields Test')
    expect(projection).toContain('## Health')
    expect(projection).toContain('**HP:** 5 / 5')
  })

  it('preserves empty JSON objects and arrays', () => {
    const row: Record<string, unknown> = {
      id: 'char-empty-json',
      name: 'Empty JSON Test',
      stats: JSON.stringify({}),
      hp: 10,
      max_hp: 10,
      ac: 10,
      level: 1,
      character_type: 'npc',
      character_class: 'Commoner',
      race: 'Human',
      conditions: JSON.stringify([]),
      resource_pools: JSON.stringify({}),
    }

    const projection = formatD1CharToKv(row)

    expect(projection).toContain('# Character: Empty JSON Test')
    // Empty conditions array should not render a Conditions section
    expect(projection).not.toContain('## Conditions')
    // Empty resource_pools should not render a Resource Pools section
    expect(projection).not.toContain('## Resource Pools')
  })

  it('handles malformed JSON gracefully', () => {
    const row: Record<string, unknown> = {
      id: 'char-bad-json',
      name: 'Malformed JSON Test',
      stats: 'not valid json {]',
      hp: 10,
      max_hp: 10,
      ac: 10,
      level: 1,
      character_type: 'npc',
      character_class: 'Commoner',
      race: 'Human',
      conditions: 'also { broken',
      resource_pools: '[unclosed array',
    }

    // Should not throw and should include basic structure
    const projection = formatD1CharToKv(row)
    expect(projection).toContain('# Character: Malformed JSON Test')
    expect(projection).toContain('## Health')
  })
})

describe('D1 Character Projection Edge Cases', () => {
  it('handles very long character name', () => {
    const longName = 'A'.repeat(500)
    const row: Record<string, unknown> = {
      id: 'char-long-name',
      name: longName,
      stats: '{}',
      hp: 1,
      max_hp: 1,
      ac: 10,
      level: 1,
      character_type: 'npc',
      character_class: 'Commoner',
      race: 'Human',
    }

    const projection = formatD1CharToKv(row)
    expect(projection).toContain(longName)
  })

  it('handles complex nested resource pools', () => {
    const row: Record<string, unknown> = {
      id: 'char-complex-pools',
      name: 'Complex Resources',
      stats: '{}',
      hp: 10,
      max_hp: 10,
      ac: 10,
      level: 1,
      character_type: 'npc',
      character_class: 'Wizard',
      race: 'Elf',
      resource_pools: JSON.stringify({
        spell_slots: { 1: { current: 4, max: 4 }, 2: { current: 2, max: 3 }, 3: { current: 0, max: 2 } },
        ki_points: { current: 5, max: 5 },
        sorcery_points: { current: 2, max: 3 },
      }),
    }

    const projection = formatD1CharToKv(row)
    expect(projection).toContain('**spell_slots:**')
    expect(projection).toContain('**ki_points:**')
    expect(projection).toContain('**sorcery_points:**')
  })

  it('handles many conditions', () => {
    const row: Record<string, unknown> = {
      id: 'char-many-conditions',
      name: 'Many Conditions',
      stats: '{}',
      hp: 5,
      max_hp: 10,
      ac: 8,
      level: 1,
      character_type: 'npc',
      character_class: 'Fighter',
      race: 'Orc',
      conditions: JSON.stringify([
        'poisoned',
        'exhausted',
        'frightened',
        'charmed',
        'restrained',
        'grappled',
        'blinded',
        'deafened',
        'petrified',
      ]),
    }

    const projection = formatD1CharToKv(row)
    const lines = projection.split('\n')
    const conditionLines = lines.filter(l => l.startsWith('- '))
    expect(conditionLines.length).toBe(9)
  })

  it('includes D1 ID in projection', () => {
    const testId = 'test-uuid-12345'
    const row: Record<string, unknown> = {
      id: testId,
      name: 'ID Test',
      stats: '{}',
      hp: 1,
      max_hp: 1,
      ac: 10,
      level: 1,
      character_type: 'npc',
      character_class: 'Commoner',
      race: 'Human',
    }

    const projection = formatD1CharToKv(row)
    expect(projection).toContain(`## D1-Character-ID: ${testId}`)
  })

  it('generates timestamp in footer', () => {
    const row: Record<string, unknown> = {
      id: 'char-timestamp',
      name: 'Timestamp Test',
      stats: '{}',
      hp: 1,
      max_hp: 1,
      ac: 10,
      level: 1,
      character_type: 'npc',
      character_class: 'Commoner',
      race: 'Human',
    }

    const projection = formatD1CharToKv(row)
    const match = projection.match(/generated from D1 character record on (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/)
    expect(match).toBeTruthy()
  })
})
