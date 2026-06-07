import { expect, it } from 'vitest'
import { describe, callTool, seedKV } from '../utils'

// ── append_event ──────────────────────────────────────────────────────────────

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

// ── get_event_log ─────────────────────────────────────────────────────────────

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

// ── recent_changes ────────────────────────────────────────────────────────────

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

// ── tag_topic ─────────────────────────────────────────────────────────────────

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

// ── find_by_tag ───────────────────────────────────────────────────────────────

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

// ── bookmark_state ────────────────────────────────────────────────────────────

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

// ── world_diff ────────────────────────────────────────────────────────────────

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

// ── plant_setup ───────────────────────────────────────────────────────────────

describe('plant_setup', () => {
  it('creates a setup entry with tension', async () => {
    const res = await callTool('plant_setup', { id: 'locked-door', description: 'The cellar door is locked', tension: 4 })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.key).toBe('setup:locked-door')
    expect(res.result.metadata.tension).toBe(4)
  })

  it('created setup appears in list_unpaid_setups', async () => {
    await callTool('plant_setup', { id: 'test-setup-1', description: 'Test setup', tension: 3 })
    const res = await callTool('list_unpaid_setups')
    const setups = res.result.setups as Array<{ id: string }>
    expect(setups.some(s => s.id === 'test-setup-1')).toBe(true)
  })

  it('defaults tension to 3 when omitted', async () => {
    const res = await callTool('plant_setup', { id: 'default-tension', description: 'No tension given' })
    expect(res.result.metadata.tension).toBe(3)
  })

  it('rejects missing description', async () => {
    const res = await callTool('plant_setup', { id: 'bad-setup' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

// ── pay_off_setup ─────────────────────────────────────────────────────────────

describe('pay_off_setup', () => {
  it('marks a setup as paid', async () => {
    await callTool('plant_setup', { id: 'gun-on-wall', description: 'The gun on the wall', tension: 5 })
    const res = await callTool('pay_off_setup', { id: 'gun-on-wall', resolution: 'Fired in chapter 3', paid_in: 'scene:climax' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.status).toBe('paid')
  })

  it('paid setup no longer appears in list_unpaid_setups', async () => {
    await callTool('plant_setup', { id: 'will-be-paid', description: 'Will be paid', tension: 2 })
    await callTool('pay_off_setup', { id: 'will-be-paid', resolution: 'Resolved' })
    const res = await callTool('list_unpaid_setups')
    const setups = res.result.setups as Array<{ id: string }>
    expect(setups.some(s => s.id === 'will-be-paid')).toBe(false)
  })

  it('supports abandoned and deferred statuses', async () => {
    await callTool('plant_setup', { id: 'dropped', description: 'Will be dropped', tension: 1 })
    const res = await callTool('pay_off_setup', { id: 'dropped', resolution: 'Cut from story', status: 'abandoned' })
    expect(res.result.metadata.status).toBe('abandoned')
  })

  it('returns error for nonexistent setup', async () => {
    const res = await callTool('pay_off_setup', { id: 'nonexistent-9999', resolution: 'Resolved' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

// ── list_unpaid_setups ────────────────────────────────────────────────────────

describe('list_unpaid_setups', () => {
  it('returns open setups sorted by tension descending', async () => {
    await callTool('plant_setup', { id: 'low-tension', description: 'Low tension', tension: 1 })
    await callTool('plant_setup', { id: 'high-tension', description: 'High tension', tension: 5 })
    const res = await callTool('list_unpaid_setups')
    expect(res.error).toBeUndefined()
    const setups = res.result.setups as Array<{ id: string; tension: number }>
    expect(setups[0].tension).toBeGreaterThanOrEqual(setups[setups.length - 1].tension)
  })

  it('filters by min_tension', async () => {
    await callTool('plant_setup', { id: 'min-t2', description: 'Low', tension: 2 })
    await callTool('plant_setup', { id: 'min-t4', description: 'High', tension: 4 })
    const res = await callTool('list_unpaid_setups', { min_tension: 3 })
    const setups = res.result.setups as Array<{ tension: number }>
    expect(setups.every(s => s.tension >= 3)).toBe(true)
    expect(setups.some(s => s.tension < 3)).toBe(false)
  })

  it('returns empty when no open setups exist', async () => {
    // Seed a non-setup KV entry so kvList uses KV instead of falling back to
    // the module-level loreDB (which accumulates setup entries across tests).
    await seedKV('placeholder:empty-setups', 'placeholder')
    const res = await callTool('list_unpaid_setups')
    expect(res.result.metadata.count).toBe(0)
    expect(res.result.content[0].text).toBe('No open setups found.')
  })
})

// ── set_goal ──────────────────────────────────────────────────────────────────

describe('set_goal', () => {
  it('adds a Goal:<id> field to an entity', async () => {
    await seedKV('character:hero', 'Hero is brave.\n**Status:** Active')
    const res = await callTool('set_goal', { entity_key: 'character:hero', goal_id: 'find-artifact', description: 'Find the ancient artifact', status: 'active' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.goal_id).toBe('find-artifact')
    expect(res.result.metadata.status).toBe('active')
    const lore = await callTool('get_lore', { query: 'character:hero' })
    expect(lore.result.text).toContain('Goal:find-artifact')
    expect(lore.result.text).toContain('active')
  })

  it('updates an existing goal in place', async () => {
    await seedKV('character:warrior', '**Status:** Active\n**Goal:main-quest:** active | Defeat the dragon')
    await callTool('set_goal', { entity_key: 'character:warrior', goal_id: 'main-quest', description: 'Defeat the dragon', status: 'blocked', obstacle: 'No sword' })
    const lore = await callTool('get_lore', { query: 'character:warrior' })
    expect(lore.result.text).toContain('blocked')
    expect(lore.result.text).toContain('No sword')
  })

  it('stores parent goal reference when provided', async () => {
    await seedKV('character:explorer', '**Status:** Active')
    await callTool('set_goal', { entity_key: 'character:explorer', goal_id: 'find-exit', description: 'Find exit', parent: 'escape' })
    const lore = await callTool('get_lore', { query: 'character:explorer' })
    expect(lore.result.text).toContain('parent: escape')
  })

  it('returns error for nonexistent entity', async () => {
    const res = await callTool('set_goal', { entity_key: 'character:ghost-9999', goal_id: 'find-peace', description: 'Find peace' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

// ── check_continuity ──────────────────────────────────────────────────────────

describe('check_continuity', () => {
  it('finds dangling character references', async () => {
    await seedKV('character:wanderer', '**Status:** Active\nShe knows character:nonexistent-person-xyz.')
    const res = await callTool('check_continuity', { checks: ['dangling'] })
    expect(res.error).toBeUndefined()
    const findings = res.result.findings as Array<{ check: string; key: string }>
    expect(findings.some(f => f.check === 'dangling' && f.key === 'character:wanderer')).toBe(true)
  })

  it('returns clean when no dangling refs', async () => {
    await seedKV('character:clean-one', '**Status:** Active\nNo problematic references here.')
    const res = await callTool('check_continuity', { scope: 'character:clean-one', checks: ['dangling'] })
    expect(res.result.content[0].text).toContain('No continuity issues found.')
  })

  it('severity_floor=error filters out warn-level findings', async () => {
    await seedKV('character:sev-test', 'Mentions character:nonexistent-sev-xyz')
    const res = await callTool('check_continuity', { checks: ['dangling'], severity_floor: 'error' })
    // dangling refs are warn severity — should be filtered out when floor is error
    const findings = res.result.findings as Array<{ severity: string }>
    expect(findings.filter(f => f.severity === 'warn')).toHaveLength(0)
  })

  it('detects missing location on character', async () => {
    await seedKV('character:lost-soul', '**Status:** Active\n**Location:** location:ghost-town-xyz-9999')
    const res = await callTool('check_continuity', { checks: ['occupancy'] })
    const findings = res.result.findings as Array<{ check: string }>
    expect(findings.some(f => f.check === 'occupancy')).toBe(true)
  })
})
