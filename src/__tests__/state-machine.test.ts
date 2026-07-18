import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'

describe('advance_state_stage', () => {
  it('increments State-Stage and writes back', async () => {
    await seedKV('character:caterpillar', '**State-Stage:** 1\n**State-Total:** 4\n**Stage-Timer:** 3')
    const res = await callTool('entity_manage', { action: 'advance_stage', entity_key: 'character:caterpillar' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.old_stage).toBe(1)
    expect(res.result.new_stage).toBe(2)
    expect(res.result.is_terminal).toBe(false)
    const lore = await callTool('lore_manage', { action: 'get', query: 'character:caterpillar' })
    expect(lore.result.text).toContain('**State-Stage:** 2')
    expect(lore.result.text).toContain('**Stage-Timer:** 2')
  })

  it('detects terminal stage', async () => {
    await seedKV('character:final', '**State-Stage:** 4\n**State-Total:** 4')
    const res = await callTool('entity_manage', { action: 'advance_stage', entity_key: 'character:final' })
    expect(res.result.advanced).toBe(false)
    expect(res.result.is_terminal).toBe(true)
  })

  it('returns not-advanced when no State-Stage field', async () => {
    await seedKV('character:no-stage', 'Just a character.')
    const res = await callTool('entity_manage', { action: 'advance_stage', entity_key: 'character:no-stage' })
    expect(res.result.advanced).toBe(false)
  })

  it('advances from loose plain-colon format (no bold markers)', async () => {
    // AI may write "State-Stage: 2" without **bold:** — loose pass should parse and write back
    await seedKV('character:loose-stage', 'State-Stage: 2\nState-Total: 4\nStage-Timer: 3')
    const res = await callTool('entity_manage', { action: 'advance_stage', entity_key: 'character:loose-stage' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.new_stage).toBe(3)
    const lore = await callTool('lore_manage', { action: 'get', query: 'character:loose-stage' })
    expect(lore.result.text).toContain('3')
    expect(lore.result.text).toContain('Stage-Timer')
  })

  it('parses stage from embedded Stage-N-of-M narrative status and updates in-place', async () => {
    // "Status: Active, Stage-2-of-4" has no discrete State-Stage field — Pass 4 extracts it
    await seedKV('character:subject-alpha', 'Status: Active, Stage-2-of-4\nLocation: processing-chamber\nWeight-1: 0.30\nStage-Timer: 3')
    const res = await callTool('entity_manage', { action: 'advance_stage', entity_key: 'character:subject-alpha' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.old_stage).toBe(2)
    expect(res.result.new_stage).toBe(3)
    expect(res.result.total_stages).toBe(4)
    const lore = await callTool('lore_manage', { action: 'get', query: 'character:subject-alpha' })
    // Stage number updated in-place within the status string
    expect(lore.result.text).toContain('Stage-3-of-4')
    expect(lore.result.text).not.toContain('Stage-2-of-4')
    // Stage-Timer decremented
    expect(lore.result.text).toContain('Stage-Timer: 2')
  })
})

// #411 — advance_stage mirrors the new stage into D1's characters.dissolution_stage
// for entities that are also "staged" characters (#314), so combat_action.attack's
// staged-rejection guard (which reads D1) never drifts behind the narrator's KV
// State-Stage advances.
describe('advance_state_stage — D1 dissolution_stage mirror (#411)', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  async function seedStagedCharacter(name: string, dissolutionStage: number): Promise<string> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      `INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, character_type, character_class, race, conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells, cantrips_known, currency, resource_pools, xp, death_mode, dissolution_stage, dissolution_stages, dissolution_terminal, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, name, '{}', 10, 10, 10, 1, 'pc', 'Fighter', 'Human', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', 0, 'staged', dissolutionStage, 5, 'consumed', now, now).run()
    return id
  }

  it('mirrors the new State-Stage into dissolution_stage for a staged character resolved by name', async () => {
    const characterId = await seedStagedCharacter('Mirror Test Subject', 3)
    await seedKV('character:mirror-test-subject', '**State-Stage:** 3\n**State-Total:** 5\n**Stage-Timer:** 1')

    const res = await callTool('entity_manage', { action: 'advance_stage', entity_key: 'character:mirror-test-subject' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.new_stage).toBe(4)
    expect(res.result.d1_mirrored).toBe(true)

    const row = await env.RPG_DB.prepare('SELECT dissolution_stage FROM characters WHERE id = ?').bind(characterId).first() as { dissolution_stage: number }
    expect(row.dissolution_stage).toBe(4)
  })

  it('does not mirror for an entity with no matching D1 character', async () => {
    await seedKV('character:no-d1-row', '**State-Stage:** 1\n**State-Total:** 5\n**Stage-Timer:** 1')
    const res = await callTool('entity_manage', { action: 'advance_stage', entity_key: 'character:no-d1-row' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.d1_mirrored).toBe(false)
  })

  it('does not mirror for a D1 character whose death_mode is still instant', async () => {
    await seedStagedCharacter('Instant Mode Subject', 0)
    await env.RPG_DB.prepare("UPDATE characters SET death_mode = 'instant' WHERE name = ?").bind('Instant Mode Subject').run()
    await seedKV('character:instant-mode-subject', '**State-Stage:** 1\n**State-Total:** 5\n**Stage-Timer:** 1')

    const res = await callTool('entity_manage', { action: 'advance_stage', entity_key: 'character:instant-mode-subject' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.d1_mirrored).toBe(false)
  })
})

// #420 — Archisector's follow-up from #411: advance_stage was silent when it
// detected is_terminal — nothing reacted. Now it marks the entity's own KV
// Terminal-Status field (always) and logs a discoverable timeline_events row
// when the entity resolves to a world-scoped D1 character — but deliberately
// never touches D1 hp/conditions (that stays a separate character_manage.kill
// call), matching party-manage.ts's morale_roll "report, don't auto-apply"
// precedent that the issue itself cites.
describe('advance_state_stage — terminal-stage hook (#420)', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  async function seedStagedCharacter(name: string, dissolutionStage: number, opts: { dissolutionTerminal?: string; worldId?: string } = {}): Promise<string> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      `INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, character_type, character_class, race, conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells, cantrips_known, currency, resource_pools, xp, world_id, death_mode, dissolution_stage, dissolution_stages, dissolution_terminal, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, name, '{}', 10, 10, 10, 1, 'pc', 'Fighter', 'Human', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', 0,
      opts.worldId ?? null, 'staged', dissolutionStage, 5, opts.dissolutionTerminal ?? null, now, now,
    ).run()
    return id
  }

  it('marks Terminal-Status with a generic fallback for a pure-KV entity with no D1 link', async () => {
    await seedKV('character:pure-kv-terminal', '**State-Stage:** 4\n**State-Total:** 5\n**Stage-Timer:** 1')
    const res = await callTool('entity_manage', { action: 'advance_stage', entity_key: 'character:pure-kv-terminal' })
    expect(res.result.is_terminal).toBe(true)
    expect(res.result.terminal_timeline_event_id).toBeNull()

    const lore = await callTool('lore_manage', { action: 'get', query: 'character:pure-kv-terminal' })
    expect(lore.result.text).toContain('**Terminal-Status:** reached terminal stage')
  })

  it('uses the linked D1 character\'s dissolution_terminal free text for Terminal-Status', async () => {
    await seedStagedCharacter('Descriptor Test Subject', 4, { dissolutionTerminal: 'consumed by the Slime-Girl distributed intelligence' })
    await seedKV('character:descriptor-test-subject', '**State-Stage:** 4\n**State-Total:** 5\n**Stage-Timer:** 1')

    const res = await callTool('entity_manage', { action: 'advance_stage', entity_key: 'character:descriptor-test-subject' })
    expect(res.result.is_terminal).toBe(true)

    const lore = await callTool('lore_manage', { action: 'get', query: 'character:descriptor-test-subject' })
    expect(lore.result.text).toContain('**Terminal-Status:** consumed by the Slime-Girl distributed intelligence')
  })

  it('logs a discoverable timeline_events row when the D1 character has a world_id', async () => {
    const world = await callTool('rpg', { sub: 'world', action: 'create', name: 'Terminal Hook World', theme: 'fantasy' })
    const worldPayload = JSON.parse(world.result.content[0].text) as { worldId: string }
    const worldId = worldPayload.worldId
    const characterId = await seedStagedCharacter('World Linked Subject', 4, { dissolutionTerminal: 'mycelium-integrated', worldId })
    await seedKV('character:world-linked-subject', '**State-Stage:** 4\n**State-Total:** 5\n**Stage-Timer:** 1')

    const res = await callTool('entity_manage', { action: 'advance_stage', entity_key: 'character:world-linked-subject' })
    expect(res.result.is_terminal).toBe(true)
    expect(res.result.terminal_timeline_event_id).toEqual(expect.any(String))

    const row = await env.RPG_DB.prepare('SELECT * FROM timeline_events WHERE id = ?').bind(res.result.terminal_timeline_event_id).first() as
      { world_id: string; verb: string; entity_id: string; detail: string } | null
    expect(row).toBeTruthy()
    expect(row!.world_id).toBe(worldId)
    expect(row!.verb).toBe('dissolved')
    expect(row!.entity_id).toBe(characterId)
    expect(row!.detail).toContain('character:world-linked-subject')
    expect(row!.detail).toContain('mycelium-integrated')
  })

  it('does not log a timeline_events row when the D1 character has no world_id', async () => {
    await seedStagedCharacter('No World Subject', 4, { dissolutionTerminal: 'consumed' })
    await seedKV('character:no-world-subject', '**State-Stage:** 4\n**State-Total:** 5\n**Stage-Timer:** 1')

    const res = await callTool('entity_manage', { action: 'advance_stage', entity_key: 'character:no-world-subject' })
    expect(res.result.is_terminal).toBe(true)
    expect(res.result.terminal_timeline_event_id).toBeNull()
  })

  it('does not fire the hook on a non-terminal advance', async () => {
    await seedKV('character:mid-stage-subject', '**State-Stage:** 1\n**State-Total:** 5\n**Stage-Timer:** 3')
    const res = await callTool('entity_manage', { action: 'advance_stage', entity_key: 'character:mid-stage-subject' })
    expect(res.result.is_terminal).toBe(false)
    expect(res.result.terminal_timeline_event_id).toBeUndefined()

    const lore = await callTool('lore_manage', { action: 'get', query: 'character:mid-stage-subject' })
    expect(lore.result.text).not.toContain('Terminal-Status')
  })
})

