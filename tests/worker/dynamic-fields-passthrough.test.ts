// #425 — arbitrary D1 column passthrough (`fields`) across the 6 handlers
// audited as having narrow update whitelists that orphan migration-added
// columns: character, world, party, secret, quest, and world_state (via
// production.update_state, since world_state has no single owning handler).
import { describe } from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'

describe('dynamic fields passthrough (#425)', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    })
    const json = (await res.json()) as Record<string, any>
    const text = json.result?.content?.[0]?.text
    return text ? JSON.parse(text) : json
  }

  // ── character.update ───────────────────────────────────────────────────

  it('character.update: sets migration-0003 columns with no dedicated param (alias, state_stage) via fields', async () => {
    const created = await callTool('rpg', {
      sub: 'character',
      action: 'create',
      name: 'Fields Test Subject',
    })
    const res = await callTool('rpg', {
      sub: 'character',
      action: 'update',
      characterId: created.characterId,
      fields: { alias: 'Ghost', state_stage: 3 },
    })
    expect(res.success).toBe(true)
    expect(res.fields_applied).toEqual(['alias', 'state_stage'])
    expect(res.fields_rejected).toEqual([])
    const row = (await env.RPG_DB.prepare('SELECT alias, state_stage FROM characters WHERE id = ?')
      .bind(created.characterId)
      .first()) as { alias: string; state_stage: number }
    expect(row.alias).toBe('Ghost')
    expect(row.state_stage).toBe(3)
  })

  it('character.update: rejects blacklisted columns (id, world_id) without applying them', async () => {
    const created = await callTool('rpg', {
      sub: 'character',
      action: 'create',
      name: 'Blacklist Test',
    })
    const res = await callTool('rpg', {
      sub: 'character',
      action: 'update',
      characterId: created.characterId,
      fields: { world_id: 'sneaky-world', alias: 'ok' },
    })
    expect(res.success).toBe(true)
    expect(res.fields_applied).toEqual(['alias'])
    expect(res.fields_rejected).toEqual([{ field: 'world_id', reason: 'blacklisted' }])
  })

  it('character.update: an explicit param wins over the same key in fields', async () => {
    const created = await callTool('rpg', {
      sub: 'character',
      action: 'create',
      name: 'Precedence Test',
    })
    const res = await callTool('rpg', {
      sub: 'character',
      action: 'update',
      characterId: created.characterId,
      name: 'Explicit Wins',
      fields: { name: 'Passthrough Loses', alias: 'still-applied' },
    })
    expect(res.success).toBe(true)
    expect(res.fields_applied).toEqual(['alias'])
    const row = (await env.RPG_DB.prepare('SELECT name FROM characters WHERE id = ?')
      .bind(created.characterId)
      .first()) as { name: string }
    expect(row.name).toBe('Explicit Wins')
  })

  it('character.update: does not include fields_applied/fields_rejected when fields is omitted', async () => {
    const created = await callTool('rpg', {
      sub: 'character',
      action: 'create',
      name: 'No Fields Test',
    })
    const res = await callTool('rpg', {
      sub: 'character',
      action: 'update',
      characterId: created.characterId,
      name: 'Renamed',
    })
    expect(res.success).toBe(true)
    expect(res.fields_applied).toBeUndefined()
    expect(res.fields_rejected).toBeUndefined()
  })

  // ── world.update ───────────────────────────────────────────────────────

  it('world.update: sets universe_id (migration 0032, previously orphaned) via fields', async () => {
    const world = await callTool('rpg', {
      sub: 'world',
      action: 'create',
      name: 'Fields World',
      theme: 'fantasy',
    })
    const universeId = crypto.randomUUID()
    await env.RPG_DB.prepare('INSERT INTO universes (id, name, created_at) VALUES (?, ?, ?)')
      .bind(universeId, 'Test Universe', new Date().toISOString())
      .run()
    const res = await callTool('rpg', {
      sub: 'world',
      action: 'update',
      worldId: world.worldId,
      fields: { universe_id: universeId },
    })
    expect(res.success).toBe(true)
    expect(res.fields_applied).toEqual(['universe_id'])
    const row = (await env.RPG_DB.prepare('SELECT universe_id FROM worlds WHERE id = ?')
      .bind(world.worldId)
      .first()) as { universe_id: string }
    expect(row.universe_id).toBe(universeId)
  })

  // ── party.update ───────────────────────────────────────────────────────

  it('party.update: sets formation and current_location (no update path anywhere) via fields', async () => {
    const party = await callTool('rpg', { sub: 'party', action: 'create', name: 'Fields Party' })
    const res = await callTool('rpg', {
      sub: 'party',
      action: 'update',
      id: party.partyId,
      fields: { formation: 'wedge', current_location: 'location:camp' },
    })
    expect(res.success).toBe(true)
    expect(res.fields_applied).toEqual(['formation', 'current_location'])
    const row = (await env.RPG_DB.prepare(
      'SELECT formation, current_location FROM parties WHERE id = ?',
    )
      .bind(party.partyId)
      .first()) as { formation: string; current_location: string }
    expect(row.formation).toBe('wedge')
    expect(row.current_location).toBe('location:camp')
  })

  it('party.update: rejects world_id from the passthrough blacklist', async () => {
    const party = await callTool('rpg', {
      sub: 'party',
      action: 'create',
      name: 'Party Blacklist Test',
    })
    const res = await callTool('rpg', {
      sub: 'party',
      action: 'update',
      id: party.partyId,
      fields: { world_id: 'sneaky' },
    })
    expect(res.success).toBe(true)
    expect(res.fields_rejected).toEqual([{ field: 'world_id', reason: 'blacklisted' }])
  })

  // ── secret.update ──────────────────────────────────────────────────────

  it('secret.update: sets notes (no update path since the initial migration) via fields', async () => {
    const world = await callTool('rpg', {
      sub: 'world',
      action: 'create',
      name: 'Secret Fields World',
      theme: 'fantasy',
    })
    const secret = await callTool('rpg', {
      sub: 'secret',
      action: 'create',
      worldId: world.worldId,
      name: 'Fields Secret',
      publicDescription: 'public',
      secretDescription: 'secret',
    })
    const res = await callTool('rpg', {
      sub: 'secret',
      action: 'update',
      id: secret.secretId,
      fields: { notes: 'backfilled note' },
    })
    expect(res.success).toBe(true)
    expect(res.fields_applied).toEqual(['notes'])
    const row = (await env.RPG_DB.prepare('SELECT notes FROM secrets WHERE id = ?')
      .bind(secret.secretId)
      .first()) as { notes: string }
    expect(row.notes).toBe('backfilled note')
  })

  // ── quest.update ───────────────────────────────────────────────────────

  it('quest.update: now applies rewards and prerequisites (declared in schema, previously never wired into update)', async () => {
    const world = await callTool('rpg', {
      sub: 'world',
      action: 'create',
      name: 'Quest Fields World',
      theme: 'fantasy',
    })
    const quest = await callTool('rpg', {
      sub: 'quest',
      action: 'create',
      name: 'Fields Quest',
      worldId: world.worldId,
    })
    const res = await callTool('rpg', {
      sub: 'quest',
      action: 'update',
      questId: quest.questId,
      rewards: { gold: 500 },
      prerequisites: ['quest:intro'],
    })
    expect(res.success).toBe(true)
    const row = (await env.RPG_DB.prepare('SELECT rewards, prerequisites FROM quests WHERE id = ?')
      .bind(quest.questId)
      .first()) as { rewards: string; prerequisites: string }
    expect(JSON.parse(row.rewards)).toEqual({ gold: 500 })
    expect(JSON.parse(row.prerequisites)).toEqual(['quest:intro'])
  })

  it('quest.update: also supports arbitrary passthrough via fields', async () => {
    const world = await callTool('rpg', {
      sub: 'world',
      action: 'create',
      name: 'Quest Passthrough World',
      theme: 'fantasy',
    })
    const quest = await callTool('rpg', {
      sub: 'quest',
      action: 'create',
      name: 'Passthrough Quest',
      worldId: world.worldId,
    })
    const res = await callTool('rpg', {
      sub: 'quest',
      action: 'update',
      questId: quest.questId,
      fields: { giver: 'npc:mysterious-stranger' },
    })
    expect(res.success).toBe(true)
    expect(res.fields_applied).toEqual(['giver'])
  })

  // ── production.update_state (world_state) ─────────────────────────────

  it('production.update_state: returns an error for a worldId with no production state row', async () => {
    // world.create seeds world_state via seedWorldState() (INSERT OR IGNORE), so
    // every real world already has a row — a bogus worldId is the only way to hit
    // the "no state" branch.
    const res = await callTool('rpg', {
      sub: 'production',
      action: 'update_state',
      worldId: crypto.randomUUID(),
      fields: { production_mood: 'grim' },
    })
    expect(res.error).toBe(true)
    expect(res.message).toContain('call advance_day')
  })

  it('production.update_state: sets production_mood (zero writers anywhere) once a production state row exists', async () => {
    const world = await callTool('rpg', {
      sub: 'world',
      action: 'create',
      name: 'Mood World',
      theme: 'fantasy',
    })
    await callTool('rpg', { sub: 'production', action: 'advance_day', worldId: world.worldId })
    const res = await callTool('rpg', {
      sub: 'production',
      action: 'update_state',
      worldId: world.worldId,
      fields: { production_mood: 'grim' },
    })
    expect(res.success).toBe(true)
    expect(res.fields_applied).toEqual(['production_mood'])
    const row = (await env.RPG_DB.prepare(
      'SELECT production_mood FROM world_state WHERE world_id = ?',
    )
      .bind(world.worldId)
      .first()) as { production_mood: string }
    expect(row.production_mood).toBe('grim')
  })

  it("production.update_state: also sets era/tick_speed (orphaned since migration 0005, the table's own creation)", async () => {
    const world = await callTool('rpg', {
      sub: 'world',
      action: 'create',
      name: 'Era World',
      theme: 'fantasy',
    })
    await callTool('rpg', { sub: 'production', action: 'advance_day', worldId: world.worldId })
    const res = await callTool('rpg', {
      sub: 'production',
      action: 'update_state',
      worldId: world.worldId,
      fields: { era: 'the-long-winter', tick_speed: 'paused' },
    })
    expect(res.success).toBe(true)
    expect(res.fields_applied).toEqual(['era', 'tick_speed'])
  })

  it('production.update_state: rejects world_id from the passthrough blacklist (the primary key)', async () => {
    const world = await callTool('rpg', {
      sub: 'world',
      action: 'create',
      name: 'PK World',
      theme: 'fantasy',
    })
    await callTool('rpg', { sub: 'production', action: 'advance_day', worldId: world.worldId })
    const res = await callTool('rpg', {
      sub: 'production',
      action: 'update_state',
      worldId: world.worldId,
      fields: { world_id: 'sneaky' },
    })
    expect(res.error).toBe(true)
    expect(res.message).toContain('No valid fields')
  })

  it('production.update_state: errors when fields is missing entirely', async () => {
    const world = await callTool('rpg', {
      sub: 'world',
      action: 'create',
      name: 'Missing Fields World',
      theme: 'fantasy',
    })
    await callTool('rpg', { sub: 'production', action: 'advance_day', worldId: world.worldId })
    const res = await callTool('rpg', {
      sub: 'production',
      action: 'update_state',
      worldId: world.worldId,
    })
    expect(res.error).toBe(true)
    expect(res.message).toContain('"fields" must be a non-empty object')
  })

  it('production.update_state: errors when worldId is missing', async () => {
    const res = await callTool('rpg', {
      sub: 'production',
      action: 'update_state',
      fields: { production_mood: 'grim' },
    })
    expect(res.error).toBe(true)
    expect(res.message).toContain('worldId')
  })

  it('production.update_state: the set_state / update aliases resolve to update_state', async () => {
    const world = await callTool('rpg', {
      sub: 'world',
      action: 'create',
      name: 'Alias World',
      theme: 'fantasy',
    })
    await callTool('rpg', { sub: 'production', action: 'advance_day', worldId: world.worldId })
    const res = await callTool('rpg', {
      sub: 'production',
      action: 'set_state',
      worldId: world.worldId,
      fields: { production_mood: 'tense' },
    })
    expect(res.success).toBe(true)
    expect(res.actionType).toBe('update_state')
  })

  // ── column-name safety (SQL injection boundary) ────────────────────────

  it('rejects an invalid column-name shape without touching the database', async () => {
    const created = await callTool('rpg', {
      sub: 'character',
      action: 'create',
      name: 'Injection Test',
    })
    const res = await callTool('rpg', {
      sub: 'character',
      action: 'update',
      characterId: created.characterId,
      fields: { 'name; DROP TABLE characters;--': 'x' },
    })
    expect(res.success).toBe(true)
    expect(res.fields_rejected).toEqual([
      { field: 'name; DROP TABLE characters;--', reason: 'invalid column name' },
    ])
    // The table must still exist and be queryable — a real injection would have dropped it.
    const row = await env.RPG_DB.prepare('SELECT id FROM characters WHERE id = ?')
      .bind(created.characterId)
      .first()
    expect(row).toBeTruthy()
  })
})
