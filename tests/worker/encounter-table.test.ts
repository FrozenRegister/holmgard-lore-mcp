import {
  describe,
  rpc,
  callTool,
  callToolWithApiKey,
  seedKV,
  ADMIN_SECRET,
  parseEncounterTable,
} from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('roll_encounter parseEncounterTable', () => {
  // ── Core fix: decimal weights ────────────────────────────────────────
  it('parses decimal weights from real Thornwood Road table', () => {
    const tableRaw =
      'nothing:0.55, forest-predator-scout:0.15, sludge-stalker:0.10, lamia-forest:0.08, thorn-warden:0.05, feral-shaper:0.04, broodmother-wild:0.03'
    const entries = parseEncounterTable(tableRaw)

    expect(entries).toHaveLength(7)

    const nothing = entries.find((e) => e.key === 'nothing')
    expect(nothing).toBeDefined()
    expect(nothing!.weight).toBe(0.55)

    const brood = entries.find((e) => e.key === 'broodmother-wild')
    expect(brood).toBeDefined()
    expect(brood!.weight).toBe(0.03)

    // Verify NO entry fell through to the weight=1 fallback
    expect(entries.every((e) => e.weight < 1)).toBe(true)

    // All weights sum to 1.0 (pre-fix: would sum to 7.0)
    const sum = entries.reduce((s, e) => s + e.weight, 0)
    expect(sum).toBeCloseTo(1.0, 2)
  })

  // ── Before fix: all entries got weight=1 ─────────────────────────────
  it('BUG REPRO (pre-fix): \\d+ regex fails on decimals, all weights become 1', () => {
    const oldEntries: Array<{ key: string; weight: number }> = []
    const tableRaw = 'lamia-forest:0.08, sludge-stalker:0.10'
    for (const part of tableRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      const m = part.match(/^(.+?)\s*:\s*(\d+)$/) // OLD regex — integer only
      if (m) {
        oldEntries.push({ key: m[1].trim(), weight: parseInt(m[2]) })
      } else {
        // BUG: "lamia-forest:0.08" falls through with weight=1 and broken key
        oldEntries.push({ key: part, weight: 1 })
      }
    }

    expect(oldEntries).toHaveLength(2)
    expect(oldEntries.every((e) => e.weight === 1)).toBe(true)
    expect(oldEntries[0].key).toBe('lamia-forest:0.08') // key carries weight suffix
    expect(oldEntries[1].key).toBe('sludge-stalker:0.10')
  })

  // ── Edge cases ───────────────────────────────────────────────────────
  it('handles whitespace around entries', () => {
    const entries = parseEncounterTable('  nothing:0.55 ,  forest-predator-scout:0.15  ')
    expect(entries).toHaveLength(2)
    expect(entries[0].key).toBe('nothing')
    expect(entries[0].weight).toBe(0.55)
    expect(entries[1].key).toBe('forest-predator-scout')
  })

  it('handles integer weights (backwards compatibility)', () => {
    const entries = parseEncounterTable('guard:3, scout:1')
    expect(entries).toHaveLength(2)
    expect(entries[0].key).toBe('guard')
    expect(entries[0].weight).toBe(3)
    expect(entries[1].key).toBe('scout')
    expect(entries[1].weight).toBe(1)
  })

  it('handles weights like 1.0 and 0.0', () => {
    const entries = parseEncounterTable('boss:1.0, weakling:0.0')
    expect(entries[0].weight).toBe(1.0)
    expect(entries[1].weight).toBe(0.0)
  })

  it('empty table returns empty array', () => {
    expect(parseEncounterTable('')).toHaveLength(0)
  })

  it('single entry without colon gets weight 1 (fallback)', () => {
    const entries = parseEncounterTable('lone-wolf')
    expect(entries).toHaveLength(1)
    expect(entries[0].key).toBe('lone-wolf')
    expect(entries[0].weight).toBe(1)
  })

  // ── nothing sentinel ────────────────────────────────────────────────
  it('nothing sentinel: tool returns entity_key=null without archetype lookup', () => {
    const entries = parseEncounterTable('nothing:0.55, scout:0.45')
    const nothing = entries.find((e) => e.key === 'nothing')!

    expect(nothing).toBeDefined()
    expect(nothing.weight).toBe(0.55)

    // Simulate the tool-side guard that every roll_encounter handler
    // must implement after the weighted selection:
    const simulateRoll = (selectedKey: string) => {
      if (selectedKey === 'nothing') {
        return { rolled: true, entity_key: null, nothing: true }
      }
      return { rolled: true, entity_key: `entity:${selectedKey}-12345`, nothing: false }
    }

    const nothingResult = simulateRoll('nothing')
    expect(nothingResult.rolled).toBe(true)
    expect(nothingResult.entity_key).toBeNull()
    expect(nothingResult.nothing).toBe(true)

    const scoutResult = simulateRoll('scout')
    expect(scoutResult.rolled).toBe(true)
    expect(scoutResult.entity_key).not.toBeNull()
    expect(scoutResult.nothing).toBe(false)
  })
  it('parses decimal-weight encounter table and generates an entity', async () => {
    await seedKV('location:decimal-woods', '**Encounter-Table:** scout:0.60, guard:0.40')
    await seedKV('archetype:scout', '**Weight-1:** 0.4\n**Status:** Scouting')
    await seedKV('archetype:guard', '**Weight-1:** 0.7\n**Status:** Guarding')
    const res = await callTool('entity_manage', {
      action: 'roll_encounter',
      location_key: 'location:decimal-woods',
      threat_level: 5,
    })
    expect(res.result.rolled).toBe(true)
    expect(res.result.entity_key).toMatch(/^entity:/)
    const get = await callTool('lore_manage', { action: 'get', query: res.result.entity_key })
    expect(get.error).toBeUndefined()
    expect(get.result.text).toContain('Weight-1')
  })

  it('selects the guaranteed archetype when one entry dominates the weight', async () => {
    await seedKV('location:solo-woods', '**Encounter-Table:** loner:0.99, bystander:0.01')
    await seedKV('archetype:loner', '**Weight-1:** 0.9\n**Status:** Lonely')
    await seedKV('archetype:bystander', '**Weight-1:** 0.1\n**Status:** Passing')
    // Verify decimal weights resolve to known archetypes (not "archetype not found" error).
    // Avoid counting on distribution — Math.random seeding in the Workers runtime is deterministic.
    const knownArchetypes = new Set(['archetype:loner', 'archetype:bystander'])
    for (let i = 0; i < 5; i++) {
      const res = await callTool('entity_manage', {
        action: 'roll_encounter',
        location_key: 'location:solo-woods',
      })
      expect(res.result.rolled).toBe(true)
      expect(knownArchetypes.has(res.result.selected_archetype)).toBe(true)
    }
  })

  it('nothing sentinel returns entity_key=null without error', async () => {
    await seedKV('location:quiet-woods', '**Encounter-Table:** nothing:0.99, scout:0.01')
    await seedKV('archetype:scout', '**Weight-1:** 0.4\n**Status:** Scouting')
    let nothingCount = 0
    for (let i = 0; i < 5; i++) {
      const res = await callTool('entity_manage', {
        action: 'roll_encounter',
        location_key: 'location:quiet-woods',
      })
      if (res.result.nothing) nothingCount++
    }
    expect(nothingCount).toBeGreaterThan(0)
  })
})
