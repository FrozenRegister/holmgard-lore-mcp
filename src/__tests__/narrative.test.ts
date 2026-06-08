import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('append_event', () => {
  it('appends an event to an entity chronicle', async () => {
    const res = await callTool('append_event', { entity_key: 'character:zira', verb: 'sedated', object: 'character:predator', thread: 'thread-alpha' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.entity_key).toBe('character:zira')
    expect(res.result.metadata.event_count).toBe(1)
    expect(res.result.metadata.duplicate).toBe(false)
  })

  it('is idempotent within 1s for identical verb+object', async () => {
    const at = new Date().toISOString()
    await callTool('append_event', { entity_key: 'character:zira', verb: 'moved', at })
    const res = await callTool('append_event', { entity_key: 'character:zira', verb: 'moved', at })
    expect(res.result.metadata.event_count).toBe(1)
    expect(res.result.metadata.duplicate).toBe(true)
  })

  it('different verbs are not deduplicated', async () => {
    const at = new Date().toISOString()
    await callTool('append_event', { entity_key: 'character:zira', verb: 'arrived', at })
    const res = await callTool('append_event', { entity_key: 'character:zira', verb: 'departed', at })
    expect(res.result.metadata.event_count).toBe(2)
    expect(res.result.metadata.duplicate).toBe(false)
  })

  it('rejects missing verb', async () => {
    const res = await callTool('append_event', { entity_key: 'character:zira' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

describe('get_event_log', () => {
  it('returns events for an entity', async () => {
    await callTool('append_event', { entity_key: 'character:bob', verb: 'arrived', location: 'location:market' })
    await callTool('append_event', { entity_key: 'character:bob', verb: 'traded' })
    const res = await callTool('get_event_log', { entity_key: 'character:bob' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.returned).toBe(2)
  })

  it('filters by verb', async () => {
    await callTool('append_event', { entity_key: 'character:alice', verb: 'moved' })
    await callTool('append_event', { entity_key: 'character:alice', verb: 'rested' })
    const res = await callTool('get_event_log', { entity_key: 'character:alice', verbs: ['moved'] })
    expect(res.result.metadata.returned).toBe(1)
    expect(res.result.events[0].verb).toBe('moved')
  })

  it('accepts array of entity keys', async () => {
    await callTool('append_event', { entity_key: 'character:aa', verb: 'walked' })
    await callTool('append_event', { entity_key: 'character:bb', verb: 'ran' })
    const res = await callTool('get_event_log', { entity_key: ['character:aa', 'character:bb'] })
    expect(res.result.metadata.returned).toBe(2)
  })

  it('returns empty when no events exist', async () => {
    const res = await callTool('get_event_log', { entity_key: 'character:nobody-9999' })
    expect(res.result.metadata.returned).toBe(0)
    expect(res.result.content[0].text).toBe('No events found.')
  })

  it('rejects missing entity_key', async () => {
    const res = await callTool('get_event_log', {})
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

describe('recent_changes', () => {
  it('returns recent write operations', async () => {
    await callTool('set_lore', { key: 'character:testperson', text: 'Test' })
    const res = await callTool('recent_changes', { limit: 10 })
    expect(res.error).toBeUndefined()
    const changes = res.result.changes as Array<{ key: string }>
    expect(changes.some(c => c.key === 'character:testperson')).toBe(true)
  })

  it('filters by key_prefix', async () => {
    await callTool('set_lore', { key: 'character:hero', text: 'Hero text' })
    await callTool('set_lore', { key: 'location:forest', text: 'Forest text' })
    const res = await callTool('recent_changes', { key_prefix: 'character:', limit: 50 })
    const changes = res.result.changes as Array<{ key: string }>
    expect(changes.every(c => c.key.startsWith('character:'))).toBe(true)
  })

  it('returns empty when no changes exist', async () => {
    const res = await callTool('recent_changes')
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.count).toBe(0)
  })
})

describe('tag_topic', () => {
  it('adds tags to a topic and updates reverse index', async () => {
    await seedKV('scene:betrayal', 'A betrayal scene')
    const res = await callTool('tag_topic', { key: 'scene:betrayal', add: ['theme:betrayal', 'tone:dread'] })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.tags).toContain('theme:betrayal')
    expect(res.result.metadata.tags).toContain('tone:dread')
    const lore = await callTool('get_lore', { query: 'scene:betrayal' })
    expect(lore.result.text).toContain('theme:betrayal')
  })

  it('removes tags from a topic', async () => {
    await seedKV('scene:reunion', 'A reunion scene')
    await callTool('tag_topic', { key: 'scene:reunion', add: ['theme:hope', 'tone:warm'] })
    const res = await callTool('tag_topic', { key: 'scene:reunion', remove: ['tone:warm'] })
    expect(res.result.metadata.tags).toContain('theme:hope')
    expect(res.result.metadata.tags).not.toContain('tone:warm')
  })

  it('returns error for missing topic', async () => {
    const res = await callTool('tag_topic', { key: 'scene:nonexistent-9999', add: ['theme:test'] })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('no-ops gracefully when add and remove both empty', async () => {
    await seedKV('scene:empty-tag', 'Scene text')
    const res = await callTool('tag_topic', { key: 'scene:empty-tag' })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toContain('No add or remove tags specified.')
  })
})

describe('find_by_tag', () => {
  it('finds topics with any matching tag', async () => {
    await seedKV('scene:s1', 'Scene 1')
    await seedKV('scene:s2', 'Scene 2')
    await callTool('tag_topic', { key: 'scene:s1', add: ['theme:betrayal'] })
    await callTool('tag_topic', { key: 'scene:s2', add: ['theme:betrayal'] })
    const res = await callTool('find_by_tag', { tags: ['theme:betrayal'] })
    expect(res.error).toBeUndefined()
    expect(res.result.results.length).toBe(2)
  })

  it('returns empty when no topics match', async () => {
    const res = await callTool('find_by_tag', { tags: ['theme:nonexistent-xyz-123'] })
    expect(res.result.results.length).toBe(0)
  })

  it('mode=all returns intersection only', async () => {
    await seedKV('scene:dual', 'Dual tag scene')
    await seedKV('scene:single', 'Single tag scene')
    await callTool('tag_topic', { key: 'scene:dual', add: ['a:1', 'b:2'] })
    await callTool('tag_topic', { key: 'scene:single', add: ['a:1'] })
    const res = await callTool('find_by_tag', { tags: ['a:1', 'b:2'], mode: 'all' })
    const keys = (res.result.results as Array<{ key: string }>).map(r => r.key)
    expect(keys).toContain('scene:dual')
    expect(keys).not.toContain('scene:single')
  })

  it('rejects empty tags array', async () => {
    const res = await callTool('find_by_tag', { tags: [] })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

describe('bookmark_state', () => {
  it('creates a snapshot with correct key count', async () => {
    await seedKV('character:snap1', 'Snap 1')
    await seedKV('character:snap2', 'Snap 2')
    const res = await callTool('bookmark_state', { name: 'test-snapshot', note: 'Before battle' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.name).toBe('test-snapshot')
    expect(res.result.metadata.key_count).toBeGreaterThanOrEqual(2)
  })

  it('scopes to key_prefix', async () => {
    await seedKV('character:c1', 'C1')
    await seedKV('location:l1', 'L1')
    const res = await callTool('bookmark_state', { name: 'char-only', key_prefix: 'character:' })
    expect(res.result.metadata.key_count).toBe(1)
  })

  it('rejects missing name', async () => {
    const res = await callTool('bookmark_state', {})
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

describe('world_diff', () => {
  it('shows added keys since snapshot', async () => {
    await seedKV('character:existing', 'Existed before')
    await callTool('bookmark_state', { name: 'before-diff' })
    await callTool('set_lore', { key: 'character:new-arrival', text: 'Just added' })
    const res = await callTool('world_diff', { from: 'before-diff' })
    expect(res.error).toBeUndefined()
    expect(res.result.added).toContain('character:new-arrival')
  })

  it('shows changed keys after an update', async () => {
    await callTool('set_lore', { key: 'character:mutable', text: 'Version 1' })
    await callTool('bookmark_state', { name: 'before-update' })
    await callTool('set_lore', { key: 'character:mutable', text: 'Version 2' })
    const res = await callTool('world_diff', { from: 'before-update' })
    expect(res.result.changed.some((c: any) => c.key === 'character:mutable')).toBe(true)
  })

  it('returns zero-diff when nothing changed', async () => {
    await seedKV('character:stable', 'Stable')
    await callTool('bookmark_state', { name: 'stable-snap' })
    const res = await callTool('world_diff', { from: 'stable-snap' })
    expect(res.result.added.length).toBe(0)
    expect(res.result.removed.length).toBe(0)
    expect(res.result.changed.length).toBe(0)
  })

  it('treats unknown snapshot as empty from-manifest (all current keys are added)', async () => {
    await seedKV('character:exists', 'Exists')
    const res = await callTool('world_diff', { from: 'nonexistent-snapshot-xyz' })
    expect(res.error).toBeUndefined()
    expect(res.result.added.length).toBeGreaterThanOrEqual(1)
  })
})