// #441 — Phase 0 dissolution primitives: advance_stage writes sensory mutation
// fields, mechanical flags, terminal conversion, and applies HP drain atomically.
describe('advance_state_stage — dissolution primitives (#441)', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  async function seedStagedCharacter(name: string, dissolutionStage: number, opts: { dissolutionTerminal?: string; hp?: number; worldId?: string } = {}): Promise<string> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      `INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, character_type, character_class, race, conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells, cantrips_known, currency, resource_pools, xp, world_id, death_mode, dissolution_stage, dissolution_stages, dissolution_terminal, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, name, '{}', opts.hp ?? 10, 10, 10, 1, 'pc', 'Fighter', 'Human', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', 0,
      opts.worldId ?? null, 'staged', dissolutionStage, 5, opts.dissolutionTerminal ?? null, now, now,
    ).run()
    return id
  }

  it('writes Dissolution-Scent field on stage 1 advance', async () => {
    await seedStagedCharacter('Scent Test Subject', 0, { dissolutionTerminal: 'GASTRIC' })
    await seedKV('character:scent-test-subject', '**State-Stage:** 0\n**State-Total:** 5\n**Stage-Timer:** 3')

    const res = await callTool('entity_manage', { action: 'advance_stage', entity_key: 'character:scent-test-subject' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.dissolution?.scent_applied).toBe(true)

    const lore = await callTool('lore_manage', { action: 'get', query: 'character:scent-test-subject' })
    expect(lore.result.text).toContain('Dissolution-Scent')
    expect(lore.result.text).toContain('fear-pheromone_spike')
  })

  it('writes Movement-Locked and Communication-Penalty flags on stage 2+', async () => {
    await seedStagedCharacter('Mechanical Test Subject', 1)
    await seedKV('character:mechanical-test-subject', '**State-Stage:** 1\n**State-Total:** 5\n**Stage-Timer:** 3')

    const res = await callTool('entity_manage', { action: 'advance_stage', entity_key: 'character:mechanical-test-subject' })
    expect(res.result.advanced).toBe(true)

    const lore = await callTool('lore_manage', { action: 'get', query: 'character:mechanical-test-subject' })
    expect(lore.result.text).toContain('Movement-Locked')
    expect(lore.result.text).toContain('true')
  })

  it('writes Dissolution-Conversion and Dissolution-Conversion-Label on terminal stage', async () => {
    await seedStagedCharacter('Conversion Test Subject', 4, { dissolutionTerminal: 'consumed by the mycelium network' })
    await seedKV('character:conversion-test-subject', '**State-Stage:** 4\n**State-Total:** 5\n**Stage-Timer:** 1')

    const res = await callTool('entity_manage', { action: 'advance_stage', entity_key: 'character:conversion-test-subject' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.is_terminal).toBe(true)
    expect(res.result.terminal_conversion?.outcome).toBe('consumed-distributed')
    expect(res.result.terminal_conversion?.label).toBe('Industrial Base')

    const lore = await callTool('lore_manage', { action: 'get', query: 'character:conversion-test-subject' })
    expect(lore.result.text).toContain('Dissolution-Conversion')
    expect(lore.result.text).toContain('consumed-distributed')
    expect(lore.result.text).toContain('Dissolution-Conversion-Label')
    expect(lore.result.text).toContain('Industrial Base')
  })

  it('applies HP drain to D1 character atomically via batch', async () => {
    const characterId = await seedStagedCharacter('HP Drain Subject', 0, { hp: 10 })
    await seedKV('character:hp-drain-subject', '**State-Stage:** 0\n**State-Total:** 5\n**Stage-Timer:** 3')

    const res = await callTool('entity_manage', { action: 'advance_stage', entity_key: 'character:hp-drain-subject' })
    expect(res.result.advanced).toBe(true)
    // d1_hp_drained is true when a D1 character is linked and batch executes
    expect(res.result.d1_hp_drained).toBe(true)

    const row = await env.RPG_DB.prepare('SELECT hp FROM characters WHERE id = ?').bind(characterId).first() as { hp: number }
    // Stage 1 has hp_drain_per_tick = 0, so HP should be unchanged
    expect(row.hp).toBe(10)
  })

  it('applies HP drain on stage 3+ where hp_drain_per_tick > 0', async () => {
    const characterId = await seedStagedCharacter('HP Drain Stage 3 Subject', 2, { hp: 10 })
    await seedKV('character:hp-drain-stage3-subject', '**State-Stage:** 2\n**State-Total:** 5\n**Stage-Timer:** 1')

    const res = await callTool('entity_manage', { action: 'advance_stage', entity_key: 'character:hp-drain-stage3-subject' })
    expect(res.result.advanced).toBe(true)
    // d1_hp_drained is true when a D1 character is linked and batch executes
    expect(res.result.d1_hp_drained).toBe(true)

    const row = await env.RPG_DB.prepare('SELECT hp FROM characters WHERE id = ?').bind(characterId).first() as { hp: number }
    // Stage 3 has hp_drain_per_tick = 2, so HP should be 10 - 2 = 8
    expect(row.hp).toBe(8)
  })

  it('does not write dissolution fields for non-staged characters', async () => {
    // Non-staged means no D1 character link - dissolution fields are still written
    // based on stage progression, but d1_hp_drained should be false
    await seedKV('character:non-staged-subject', '**State-Stage:** 0\n**State-Total:** 5\n**Stage-Timer:** 3')
    const res = await callTool('entity_manage', { action: 'advance_stage', entity_key: 'character:non-staged-subject' })
    expect(res.result.advanced).toBe(true)
    // Dissolution metadata is present but d1_hp_drained is false (no D1 link)
    expect(res.result.dissolution).toBeDefined()
    expect(res.result.d1_hp_drained).toBe(false)

    const lore = await callTool('lore_manage', { action: 'get', query: 'character:non-staged-subject' })
    // KV fields are still written for stage progression
    expect(lore.result.text).toContain('Dissolution-Scent')
    expect(lore.result.text).not.toContain('Movement-Locked')
  })
})

describe('process_stage_batch', () => {
  it('advances all entities at the location with a State-Stage field', async () => {
    await seedKV('character:pupa-1', '**Location:** location:lab\n**State-Stage:** 1\n**State-Total:** 3')
    await seedKV('character:pupa-2', '**Location:** location:lab\n**State-Stage:** 2\n**State-Total:** 3')
    await seedKV('character:visitor', '**Location:** location:market\n**State-Stage:** 1')
    const res = await callTool('entity_manage', { action: 'batch_stage', location_key: 'location:lab' })
    expect(res.result.outcomes).toHaveLength(2)
    const pupa1 = res.result.outcomes.find((o: { key: string }) => o.key === 'character:pupa-1')
    expect(pupa1.new_stage).toBe(2)
  })

  it('skips entities without State-Stage', async () => {
    await seedKV('character:no-stage-loc', '**Location:** location:chamber')
    const res = await callTool('entity_manage', { action: 'batch_stage', location_key: 'location:chamber' })
    expect(res.result.outcomes).toHaveLength(0)
    expect(res.result.skipped).toHaveLength(1)
    expect(res.result.skipped[0].reason).toContain('State-Stage')
  })
})

describe('generate_entity', () => {
  it('creates a new entity from an archetype', async () => {
    await seedKV('archetype:guard', '**Weight-1:** 0.7\n**Weight-2:** 0.4\n**Status:** Patrol')
    const res = await callTool('entity_manage', { action: 'generate', archetype_key: 'archetype:guard' })
    expect(res.result.entity_key).toMatch(/^entity:guard-\d+$/)
    expect(res.result.entity_text).toContain('**Weight-1:** 0.7')
    expect(res.result.metadata.written).toBe(1)
    const lore = await callTool('lore_manage', { action: 'get', query: res.result.entity_key })
    expect(lore.result).toBeDefined()
  })

  it('injects Location when location_key provided', async () => {
    await seedKV('archetype:wolf', '**Weight-1:** 0.6\n**Status:** Hunting')
    await seedKV('location:forest', '**Danger-Level:** 0.3')
    const res = await callTool('entity_manage', { action: 'generate', archetype_key: 'archetype:wolf', location_key: 'location:forest' })
    expect(res.result.entity_text).toContain('location:forest')
  })

  it('returns error for missing archetype', async () => {
    const res = await callTool('entity_manage', { action: 'generate', archetype_key: 'archetype:no-such' })
    expect(res.error).toBeDefined()
  })
})

describe('roll_encounter', () => {
  it('generates an entity from the encounter table', async () => {
    await seedKV('location:woods', '**Encounter-Table:** archetype:bandit:80, archetype:deer:20')
    await seedKV('archetype:bandit', '**Weight-1:** 0.8\n**Status:** Hostile')
    await seedKV('archetype:deer', '**Weight-1:** 0.1\n**Status:** Grazing')
    const res = await callTool('entity_manage', { action: 'roll_encounter', location_key: 'location:woods', threat_level: 5 })
    expect(res.result.rolled).toBe(true)
    expect(res.result.entity_key).toMatch(/^entity:/)
  })

  it('reads encounter table from ### Encounter-Table section', async () => {
    await seedKV('location:dungeon', '## Overview\nDark and damp.\n### Encounter-Table\narchetype:goblin:80, archetype:spider:20')
    await seedKV('archetype:goblin', '**Status:** Hostile')
    await seedKV('archetype:spider', '**Status:** Lurking')
    const res = await callTool('entity_manage', { action: 'roll_encounter', location_key: 'location:dungeon', threat_level: 5 })
    expect(res.result.rolled).toBe(true)
    expect(res.result.entity_key).toMatch(/^entity:/)
  })

  it('returns rolled=false when no Encounter-Table', async () => {
    await seedKV('location:empty-field', 'Grass and wind.')
    const res = await callTool('entity_manage', { action: 'roll_encounter', location_key: 'location:empty-field' })
    expect(res.result.rolled).toBe(false)
    expect(res.result.content[0].text).toContain('No Encounter-Table')
  })
})
