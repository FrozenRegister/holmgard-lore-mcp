import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('advance_state_stage', () => {
  it('increments State-Stage and writes back', async () => {
    await seedKV('character:caterpillar', '**State-Stage:** 1\n**State-Total:** 4\n**Stage-Timer:** 3')
    const res = await callTool('advance_state_stage', { entity_key: 'character:caterpillar' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.old_stage).toBe(1)
    expect(res.result.new_stage).toBe(2)
    expect(res.result.is_terminal).toBe(false)
    const lore = await callTool('get_lore', { query: 'character:caterpillar' })
    expect(lore.result.text).toContain('**State-Stage:** 2')
    expect(lore.result.text).toContain('**Stage-Timer:** 2')
  })

  it('detects terminal stage', async () => {
    await seedKV('character:final', '**State-Stage:** 4\n**State-Total:** 4')
    const res = await callTool('advance_state_stage', { entity_key: 'character:final' })
    expect(res.result.advanced).toBe(false)
    expect(res.result.is_terminal).toBe(true)
  })

  it('returns not-advanced when no State-Stage field', async () => {
    await seedKV('character:no-stage', 'Just a character.')
    const res = await callTool('advance_state_stage', { entity_key: 'character:no-stage' })
    expect(res.result.advanced).toBe(false)
  })

  it('advances from loose plain-colon format (no bold markers)', async () => {
    // AI may write "State-Stage: 2" without **bold:** — loose pass should parse and write back
    await seedKV('character:loose-stage', 'State-Stage: 2\nState-Total: 4\nStage-Timer: 3')
    const res = await callTool('advance_state_stage', { entity_key: 'character:loose-stage' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.new_stage).toBe(3)
    const lore = await callTool('get_lore', { query: 'character:loose-stage' })
    expect(lore.result.text).toContain('3')
    expect(lore.result.text).toContain('Stage-Timer')
  })

  it('parses stage from embedded Stage-N-of-M narrative status and updates in-place', async () => {
    // "Status: Active, Stage-2-of-4" has no discrete State-Stage field — Pass 4 extracts it
    await seedKV('character:subject-alpha', 'Status: Active, Stage-2-of-4\nLocation: processing-chamber\nWeight-1: 0.30\nStage-Timer: 3')
    const res = await callTool('advance_state_stage', { entity_key: 'character:subject-alpha' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.old_stage).toBe(2)
    expect(res.result.new_stage).toBe(3)
    expect(res.result.total_stages).toBe(4)
    const lore = await callTool('get_lore', { query: 'character:subject-alpha' })
    // Stage number updated in-place within the status string
    expect(lore.result.text).toContain('Stage-3-of-4')
    expect(lore.result.text).not.toContain('Stage-2-of-4')
    // Stage-Timer decremented
    expect(lore.result.text).toContain('Stage-Timer: 2')
  })
})

describe('process_stage_batch', () => {
  it('advances all entities at the location with a State-Stage field', async () => {
    await seedKV('character:pupa-1', '**Location:** location:lab\n**State-Stage:** 1\n**State-Total:** 3')
    await seedKV('character:pupa-2', '**Location:** location:lab\n**State-Stage:** 2\n**State-Total:** 3')
    await seedKV('character:visitor', '**Location:** location:market\n**State-Stage:** 1')
    const res = await callTool('process_stage_batch', { location_key: 'location:lab' })
    expect(res.result.outcomes).toHaveLength(2)
    const pupa1 = res.result.outcomes.find((o: { key: string }) => o.key === 'character:pupa-1')
    expect(pupa1.new_stage).toBe(2)
  })

  it('skips entities without State-Stage', async () => {
    await seedKV('character:no-stage-loc', '**Location:** location:chamber')
    const res = await callTool('process_stage_batch', { location_key: 'location:chamber' })
    expect(res.result.outcomes).toHaveLength(0)
    expect(res.result.skipped).toHaveLength(1)
    expect(res.result.skipped[0].reason).toContain('State-Stage')
  })
})

describe('generate_entity', () => {
  it('creates a new entity from an archetype', async () => {
    await seedKV('archetype:guard', '**Weight-1:** 0.7\n**Weight-2:** 0.4\n**Status:** Patrol')
    const res = await callTool('generate_entity', { archetype_key: 'archetype:guard' })
    expect(res.result.entity_key).toMatch(/^entity:guard-\d+$/)
    expect(res.result.entity_text).toContain('**Weight-1:** 0.7')
    expect(res.result.metadata.written).toBe(1)
    const lore = await callTool('get_lore', { query: res.result.entity_key })
    expect(lore.result).toBeDefined()
  })

  it('injects Location when location_key provided', async () => {
    await seedKV('archetype:wolf', '**Weight-1:** 0.6\n**Status:** Hunting')
    await seedKV('location:forest', '**Danger-Level:** 0.3')
    const res = await callTool('generate_entity', { archetype_key: 'archetype:wolf', location_key: 'location:forest' })
    expect(res.result.entity_text).toContain('location:forest')
  })

  it('returns error for missing archetype', async () => {
    const res = await callTool('generate_entity', { archetype_key: 'archetype:no-such' })
    expect(res.error).toBeDefined()
  })
})

describe('roll_encounter', () => {
  it('generates an entity from the encounter table', async () => {
    await seedKV('location:woods', '**Encounter-Table:** archetype:bandit:80, archetype:deer:20')
    await seedKV('archetype:bandit', '**Weight-1:** 0.8\n**Status:** Hostile')
    await seedKV('archetype:deer', '**Weight-1:** 0.1\n**Status:** Grazing')
    const res = await callTool('roll_encounter', { location_key: 'location:woods', threat_level: 5 })
    expect(res.result.rolled).toBe(true)
    expect(res.result.entity_key).toMatch(/^entity:/)
  })

  it('reads encounter table from ### Encounter-Table section', async () => {
    await seedKV('location:dungeon', '## Overview\nDark and damp.\n### Encounter-Table\narchetype:goblin:80, archetype:spider:20')
    await seedKV('archetype:goblin', '**Status:** Hostile')
    await seedKV('archetype:spider', '**Status:** Lurking')
    const res = await callTool('roll_encounter', { location_key: 'location:dungeon', threat_level: 5 })
    expect(res.result.rolled).toBe(true)
    expect(res.result.entity_key).toMatch(/^entity:/)
  })

  it('returns rolled=false when no Encounter-Table', async () => {
    await seedKV('location:empty-field', 'Grass and wind.')
    const res = await callTool('roll_encounter', { location_key: 'location:empty-field' })
    expect(res.result.rolled).toBe(false)
    expect(res.result.content[0].text).toContain('No Encounter-Table')
  })
})

