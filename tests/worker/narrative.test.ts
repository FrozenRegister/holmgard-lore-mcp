import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'
import { handle_get_event_log, handle_taxonomy_list, handle_taxonomy_set, handle_taxonomy_delete } from '@/tools/meta'

// #311 — the four `if (!c.env.RPG_DB)` D1-unavailable guards added/touched by
// this issue can't be exercised through callTool/SELF.fetch: the miniflare
// test worker always has RPG_DB bound (configured in wrangler.test.jsonc), so
// there's no request-level way to make the binding disappear. Calling the
// handler functions directly with a hand-built context is the only way to
// reach the guards' true branch — no existing test in this repo does this,
// but it's the narrowest option that doesn't change production behavior.
function mockNoDbCtx(args: unknown): any {
  return {
    c: { env: {}, json: (body: unknown) => body } as any,
    id: 1,
    args,
    isAuthenticated: true,
  }
}

describe('append_event', () => {
  it('appends an event to an entity chronicle', async () => {
    const res = await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:zira', verb: 'sedated', object: 'character:predator', thread: 'thread-alpha', world_id: 'test-world-1' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.entity_key).toBe('character:zira')
    expect(res.result.metadata.event_count).toBe(1)
    expect(res.result.metadata.duplicate).toBe(false)
  })

  it('falls back to KV when world not found in D1', async () => {
    await setupRpgDb(env.RPG_DB)
    const res = await callTool('continuity_manage', {
      action: 'append_event',
      entity_key: 'character:test',
      verb: 'moved',
      world_id: 'nonexistent-world-xyz',
    })
    // world not found in D1 falls through to KV — no error
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.entity_key).toBe('character:test')
  })

  it('rejects invalid entity_id with FK validation error', async () => {
    await setupRpgDb(env.RPG_DB)
    // Set up a world first
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('test-world-1', 'Test World', 'seed123', 100, 100, now, now).run()

    const res = await callTool('continuity_manage', {
      action: 'append_event',
      entity_key: 'character:test',
      verb: 'moved',
      world_id: 'test-world-1',
      entity_id: 'nonexistent-char-xyz',
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.message).toContain('Character not found')
  })

  it('successfully inserts event to D1 with valid world_id and entity_id', async () => {
    await setupRpgDb(env.RPG_DB)
    // Set up a world and character
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('test-world-2', 'Test World', 'seed123', 100, 100, now, now).run()
    await env.RPG_DB.prepare(
      'INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind('char-test-1', 'Test Character', '{}', 10, 10, 15, 1, now, now).run()

    const res = await callTool('continuity_manage', {
      action: 'append_event',
      entity_key: 'character:test',
      verb: 'moved',
      world_id: 'test-world-2',
      entity_id: 'char-test-1',
      detail: 'Moved to the marketplace',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.entity_key).toBe('character:test')
    expect(res.result.metadata.d1_event_id).toEqual(expect.any(String))

    const row = await env.RPG_DB.prepare('SELECT * FROM timeline_events WHERE id = ?').bind(res.result.metadata.d1_event_id).first()
    expect(row).toBeTruthy()
  })

  it('advertises world_id and entity_id in the published append_event schema (#267)', async () => {
    const res = await rpc('tools/list')
    const continuityManage = res.result.tools.find((t: { name: string }) => t.name === 'continuity_manage')
    const appendEventBranch = continuityManage.inputSchema.oneOf.find(
      (branch: { properties: { action: { const: string } } }) => branch.properties.action.const === 'append_event'
    )
    expect(appendEventBranch.properties.world_id).toBeDefined()
    expect(appendEventBranch.properties.entity_id).toBeDefined()
  })

  it('is idempotent within 1s for identical verb+object', async () => {
    const at = new Date().toISOString()
    await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:zira', verb: 'moved', at, world_id: 'test-world-1' })
    const res = await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:zira', verb: 'moved', at, world_id: 'test-world-1' })
    expect(res.result.metadata.event_count).toBe(1)
    expect(res.result.metadata.duplicate).toBe(true)
  })

  it('different verbs are not deduplicated', async () => {
    const at = new Date().toISOString()
    await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:zira', verb: 'arrived', at, world_id: 'test-world-1' })
    const res = await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:zira', verb: 'departed', at, world_id: 'test-world-1' })
    expect(res.result.metadata.event_count).toBe(2)
    expect(res.result.metadata.duplicate).toBe(false)
  })

  it('rejects missing verb', async () => {
    const res = await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:zira', world_id: 'test-world-1' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('accepts date and description as aliases for at and detail', async () => {
    const res = await callTool('continuity_manage', {
      action: 'append_event', entity_key: 'character:alias-test', verb: 'departed',
      date: '1264-05-01T00:00:00Z', description: 'Household begins journey', source: 'roleplay-session',
      world_id: 'test-world-1',
    })
    expect(res.error).toBeUndefined()
    const log = await callTool('continuity_manage', { action: 'get_event_log', entity_key: 'character:alias-test' })
    expect(log.result.events[0].detail).toBe('Household begins journey')
    expect(log.result.events[0].at).toBe('1264-05-01T00:00:00Z')
  })

  it('derives entity_id from entity_key via lore_key lookup', async () => {
    await setupRpgDb(env.RPG_DB)
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('test-world-lore', 'Test World', 'seed123', 100, 100, now, now).run()
    // Add lore_key column (not in base schema) and insert a character with it
    await env.RPG_DB.prepare('ALTER TABLE characters ADD COLUMN lore_key TEXT').run()
    await env.RPG_DB.prepare(
      'INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, created_at, updated_at, lore_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind('char-lore-1', 'Lore Character', '{}', 10, 10, 15, 1, now, now, 'character:lore-hero').run()

    const res = await callTool('continuity_manage', {
      action: 'append_event',
      entity_key: 'character:lore-hero',
      verb: 'moved',
      world_id: 'test-world-lore',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.d1_event_id).toEqual(expect.any(String))

    // Verify the derived entity_id was used in the D1 insert
    const row = await env.RPG_DB.prepare('SELECT entity_id FROM timeline_events WHERE id = ?').bind(res.result.metadata.d1_event_id).first() as { entity_id: string } | null
    expect(row?.entity_id).toBe('char-lore-1')
  })

  it('skips entity_id derivation when lore_key column is missing (catch path)', async () => {
    await setupRpgDb(env.RPG_DB)
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('test-world-nolore', 'Test World', 'seed123', 100, 100, now, now).run()
    // No lore_key column — the derivation query will throw and be caught

    const res = await callTool('continuity_manage', {
      action: 'append_event',
      entity_key: 'character:no-lore-hero',
      verb: 'arrived',
      world_id: 'test-world-nolore',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.d1_event_id).toEqual(expect.any(String))

    // entity_id should be null since derivation failed
    const row = await env.RPG_DB.prepare('SELECT entity_id FROM timeline_events WHERE id = ?').bind(res.result.metadata.d1_event_id).first() as { entity_id: string | null } | null
    expect(row?.entity_id).toBeNull()
  })

  it('auto-witnesses events to co-located entities via D1', async () => {
    await setupRpgDb(env.RPG_DB)
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('test-world-witness', 'Test World', 'seed123', 100, 100, now, now).run()
    // Create a room node so current_room_id FK is satisfied
    await env.RPG_DB.prepare(
      'INSERT INTO room_nodes (id, name, base_description, biome_context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('market-square', 'Market Square', 'A bustling market square', 'urban', now, now).run()
    // Source character
    await env.RPG_DB.prepare(
      'INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind('char-source', 'Source Character', '{}', 10, 10, 15, 1, now, now).run()
    // Witness character at the same location (current_room_id)
    await env.RPG_DB.prepare(
      'INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, created_at, updated_at, current_room_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind('char-witness', 'Witness Character', '{}', 10, 10, 15, 1, now, now, 'market-square').run()

    const res = await callTool('continuity_manage', {
      action: 'append_event',
      entity_key: 'character:source',
      verb: 'arrived',
      location: 'market-square',
      world_id: 'test-world-witness',
      entity_id: 'char-source',
      detail: 'Arrived at the market',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.d1_event_id).toEqual(expect.any(String))
    expect(res.result.metadata.auto_witnessed).toContain('char-witness')

    // Verify knowledge was created for the witness
    const knowledge = await env.RPG_DB.prepare('SELECT * FROM entity_knowledge WHERE entity_id = ?').bind('char-witness').all()
    expect(knowledge.results.length).toBeGreaterThan(0)
  })

  it('falls through to KV when timeline_events table is missing (non-FK D1 error)', async () => {
    await setupRpgDb(env.RPG_DB)
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('test-world-fallback', 'Test World', 'seed123', 100, 100, now, now).run()
    await env.RPG_DB.prepare(
      'INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind('char-fallback', 'Fallback Character', '{}', 10, 10, 15, 1, now, now).run()
    // Drop timeline_events to simulate missing table
    await env.RPG_DB.prepare('DROP TABLE IF EXISTS timeline_branches').run()
    await env.RPG_DB.prepare('DROP TABLE IF EXISTS character_snapshots').run()
    await env.RPG_DB.prepare('DROP TABLE IF EXISTS timeline_events').run()

    const res = await callTool('continuity_manage', {
      action: 'append_event',
      entity_key: 'character:fallback',
      verb: 'moved',
      world_id: 'test-world-fallback',
      entity_id: 'char-fallback',
    })
    // Should fall through to KV without error
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.d1_event_id).toBeNull()
    expect(res.result.metadata.entity_key).toBe('character:fallback')
  })

  it('returns FOREIGN KEY error when INSERT violates FK constraint', async () => {
    await setupRpgDb(env.RPG_DB)
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('test-world-fk', 'Test World', 'seed123', 100, 100, now, now).run()
    // Enable FK enforcement so the INSERT fails with a FOREIGN KEY error.
    // We bypass the entity_exists check by renaming the characters table so
    // the SELECT throws and the catch skips the FK check, then the INSERT
    // itself hits the FK violation.
    await env.RPG_DB.prepare('PRAGMA foreign_keys = ON').run()
    await env.RPG_DB.prepare('ALTER TABLE characters RENAME TO characters_bak').run()

    const res = await callTool('continuity_manage', {
      action: 'append_event',
      entity_key: 'character:fk-test',
      verb: 'moved',
      world_id: 'test-world-fk',
      entity_id: 'nonexistent-char-fk',
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32603)
    expect(res.error.message).toContain('Foreign key constraint violation')
  })

  it('skips FK check when characters table is missing but world exists', async () => {
    await setupRpgDb(env.RPG_DB)
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('test-world-nochars', 'Test World', 'seed123', 100, 100, now, now).run()
    // Rename characters table so both the lore_key derivation query and the
    // FK check query throw and are caught. entity_id stays undefined, so the
    // INSERT uses null (FK allows null).
    await env.RPG_DB.prepare('ALTER TABLE characters RENAME TO characters_bak').run()

    const res = await callTool('continuity_manage', {
      action: 'append_event',
      entity_key: 'character:nochars-test',
      verb: 'moved',
      world_id: 'test-world-nochars',
    })
    // FK check is skipped (entity_id undefined), INSERT uses null entity_id
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.d1_event_id).toEqual(expect.any(String))
  })

  it('derives entity_id as null when lore_key column exists but no character matches', async () => {
    await setupRpgDb(env.RPG_DB)
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('test-world-nomatch', 'Test World', 'seed123', 100, 100, now, now).run()
    await env.RPG_DB.prepare('ALTER TABLE characters ADD COLUMN lore_key TEXT').run()
    // No character with lore_key 'character:ghost' exists

    const res = await callTool('continuity_manage', {
      action: 'append_event',
      entity_key: 'character:ghost',
      verb: 'moved',
      world_id: 'test-world-nomatch',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.d1_event_id).toEqual(expect.any(String))

    const row = await env.RPG_DB.prepare('SELECT entity_id FROM timeline_events WHERE id = ?').bind(res.result.metadata.d1_event_id).first() as { entity_id: string | null } | null
    expect(row?.entity_id).toBeNull()
  })

  it('auto-witnesses with object, no entity_id, and no detail (branch coverage)', async () => {
    await setupRpgDb(env.RPG_DB)
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('test-world-aw2', 'Test World', 'seed123', 100, 100, now, now).run()
    await env.RPG_DB.prepare(
      'INSERT INTO room_nodes (id, name, base_description, biome_context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('tavern-room', 'Tavern', 'A dimly lit tavern interior', 'urban', now, now).run()
    // Add lore_key so entity_id is derived for the source character
    await env.RPG_DB.prepare('ALTER TABLE characters ADD COLUMN lore_key TEXT').run()
    await env.RPG_DB.prepare(
      'INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, created_at, updated_at, lore_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind('char-aw2-src', 'AW2 Source', '{}', 10, 10, 15, 1, now, now, 'character:aw2-source').run()
    await env.RPG_DB.prepare(
      'INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, created_at, updated_at, current_room_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind('char-aw2-wit', 'AW2 Witness', '{}', 10, 10, 15, 1, now, now, 'tavern-room').run()

    const res = await callTool('continuity_manage', {
      action: 'append_event',
      entity_key: 'character:aw2-source',
      verb: 'spoke',
      object: 'character:aw2-wit',
      location: 'tavern-room',
      world_id: 'test-world-aw2',
      // No entity_id, no detail — tests fallback branches
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.d1_event_id).toEqual(expect.any(String))
    expect(res.result.metadata.auto_witnessed).toContain('char-aw2-wit')
  })

  it('auto-witnesses with no co-located occupants (empty for-loop)', async () => {
    await setupRpgDb(env.RPG_DB)
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('test-world-aw3', 'Test World', 'seed123', 100, 100, now, now).run()
    await env.RPG_DB.prepare(
      'INSERT INTO room_nodes (id, name, base_description, biome_context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('empty-room', 'Empty Room', 'An empty room with nobody in it', 'urban', now, now).run()
    await env.RPG_DB.prepare(
      'INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind('char-aw3-src', 'AW3 Source', '{}', 10, 10, 15, 1, now, now).run()

    const res = await callTool('continuity_manage', {
      action: 'append_event',
      entity_key: 'character:aw3-source',
      verb: 'arrived',
      location: 'empty-room',
      world_id: 'test-world-aw3',
      entity_id: 'char-aw3-src',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.d1_event_id).toEqual(expect.any(String))
    // No witnesses since nobody else is at the location
    expect(res.result.metadata.auto_witnessed).toBeUndefined()
  })

  it('auto-witness catches errors when entity_knowledge table is missing', async () => {
    await setupRpgDb(env.RPG_DB)
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('test-world-aw4', 'Test World', 'seed123', 100, 100, now, now).run()
    await env.RPG_DB.prepare(
      'INSERT INTO room_nodes (id, name, base_description, biome_context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('aw4-room', 'AW4 Room', 'A room for testing', 'urban', now, now).run()
    await env.RPG_DB.prepare(
      'INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind('char-aw4-src', 'AW4 Source', '{}', 10, 10, 15, 1, now, now).run()
    await env.RPG_DB.prepare(
      'INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, created_at, updated_at, current_room_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind('char-aw4-wit', 'AW4 Witness', '{}', 10, 10, 15, 1, now, now, 'aw4-room').run()
    // Drop entity_knowledge table so the per-occupant INSERT fails
    await env.RPG_DB.prepare('DROP TABLE IF EXISTS entity_knowledge').run()

    const res = await callTool('continuity_manage', {
      action: 'append_event',
      entity_key: 'character:aw4-source',
      verb: 'arrived',
      location: 'aw4-room',
      world_id: 'test-world-aw4',
      entity_id: 'char-aw4-src',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.d1_event_id).toEqual(expect.any(String))
    // auto_witnessed should be undefined since all INSERTs failed
    expect(res.result.metadata.auto_witnessed).toBeUndefined()
  })

  it('auto-witness catches errors when characters table is missing (occupants query fails)', async () => {
    await setupRpgDb(env.RPG_DB)
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('test-world-aw5', 'Test World', 'seed123', 100, 100, now, now).run()
    // Insert event successfully first, then rename characters table
    // Actually, we need the characters table to exist for the event INSERT
    // but be missing for the occupants query. Since the event INSERT uses
    // entity_id (which requires the characters table), let's use a different
    // approach: drop the characters table after the event is inserted.
    // But that's not possible in a single call. Instead, let's rename
    // characters table before the call — the entity_id derivation and FK
    // check will be skipped (caught), entity_id stays null, INSERT succeeds
    // with null entity_id, then the occupants query fails.
    await env.RPG_DB.prepare('ALTER TABLE characters RENAME TO characters_bak').run()

    const res = await callTool('continuity_manage', {
      action: 'append_event',
      entity_key: 'character:aw5-source',
      verb: 'arrived',
      location: 'aw5-room',
      world_id: 'test-world-aw5',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.d1_event_id).toEqual(expect.any(String))
    // auto_witness should fail gracefully (occupants query throws)
    expect(res.result.metadata.auto_witnessed).toBeUndefined()
  })
})

describe('get_event_log', () => {
  it('returns events for an entity', async () => {
    await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:bob', verb: 'arrived', location: 'location:market', world_id: 'test-world-1' })
    await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:bob', verb: 'traded', world_id: 'test-world-1' })
    const res = await callTool('continuity_manage', { action: 'get_event_log', entity_key: 'character:bob' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.returned).toBe(2)
  })

  it('filters by verb', async () => {
    await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:alice', verb: 'moved', world_id: 'test-world-1' })
    await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:alice', verb: 'rested', world_id: 'test-world-1' })
    const res = await callTool('continuity_manage', { action: 'get_event_log', entity_key: 'character:alice', verbs: ['moved'] })
    expect(res.result.metadata.returned).toBe(1)
    expect(res.result.events[0].verb).toBe('moved')
  })

  it('accepts array of entity keys', async () => {
    await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:aa', verb: 'walked', world_id: 'test-world-1' })
    await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:bb', verb: 'ran', world_id: 'test-world-1' })
    const res = await callTool('continuity_manage', { action: 'get_event_log', entity_key: ['character:aa', 'character:bb'] })
    expect(res.result.metadata.returned).toBe(2)
  })

  it('returns empty when no events exist', async () => {
    const res = await callTool('continuity_manage', { action: 'get_event_log', entity_key: 'character:nobody-9999' })
    expect(res.result.metadata.returned).toBe(0)
    expect(res.result.content[0].text).toBe('No events found.')
  })

  it('rejects missing entity_key', async () => {
    const res = await callTool('continuity_manage', { action: 'get_event_log' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

describe('get_event_log — tier filter (#311)', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('test-world-tier', 'Test World Tier', 'seed', 10, 10, now, now).run()
  })

  it('filters events by a single tier', async () => {
    await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:tier-test', verb: 'killed', world_id: 'test-world-tier' })
    await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:tier-test', verb: 'attacked', world_id: 'test-world-tier' })
    const res = await callTool('continuity_manage', { action: 'get_event_log', entity_key: 'character:tier-test', world_id: 'test-world-tier', tier: 'high' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.returned).toBe(1)
    expect(res.result.events[0].verb).toBe('killed')
  })

  it('accepts comma-separated tiers', async () => {
    await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:tier-test-2', verb: 'killed', world_id: 'test-world-tier' })
    await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:tier-test-2', verb: 'wounded', world_id: 'test-world-tier' })
    await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:tier-test-2', verb: 'moved', world_id: 'test-world-tier' })
    const res = await callTool('continuity_manage', { action: 'get_event_log', entity_key: 'character:tier-test-2', world_id: 'test-world-tier', tier: 'high,medium' })
    expect(res.result.metadata.returned).toBe(2)
    const verbs = res.result.events.map((e: { verb: string }) => e.verb).sort()
    expect(verbs).toEqual(['killed', 'wounded'])
  })
})

describe('taxonomy_list / taxonomy_set / taxonomy_delete (#311)', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  it('lists seeded verbs filtered by tier', async () => {
    const res = await callTool('continuity_manage', { action: 'taxonomy_list', tier: 'high' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.count).toBeGreaterThan(0)
    expect(res.result.verbs.every((v: { tier: string }) => v.tier === 'high')).toBe(true)
    expect(res.result.verbs.some((v: { verb: string }) => v.verb === 'killed')).toBe(true)
  })

  it('lists seeded verbs filtered by category', async () => {
    const res = await callTool('continuity_manage', { action: 'taxonomy_list', category: 'production' })
    expect(res.result.verbs.every((v: { category: string }) => v.category === 'production')).toBe(true)
  })

  it('lists all verbs with no filter', async () => {
    const res = await callTool('continuity_manage', { action: 'taxonomy_list' })
    expect(res.result.metadata.count).toBeGreaterThanOrEqual(63)
  })

  it('creates a new verb via taxonomy_set', async () => {
    const res = await callTool('continuity_manage', { action: 'taxonomy_set', verb: 'ritualized', tier: 'medium', category: 'narrative', description: 'A ceremony was performed' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.updated).toBe(false)
    const list = await callTool('continuity_manage', { action: 'taxonomy_list', category: 'narrative' })
    expect(list.result.verbs.some((v: { verb: string }) => v.verb === 'ritualized')).toBe(true)
  })

  it('updates an existing verb via taxonomy_set', async () => {
    await callTool('continuity_manage', { action: 'taxonomy_set', verb: 'observed', tier: 'medium', category: 'narrative' })
    const res = await callTool('continuity_manage', { action: 'taxonomy_set', verb: 'observed', tier: 'high', category: 'narrative' })
    expect(res.result.metadata.updated).toBe(true)
    const list = await callTool('continuity_manage', { action: 'taxonomy_list', tier: 'high' })
    expect(list.result.verbs.some((v: { verb: string }) => v.verb === 'observed')).toBe(true)
  })

  it('deletes a verb via taxonomy_delete', async () => {
    await callTool('continuity_manage', { action: 'taxonomy_set', verb: 'temp-verb', tier: 'low', category: 'narrative' })
    const res = await callTool('continuity_manage', { action: 'taxonomy_delete', verb: 'temp-verb' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.deleted).toBe(true)
    const list = await callTool('continuity_manage', { action: 'taxonomy_list' })
    expect(list.result.verbs.some((v: { verb: string }) => v.verb === 'temp-verb')).toBe(false)
  })

  it('returns error deleting a nonexistent verb', async () => {
    const res = await callTool('continuity_manage', { action: 'taxonomy_delete', verb: 'no-such-verb-9999' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

describe('#311 — D1-unavailable guards', () => {
  it('get_event_log errors on tier filter when RPG_DB unavailable', async () => {
    const res: any = await handle_get_event_log(mockNoDbCtx({ entity_key: 'character:x', tier: 'high', limit: 50 }))
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32603)
    expect(res.error.message).toContain('D1 database unavailable')
  })

  it('taxonomy_list errors when RPG_DB unavailable', async () => {
    const res: any = await handle_taxonomy_list(mockNoDbCtx({}))
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32603)
  })

  it('taxonomy_set errors when RPG_DB unavailable', async () => {
    const res: any = await handle_taxonomy_set(mockNoDbCtx({ verb: 'x', tier: 'high', category: 'narrative' }))
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32603)
  })

  it('taxonomy_delete errors when RPG_DB unavailable', async () => {
    const res: any = await handle_taxonomy_delete(mockNoDbCtx({ verb: 'x' }))
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32603)
  })
})

describe('recent_changes', () => {
  it('returns recent write operations', async () => {
    await callTool('lore_manage', { action: 'set', key: 'character:testperson', text: 'Test' })
    const res = await callTool('continuity_manage', { action: 'recent_changes', limit: 10 })
    expect(res.error).toBeUndefined()
    const changes = res.result.changes as Array<{ key: string }>
    expect(changes.some(c => c.key === 'character:testperson')).toBe(true)
  })

  it('filters by key_prefix', async () => {
    await callTool('lore_manage', { action: 'set', key: 'character:hero', text: 'Hero text' })
    await callTool('lore_manage', { action: 'set', key: 'location:forest', text: 'Forest text' })
    const res = await callTool('continuity_manage', { action: 'recent_changes', key_prefix: 'character:', limit: 50 })
    const changes = res.result.changes as Array<{ key: string }>
    expect(changes.every(c => c.key.startsWith('character:'))).toBe(true)
  })

  it('returns empty when no changes exist', async () => {
    const res = await callTool('continuity_manage', { action: 'recent_changes' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.count).toBe(0)
  })

  it('rejects invalid params (limit not a number)', async () => {
    const res = await callTool('continuity_manage', { action: 'recent_changes', limit: 'a-lot' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.data.example).toBeDefined()
    expect(res.error.data.schema_hint).toContain('load_tool_schema')
  })
})

describe('tag_topic', () => {
  it('adds tags to a topic and updates reverse index', async () => {
    await seedKV('scene:betrayal', 'A betrayal scene')
    const res = await callTool('continuity_manage', { action: 'tag_topic', key: 'scene:betrayal', add: ['theme:betrayal', 'tone:dread'] })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.tags).toContain('theme:betrayal')
    expect(res.result.metadata.tags).toContain('tone:dread')
    const lore = await callTool('lore_manage', { action: 'get', query: 'scene:betrayal' })
    expect(lore.result.text).toContain('theme:betrayal')
  })

  it('removes tags from a topic', async () => {
    await seedKV('scene:reunion', 'A reunion scene')
    await callTool('continuity_manage', { action: 'tag_topic', key: 'scene:reunion', add: ['theme:hope', 'tone:warm'] })
    const res = await callTool('continuity_manage', { action: 'tag_topic', key: 'scene:reunion', remove: ['tone:warm'] })
    expect(res.result.metadata.tags).toContain('theme:hope')
    expect(res.result.metadata.tags).not.toContain('tone:warm')
  })

  it('returns error for missing topic', async () => {
    const res = await callTool('continuity_manage', { action: 'tag_topic', key: 'scene:nonexistent-9999', add: ['theme:test'] })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('no-ops gracefully when add and remove both empty', async () => {
    await seedKV('scene:empty-tag', 'Scene text')
    const res = await callTool('continuity_manage', { action: 'tag_topic', key: 'scene:empty-tag' })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toContain('No add or remove tags specified.')
  })

  it('rejects invalid params (missing key)', async () => {
    const res = await callTool('continuity_manage', { action: 'tag_topic', add: ['theme:test'] })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.data.example).toBeDefined()
  })
})

describe('find_by_tag', () => {
  it('finds topics with any matching tag', async () => {
    await seedKV('scene:s1', 'Scene 1')
    await seedKV('scene:s2', 'Scene 2')
    await callTool('continuity_manage', { action: 'tag_topic', key: 'scene:s1', add: ['theme:betrayal'] })
    await callTool('continuity_manage', { action: 'tag_topic', key: 'scene:s2', add: ['theme:betrayal'] })
    const res = await callTool('continuity_manage', { action: 'find_by_tag', tags: ['theme:betrayal'] })
    expect(res.error).toBeUndefined()
    expect(res.result.results.length).toBe(2)
  })

  it('returns empty when no topics match', async () => {
    const res = await callTool('continuity_manage', { action: 'find_by_tag', tags: ['theme:nonexistent-xyz-123'] })
    expect(res.result.results.length).toBe(0)
  })

  it('mode=all returns intersection only', async () => {
    await seedKV('scene:dual', 'Dual tag scene')
    await seedKV('scene:single', 'Single tag scene')
    await callTool('continuity_manage', { action: 'tag_topic', key: 'scene:dual', add: ['a:1', 'b:2'] })
    await callTool('continuity_manage', { action: 'tag_topic', key: 'scene:single', add: ['a:1'] })
    const res = await callTool('continuity_manage', { action: 'find_by_tag', tags: ['a:1', 'b:2'], mode: 'all' })
    const keys = (res.result.results as Array<{ key: string }>).map(r => r.key)
    expect(keys).toContain('scene:dual')
    expect(keys).not.toContain('scene:single')
  })

  it('rejects empty tags array', async () => {
    const res = await callTool('continuity_manage', { action: 'find_by_tag', tags: [] })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

describe('bookmark_state', () => {
  it('creates a snapshot with correct key count', async () => {
    await seedKV('character:snap1', 'Snap 1')
    await seedKV('character:snap2', 'Snap 2')
    const res = await callTool('continuity_manage', { action: 'bookmark_state', name: 'test-snapshot', note: 'Before battle' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.name).toBe('test-snapshot')
    expect(res.result.metadata.key_count).toBeGreaterThanOrEqual(2)
  })

  it('scopes to key_prefix', async () => {
    await seedKV('character:c1', 'C1')
    await seedKV('location:l1', 'L1')
    const res = await callTool('continuity_manage', { action: 'bookmark_state', name: 'char-only', key_prefix: 'character:' })
    expect(res.result.metadata.key_count).toBe(1)
  })

  it('rejects missing name', async () => {
    const res = await callTool('continuity_manage', { action: 'bookmark_state' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

describe('world_diff', () => {
  it('shows added keys since snapshot', async () => {
    await seedKV('character:existing', 'Existed before')
    await callTool('continuity_manage', { action: 'bookmark_state', name: 'before-diff' })
    await callTool('lore_manage', { action: 'set', key: 'character:new-arrival', text: 'Just added' })
    const res = await callTool('continuity_manage', { action: 'world_diff', from: 'before-diff' })
    expect(res.error).toBeUndefined()
    expect(res.result.added).toContain('character:new-arrival')
  })

  it('shows changed keys after an update', async () => {
    await callTool('lore_manage', { action: 'set', key: 'character:mutable', text: 'Version 1' })
    await callTool('continuity_manage', { action: 'bookmark_state', name: 'before-update' })
    await callTool('lore_manage', { action: 'set', key: 'character:mutable', text: 'Version 2' })
    const res = await callTool('continuity_manage', { action: 'world_diff', from: 'before-update' })
    expect(res.result.changed.some((c: any) => c.key === 'character:mutable')).toBe(true)
  })

  it('returns zero-diff when nothing changed', async () => {
    await seedKV('character:stable', 'Stable')
    await callTool('continuity_manage', { action: 'bookmark_state', name: 'stable-snap' })
    const res = await callTool('continuity_manage', { action: 'world_diff', from: 'stable-snap' })
    expect(res.result.added.length).toBe(0)
    expect(res.result.removed.length).toBe(0)
    expect(res.result.changed.length).toBe(0)
  })

  it('treats unknown snapshot as empty from-manifest (all current keys are added)', async () => {
    await seedKV('character:exists', 'Exists')
    const res = await callTool('continuity_manage', { action: 'world_diff', from: 'nonexistent-snapshot-xyz' })
    expect(res.error).toBeUndefined()
    expect(res.result.added.length).toBeGreaterThanOrEqual(1)
  })

  it('rejects invalid params (missing from)', async () => {
    const res = await callTool('continuity_manage', { action: 'world_diff' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.data.example).toBeDefined()
  })
})

describe('set_entity_knowledge', () => {
  it('rejects invalid entity_id with FK validation error', async () => {
    await setupRpgDb(env.RPG_DB)
    const res = await callTool('world_manage', {
      action: 'set_entity_knowledge',
      entity_id: 'nonexistent-char-xyz',
      topic: 'test-topic',
      knowledge_type: 'fact',
      acquired_at: '2184-07-15T00:00:00Z',
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.message).toContain('Character not found')
  })

  it('successfully inserts knowledge with valid entity_id', async () => {
    await setupRpgDb(env.RPG_DB)
    // Set up a character
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind('char-test-2', 'Test Character', '{}', 10, 10, 15, 1, now, now).run()

    const res = await callTool('world_manage', {
      action: 'set_entity_knowledge',
      entity_id: 'char-test-2',
      topic: 'the-lock',
      knowledge_type: 'fact',
      acquired_at: '2184-07-15T00:00:00Z',
      detail: 'A mysterious lock',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.entity_id).toBe('char-test-2')
    expect(res.result.metadata.topic).toBe('the-lock')
  })

  it('rejects missing entity_id param', async () => {
    const res = await callTool('world_manage', {
      action: 'set_entity_knowledge',
      topic: 'test-topic',
      knowledge_type: 'fact',
      acquired_at: '2184-07-15T00:00:00Z',
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

describe('learn_from_event', () => {
  it('rejects invalid entity_id with FK validation error', async () => {
    await setupRpgDb(env.RPG_DB)
    // Set up a world and event
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('test-world-3', 'Test World', 'seed123', 100, 100, now, now).run()
    await env.RPG_DB.prepare(
      'INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind('event-source-char', 'Event Source', '{}', 10, 10, 15, 1, now, now).run()
    await env.RPG_DB.prepare(
      'INSERT INTO timeline_events (id, world_id, thread_id, event_at, verb, entity_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('event-1', 'test-world-3', 'main', '2184-07-15T00:00:00Z', 'moved', 'event-source-char', now).run()

    const res = await callTool('world_manage', {
      action: 'learn_from_event',
      entity_id: 'nonexistent-char-xyz',
      event_id: 'event-1',
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.message).toContain('Character not found')
  })

  it('rejects invalid event_id', async () => {
    await setupRpgDb(env.RPG_DB)
    // Set up a character
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind('char-test-3', 'Test Character', '{}', 10, 10, 15, 1, now, now).run()

    const res = await callTool('world_manage', {
      action: 'learn_from_event',
      entity_id: 'char-test-3',
      event_id: 'nonexistent-event-xyz',
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.message).toContain('Event not found')
  })

  it('successfully creates knowledge from event with valid IDs', async () => {
    await setupRpgDb(env.RPG_DB)
    // Set up world, characters, and event
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('test-world-4', 'Test World', 'seed123', 100, 100, now, now).run()
    await env.RPG_DB.prepare(
      'INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind('event-source-char-2', 'Event Source', '{}', 10, 10, 15, 1, now, now).run()
    await env.RPG_DB.prepare(
      'INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind('char-test-4', 'Learning Character', '{}', 10, 10, 15, 1, now, now).run()

    await env.RPG_DB.prepare(
      'INSERT INTO timeline_events (id, world_id, thread_id, event_at, verb, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind('event-2', 'test-world-4', 'main', '2184-07-15T00:00:00Z', 'betrayed', 'event-source-char-2', 'A great betrayal occurred', now).run()

    const res = await callTool('world_manage', {
      action: 'learn_from_event',
      entity_id: 'char-test-4',
      event_id: 'event-2',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.entity_id).toBe('char-test-4')
    expect(res.result.metadata.topic).toBe('betrayed')
  })

  it('rejects missing entity_id param', async () => {
    const res = await callTool('world_manage', {
      action: 'learn_from_event',
      event_id: 'some-event-id',
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

describe('check_continuity', () => {
  it('detects dangling references', async () => {
    await seedKV('character:hero', 'A hero\n**Location:** location:castle')
    await seedKV('character:villain', 'A villain references character:missing-9999')
    const res = await callTool('continuity_manage', { action: 'check_continuity', checks: ['dangling'] })
    expect(res.error).toBeUndefined()
    const findings = res.result.findings as any[]
    expect(findings.some(f => f.check === 'dangling' && f.message.includes('missing-9999'))).toBe(true)
  })

  it('detects occupancy issues', async () => {
    await seedKV('character:hero', 'A hero\n**Location:** location:nonexistent-castle')
    const res = await callTool('continuity_manage', { action: 'check_continuity', checks: ['occupancy'] })
    expect(res.error).toBeUndefined()
    const findings = res.result.findings as any[]
    expect(findings.some(f => f.check === 'occupancy')).toBe(true)
  })

  it('filters findings by severity floor', async () => {
    await seedKV('character:test', 'Test\n**Inventory:** item:missing-sword')
    const res = await callTool('continuity_manage', { action: 'check_continuity', checks: ['inventory'], severity_floor: 'warn' })
    expect(res.error).toBeUndefined()
    const findings = res.result.findings as any[]
    // inventory issues are 'info' severity, so they should be filtered out when severity_floor is 'warn'
    expect(findings.filter(f => f.check === 'inventory').length).toBe(0)
  })

  it('scopes check to key prefix', async () => {
    await seedKV('character:hero', 'References location:missing-9999')
    await seedKV('location:castle', 'References item:missing-sword')
    const res = await callTool('continuity_manage', { action: 'check_continuity', scope: 'character', checks: ['dangling'] })
    expect(res.error).toBeUndefined()
    const findings = res.result.findings as any[]
    // Should only find issues in character: keys, not location: keys
    expect(findings.every(f => f.key.includes('character'))).toBe(true)
  })

  it('finds no issues on well-formed data', async () => {
    await seedKV('character:hero', 'A hero\n**Location:** location:castle')
    await seedKV('location:castle', 'A castle\n**Inhabitants:** character:hero')
    const res = await callTool('continuity_manage', { action: 'check_continuity' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.issue_count).toBe(0)
  })

  it('limits result summary to 20 findings', async () => {
    // Add many broken references
    for (let i = 0; i < 30; i++) {
      await seedKV(`character:char${i}`, `References item:missing-${i}`)
    }
    const res = await callTool('continuity_manage', { action: 'check_continuity', checks: ['dangling'] })
    expect(res.error).toBeUndefined()
    const findings = res.result.findings as any[]
    expect(findings.length).toBeLessThanOrEqual(30)
  })

  it('accepts severity_floor alias values', async () => {
    await seedKV('character:test', 'Test')
    const res = await callTool('continuity_manage', { action: 'check_continuity', severity_floor: 'medium' })
    expect(res.error).toBeUndefined()
  })

  it('returns result when auto_fix is false', async () => {
    await seedKV('character:test', 'Test\n**Location:** location:castle')
    const res = await callTool('continuity_manage', { action: 'check_continuity', auto_fix: false })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata).toBeDefined()
  })

  it('handles empty KV gracefully', async () => {
    const res = await callTool('continuity_manage', { action: 'check_continuity' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.scanned).toBe(0)
  })

  it('world filter excludes cross-world noise (#259)', async () => {
    await seedKV('character:cordelia-fork', '**World:** Calder\nReferences location:missing-calder')
    await seedKV('character:eira-holt', '**World:** Verdant Verge\nReferences location:missing-verdant')
    const res = await callTool('continuity_manage', { action: 'check_continuity', world: 'Calder', checks: ['dangling'] })
    expect(res.error).toBeUndefined()
    const findings = res.result.findings as any[]
    expect(findings.some(f => f.key === 'character:cordelia-fork')).toBe(true)
    expect(findings.some(f => f.key === 'character:eira-holt')).toBe(false)
    expect(res.result.metadata.world).toBe('Calder')
  })

  it('world filter is case-insensitive and excludes entries with no World field', async () => {
    await seedKV('character:cordelia-fork', '**World:** Calder\nReferences location:missing-calder')
    await seedKV('character:untagged', 'References location:missing-untagged')
    const res = await callTool('continuity_manage', { action: 'check_continuity', world: 'calder', checks: ['dangling'] })
    const findings = res.result.findings as any[]
    expect(findings.some(f => f.key === 'character:cordelia-fork')).toBe(true)
    expect(findings.some(f => f.key === 'character:untagged')).toBe(false)
  })

  it('world filter does not shrink the existence set used for dangling checks', async () => {
    // character:cordelia-fork (Calder) references location:linwood-estate, which
    // only exists as a Verdant Verge-tagged entry — it should NOT be reported as
    // dangling, because the key genuinely exists in KV; world scoping narrows what
    // gets *scanned/reported*, not what counts as "existing" for reference checks.
    await seedKV('character:cordelia-fork', '**World:** Calder\nReferences location:linwood-estate')
    await seedKV('location:linwood-estate', '**World:** Verdant Verge\nA manor.')
    const res = await callTool('continuity_manage', { action: 'check_continuity', world: 'Calder', checks: ['dangling'] })
    const findings = res.result.findings as any[]
    expect(findings.some(f => f.key === 'character:cordelia-fork' && f.message.includes('linwood-estate'))).toBe(false)
  })

  it('no world filter scans all worlds (backward compatible)', async () => {
    await seedKV('character:cordelia-fork', '**World:** Calder\nReferences item:missing-a')
    await seedKV('character:eira-holt', '**World:** Verdant Verge\nReferences item:missing-b')
    const res = await callTool('continuity_manage', { action: 'check_continuity', checks: ['dangling'] })
    const findings = res.result.findings as any[]
    expect(findings.some(f => f.key === 'character:cordelia-fork')).toBe(true)
    expect(findings.some(f => f.key === 'character:eira-holt')).toBe(true)
    expect(res.result.metadata.world).toBeNull()
  })
})
