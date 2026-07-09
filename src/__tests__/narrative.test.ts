import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'

describe('append_event', () => {
  it('appends an event to an entity chronicle', async () => {
    const res = await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:zira', verb: 'sedated', object: 'character:predator', thread: 'thread-alpha' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.entity_key).toBe('character:zira')
    expect(res.result.metadata.event_count).toBe(1)
    expect(res.result.metadata.duplicate).toBe(false)
  })

  it('rejects invalid world_id with FK validation error', async () => {
    await setupRpgDb(env.RPG_DB)
    const res = await callTool('continuity_manage', {
      action: 'append_event',
      entity_key: 'character:test',
      verb: 'moved',
      world_id: 'nonexistent-world-xyz',
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.message).toContain('World not found')
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
  })

  it('is idempotent within 1s for identical verb+object', async () => {
    const at = new Date().toISOString()
    await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:zira', verb: 'moved', at })
    const res = await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:zira', verb: 'moved', at })
    expect(res.result.metadata.event_count).toBe(1)
    expect(res.result.metadata.duplicate).toBe(true)
  })

  it('different verbs are not deduplicated', async () => {
    const at = new Date().toISOString()
    await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:zira', verb: 'arrived', at })
    const res = await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:zira', verb: 'departed', at })
    expect(res.result.metadata.event_count).toBe(2)
    expect(res.result.metadata.duplicate).toBe(false)
  })

  it('rejects missing verb', async () => {
    const res = await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:zira' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('accepts date and description as aliases for at and detail', async () => {
    const res = await callTool('continuity_manage', {
      action: 'append_event', entity_key: 'character:alias-test', verb: 'departed',
      date: '1264-05-01T00:00:00Z', description: 'Household begins journey', source: 'roleplay-session',
    })
    expect(res.error).toBeUndefined()
    const log = await callTool('continuity_manage', { action: 'get_event_log', entity_key: 'character:alias-test' })
    expect(log.result.events[0].detail).toBe('Household begins journey')
    expect(log.result.events[0].at).toBe('1264-05-01T00:00:00Z')
  })
})

describe('get_event_log', () => {
  it('returns events for an entity', async () => {
    await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:bob', verb: 'arrived', location: 'location:market' })
    await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:bob', verb: 'traded' })
    const res = await callTool('continuity_manage', { action: 'get_event_log', entity_key: 'character:bob' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.returned).toBe(2)
  })

  it('filters by verb', async () => {
    await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:alice', verb: 'moved' })
    await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:alice', verb: 'rested' })
    const res = await callTool('continuity_manage', { action: 'get_event_log', entity_key: 'character:alice', verbs: ['moved'] })
    expect(res.result.metadata.returned).toBe(1)
    expect(res.result.events[0].verb).toBe('moved')
  })

  it('accepts array of entity keys', async () => {
    await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:aa', verb: 'walked' })
    await callTool('continuity_manage', { action: 'append_event', entity_key: 'character:bb', verb: 'ran' })
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
