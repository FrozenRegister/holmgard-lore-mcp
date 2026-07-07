// Direct handler tests for timeline-manage
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handleTimelineManage } from '../rpg/handlers/timeline-manage'
import { handleTimeManage } from '../rpg/handlers/time-manage'

describe('handleTimelineManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)
  const now = new Date().toISOString()

  async function seedWorld(worldId: string, date = '2184-07-15') {
    await env.RPG_DB.prepare(
      `INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(worldId, worldId, 'seed', 10, 10, now, now).run()
    await env.RPG_DB.prepare(
      `INSERT OR REPLACE INTO world_state (world_id, "current_date", era) VALUES (?, ?, NULL)`
    ).bind(worldId, date).run()
  }

  async function seedChar(id: string, born: string | null = null) {
    await env.RPG_DB.prepare(
      `INSERT OR IGNORE INTO characters (id, name, stats, hp, max_hp, ac, level, character_type, character_class, race, conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells, cantrips_known, currency, resource_pools, xp, born, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, id, '{}', 10, 10, 10, 1, 'pc', 'Fighter', 'Human', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', 0, born, now, now).run()
  }

  async function seedEvent(worldId: string, opts: { id?: string; verb?: string; eventAt?: string; entityId?: string | null; thread?: string; canonical?: boolean; branchId?: string | null }) {
    const id = opts.id ?? `evt-${Math.random().toString(36).slice(2)}`
    await env.RPG_DB.prepare(
      `INSERT OR IGNORE INTO timeline_events (id, world_id, thread_id, event_at, verb, entity_id, object_entity, location_id, detail, is_canonical, branch_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)`
    ).bind(id, worldId, opts.thread ?? 'main', opts.eventAt ?? '2184-07-15', opts.verb ?? 'arrived', opts.entityId ?? null, opts.canonical ? 1 : 0, opts.branchId ?? null, now).run()
    return id
  }

  // ── Unknown action ────────────────────────────────────────────────────────

  it('returns guiding error for unknown action', async () => {
    const r = await handleTimelineManage(db(), { action: 'zap_timeline' })
    expect(r.content[0].text).toContain('zap_timeline')
  })

  // ── get_events ────────────────────────────────────────────────────────────

  it('get_events requires world_id', async () => {
    const body = JSON.parse((await handleTimelineManage(db(), { action: 'get_events' })).content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_events returns empty list when no events', async () => {
    await seedWorld('w-ge-empty')
    const body = JSON.parse((await handleTimelineManage(db(), { action: 'get_events', world_id: 'w-ge-empty' })).content[0].text)
    expect(body.success).toBe(true)
    expect(body.events).toHaveLength(0)
  })

  it('get_events returns events for world', async () => {
    await seedWorld('w-ge')
    await seedEvent('w-ge', { id: 'evt-a', verb: 'departed', eventAt: '2184-07-01' })
    await seedEvent('w-ge', { id: 'evt-b', verb: 'arrived', eventAt: '2184-07-10' })
    const body = JSON.parse((await handleTimelineManage(db(), { action: 'get_events', world_id: 'w-ge' })).content[0].text)
    expect(body.events).toHaveLength(2)
    expect(body.events[0].id).toBe('evt-a') // ordered by event_at ASC
  })

  it('get_events filters by thread', async () => {
    await seedWorld('w-ge-thread')
    await seedEvent('w-ge-thread', { verb: 'marched', thread: 'main' })
    await seedEvent('w-ge-thread', { verb: 'sailed', thread: 'side' })
    const body = JSON.parse((await handleTimelineManage(db(), { action: 'get_events', world_id: 'w-ge-thread', thread: 'main' })).content[0].text)
    expect(body.events).toHaveLength(1)
    expect(body.events[0].verb).toBe('marched')
  })

  it('get_events filters by entity_id', async () => {
    await seedWorld('w-ge-eid')
    await seedChar('char-ge')
    await seedEvent('w-ge-eid', { verb: 'spoke', entityId: 'char-ge' })
    await seedEvent('w-ge-eid', { verb: 'slept', entityId: null })
    const body = JSON.parse((await handleTimelineManage(db(), { action: 'get_events', world_id: 'w-ge-eid', entity_id: 'char-ge' })).content[0].text)
    expect(body.events).toHaveLength(1)
    expect(body.events[0].verb).toBe('spoke')
  })

  it('get_events filters by verb', async () => {
    await seedWorld('w-ge-verb')
    await seedEvent('w-ge-verb', { verb: 'attacked' })
    await seedEvent('w-ge-verb', { verb: 'fled' })
    const body = JSON.parse((await handleTimelineManage(db(), { action: 'get_events', world_id: 'w-ge-verb', verb: 'attacked' })).content[0].text)
    expect(body.events).toHaveLength(1)
  })

  it('get_events filters by from/to date range', async () => {
    await seedWorld('w-ge-range')
    await seedEvent('w-ge-range', { verb: 'early', eventAt: '2184-01-01' })
    await seedEvent('w-ge-range', { verb: 'mid', eventAt: '2184-06-01' })
    await seedEvent('w-ge-range', { verb: 'late', eventAt: '2184-12-01' })
    const body = JSON.parse((await handleTimelineManage(db(), { action: 'get_events', world_id: 'w-ge-range', from: '2184-05-01', to: '2184-07-01' })).content[0].text)
    expect(body.events).toHaveLength(1)
    expect(body.events[0].verb).toBe('mid')
  })

  it('get_events filters canonical_only', async () => {
    await seedWorld('w-ge-canon')
    await seedEvent('w-ge-canon', { verb: 'canon', canonical: true })
    await seedEvent('w-ge-canon', { verb: 'noncanon', canonical: false })
    const body = JSON.parse((await handleTimelineManage(db(), { action: 'get_events', world_id: 'w-ge-canon', canonical_only: true })).content[0].text)
    expect(body.events).toHaveLength(1)
    expect(body.events[0].verb).toBe('canon')
  })

  // ── get_gap ───────────────────────────────────────────────────────────────

  it('get_gap requires before_event_id and after_event_id', async () => {
    const r1 = await handleTimelineManage(db(), { action: 'get_gap', after_event_id: 'x' })
    expect(JSON.parse(r1.content[0].text).error).toBe(true)
    const r2 = await handleTimelineManage(db(), { action: 'get_gap', before_event_id: 'x' })
    expect(JSON.parse(r2.content[0].text).error).toBe(true)
  })

  it('get_gap returns error for unknown events', async () => {
    const body = JSON.parse((await handleTimelineManage(db(), { action: 'get_gap', before_event_id: 'no-evt', after_event_id: 'also-no' })).content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_gap returns gap with canonical events and characters between', async () => {
    await seedWorld('w-gap')
    await seedChar('c-gap')
    const beforeId = await seedEvent('w-gap', { verb: 'start', eventAt: '2184-01-01' })
    const midId = await seedEvent('w-gap', { verb: 'middle', eventAt: '2184-06-01', canonical: true, entityId: 'c-gap' })
    const afterId = await seedEvent('w-gap', { verb: 'end', eventAt: '2184-12-01' })
    const body = JSON.parse((await handleTimelineManage(db(), { action: 'get_gap', before_event_id: beforeId, after_event_id: afterId })).content[0].text)
    expect(body.success).toBe(true)
    expect(body.canonical_events_in_gap).toHaveLength(1)
    expect(body.canonical_events_in_gap[0].id).toBe(midId)
    expect(body.present_characters).toContain('c-gap')
  })

  // ── get_perspectives ──────────────────────────────────────────────────────

  it('get_perspectives requires world_id, from, to', async () => {
    const r = await handleTimelineManage(db(), { action: 'get_perspectives', world_id: 'w1' })
    expect(JSON.parse(r.content[0].text).error).toBe(true)
  })

  it('get_perspectives returns distinct characters in date range', async () => {
    await seedWorld('w-pov')
    await seedChar('c-pov-a')
    await seedChar('c-pov-b')
    await seedEvent('w-pov', { verb: 'acts', eventAt: '2184-06-01', entityId: 'c-pov-a' })
    await seedEvent('w-pov', { verb: 'acts', eventAt: '2184-08-01', entityId: 'c-pov-b' })
    await seedEvent('w-pov', { verb: 'acts', eventAt: '2184-11-01', entityId: 'c-pov-a' }) // outside range
    const body = JSON.parse((await handleTimelineManage(db(), { action: 'get_perspectives', world_id: 'w-pov', from: '2184-05-01', to: '2184-09-01' })).content[0].text)
    expect(body.characters).toHaveLength(2)
    expect(body.characters).toContain('c-pov-a')
    expect(body.characters).toContain('c-pov-b')
  })

  // ── create_branch ─────────────────────────────────────────────────────────

  it('create_branch requires world_id, name, forked_at_event_id', async () => {
    const r = await handleTimelineManage(db(), { action: 'create_branch', world_id: 'w1', name: 'alt' })
    expect(JSON.parse(r.content[0].text).error).toBe(true)
  })

  it('create_branch returns error when pivot event not found', async () => {
    await seedWorld('w-cb')
    const body = JSON.parse((await handleTimelineManage(db(), { action: 'create_branch', world_id: 'w-cb', name: 'alt', forked_at_event_id: 'no-evt' })).content[0].text)
    expect(body.error).toBe(true)
  })

  it('create_branch creates a branch row', async () => {
    await seedWorld('w-cb2')
    const evtId = await seedEvent('w-cb2', { verb: 'pivot' })
    const body = JSON.parse((await handleTimelineManage(db(), { action: 'create_branch', world_id: 'w-cb2', name: 'alt-timeline', forked_at_event_id: evtId, reason: 'What if?' })).content[0].text)
    expect(body.success).toBe(true)
    expect(body.branch_id).toBeTruthy()
    expect(body.name).toBe('alt-timeline')
  })

  // ── switch_branch ─────────────────────────────────────────────────────────

  it('switch_branch requires world_id and branch_id', async () => {
    const r = await handleTimelineManage(db(), { action: 'switch_branch', world_id: 'w1' })
    expect(JSON.parse(r.content[0].text).error).toBe(true)
  })

  it('switch_branch returns error for unknown branch', async () => {
    await seedWorld('w-sb')
    const body = JSON.parse((await handleTimelineManage(db(), { action: 'switch_branch', world_id: 'w-sb', branch_id: 'no-branch' })).content[0].text)
    expect(body.error).toBe(true)
  })

  it('switch_branch marks branch as active', async () => {
    await seedWorld('w-sb2')
    const evtId = await seedEvent('w-sb2', { verb: 'pivot' })
    const cbBody = JSON.parse((await handleTimelineManage(db(), { action: 'create_branch', world_id: 'w-sb2', name: 'alt', forked_at_event_id: evtId })).content[0].text)
    const branchId = cbBody.branch_id
    const body = JSON.parse((await handleTimelineManage(db(), { action: 'switch_branch', world_id: 'w-sb2', branch_id: branchId })).content[0].text)
    expect(body.success).toBe(true)
    expect(body.active_branch_id).toBe(branchId)
    const row = await env.RPG_DB.prepare('SELECT is_active FROM timeline_branches WHERE id = ?').bind(branchId).first() as { is_active: number }
    expect(row.is_active).toBe(1)
  })

  // ── compare_branches ──────────────────────────────────────────────────────

  it('compare_branches requires branch_a and branch_b', async () => {
    const r = await handleTimelineManage(db(), { action: 'compare_branches', branch_a: 'a' })
    expect(JSON.parse(r.content[0].text).error).toBe(true)
  })

  it('compare_branches computes shared and divergent events', async () => {
    await seedWorld('w-cmp')
    const e1 = await seedEvent('w-cmp', { verb: 'shared', branchId: 'br-a' })
    await seedEvent('w-cmp', { verb: 'only-a', branchId: 'br-a' })
    await seedEvent('w-cmp', { verb: 'only-b', branchId: 'br-b' })
    // Make e1 also on br-b by updating
    await env.RPG_DB.prepare('UPDATE timeline_events SET branch_id = ? WHERE id = ?').bind('br-b', e1).run()
    // Actually compare events per branch
    const body = JSON.parse((await handleTimelineManage(db(), { action: 'compare_branches', branch_a: 'br-a', branch_b: 'br-b' })).content[0].text)
    expect(body.success).toBe(true)
    // Branches have separate events by branch_id
    expect(body.only_in_a).toHaveLength(1)
    expect(body.only_in_b).toHaveLength(1)
  })

  // ── merge_branch ──────────────────────────────────────────────────────────

  it('merge_branch requires source_branch_id, target_branch_id, event_ids', async () => {
    const r = await handleTimelineManage(db(), { action: 'merge_branch', source_branch_id: 'a', target_branch_id: 'b' })
    expect(JSON.parse(r.content[0].text).error).toBe(true)
  })

  it('merge_branch moves events from source to target branch', async () => {
    await seedWorld('w-merge')
    const evtId = await seedEvent('w-merge', { verb: 'migrated', branchId: 'src-branch' })
    const body = JSON.parse((await handleTimelineManage(db(), { action: 'merge_branch', source_branch_id: 'src-branch', target_branch_id: 'tgt-branch', event_ids: [evtId] })).content[0].text)
    expect(body.success).toBe(true)
    expect(body.merged_count).toBe(1)
    const row = await env.RPG_DB.prepare('SELECT branch_id FROM timeline_events WHERE id = ?').bind(evtId).first() as { branch_id: string }
    expect(row.branch_id).toBe('tgt-branch')
  })

  it('merge_branch skips events not in source branch', async () => {
    await seedWorld('w-merge2')
    const evtId = await seedEvent('w-merge2', { verb: 'unrelated', branchId: 'other-branch' })
    const body = JSON.parse((await handleTimelineManage(db(), { action: 'merge_branch', source_branch_id: 'src', target_branch_id: 'tgt', event_ids: [evtId] })).content[0].text)
    expect(body.merged_count).toBe(0)
  })
})

describe('handleTimeManage — get_timeline and jump_to', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)
  const now = new Date().toISOString()

  async function seedWorld(worldId: string, date = '2184-07-15') {
    await env.RPG_DB.prepare(
      `INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(worldId, worldId, 'seed', 10, 10, now, now).run()
    await env.RPG_DB.prepare(
      `INSERT OR REPLACE INTO world_state (world_id, "current_date", era) VALUES (?, ?, NULL)`
    ).bind(worldId, date).run()
  }

  async function seedChar(id: string) {
    await env.RPG_DB.prepare(
      `INSERT OR IGNORE INTO characters (id, name, stats, hp, max_hp, ac, level, character_type, character_class, race, conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells, cantrips_known, currency, resource_pools, xp, born, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    ).bind(id, id, '{}', 10, 10, 10, 1, 'pc', 'Fighter', 'Human', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', 0, now, now).run()
  }

  async function seedEvent(worldId: string, opts: { id?: string; verb?: string; eventAt?: string; entityId?: string | null; canonical?: boolean }) {
    const id = opts.id ?? `te-${Math.random().toString(36).slice(2)}`
    await env.RPG_DB.prepare(
      `INSERT OR IGNORE INTO timeline_events (id, world_id, thread_id, event_at, verb, entity_id, object_entity, location_id, detail, is_canonical, branch_id, created_at)
       VALUES (?, ?, 'main', ?, ?, ?, NULL, NULL, NULL, ?, NULL, ?)`
    ).bind(id, worldId, opts.eventAt ?? '2184-07-15', opts.verb ?? 'happened', opts.entityId ?? null, opts.canonical ? 1 : 0, now).run()
    return id
  }

  // ── get_timeline ──────────────────────────────────────────────────────────

  it('get_timeline requires world_id', async () => {
    const body = JSON.parse((await handleTimeManage(db(), { action: 'get_timeline' })).content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_timeline returns all events for world ordered by date', async () => {
    await seedWorld('w-tl')
    await seedEvent('w-tl', { verb: 'first', eventAt: '2184-01-01' })
    await seedEvent('w-tl', { verb: 'second', eventAt: '2184-12-01' })
    const body = JSON.parse((await handleTimeManage(db(), { action: 'get_timeline', world_id: 'w-tl' })).content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBe(2)
    expect((body.events[0] as any).verb).toBe('first')
  })

  it('get_timeline filters by from/to', async () => {
    await seedWorld('w-tl2')
    await seedEvent('w-tl2', { verb: 'early', eventAt: '2183-01-01' })
    await seedEvent('w-tl2', { verb: 'mid', eventAt: '2184-06-01' })
    const body = JSON.parse((await handleTimeManage(db(), { action: 'get_timeline', world_id: 'w-tl2', from: '2184-01-01', to: '2184-12-31' })).content[0].text)
    expect(body.count).toBe(1)
    expect((body.events[0] as any).verb).toBe('mid')
  })

  it('get_timeline filters by thread', async () => {
    await seedWorld('w-tl3')
    await env.RPG_DB.prepare(
      `INSERT INTO timeline_events (id, world_id, thread_id, event_at, verb, entity_id, object_entity, location_id, detail, is_canonical, branch_id, created_at) VALUES ('tl-a','w-tl3','alpha','2184-06-01','acts',NULL,NULL,NULL,NULL,0,NULL,?)`
    ).bind(now).run()
    await env.RPG_DB.prepare(
      `INSERT INTO timeline_events (id, world_id, thread_id, event_at, verb, entity_id, object_entity, location_id, detail, is_canonical, branch_id, created_at) VALUES ('tl-b','w-tl3','beta','2184-06-01','acts',NULL,NULL,NULL,NULL,0,NULL,?)`
    ).bind(now).run()
    const body = JSON.parse((await handleTimeManage(db(), { action: 'get_timeline', world_id: 'w-tl3', thread: 'alpha' })).content[0].text)
    expect(body.count).toBe(1)
  })

  // ── jump_to ───────────────────────────────────────────────────────────────

  it('jump_to requires world_id and date', async () => {
    const r1 = await handleTimeManage(db(), { action: 'jump_to', world_id: 'w1' })
    expect(JSON.parse(r1.content[0].text).error).toBe(true)
    const r2 = await handleTimeManage(db(), { action: 'jump_to', date: '2184-07-15' })
    expect(JSON.parse(r2.content[0].text).error).toBe(true)
  })

  it('jump_to returns gap with null events when no canonical events exist', async () => {
    await seedWorld('w-jump')
    const body = JSON.parse((await handleTimeManage(db(), { action: 'jump_to', world_id: 'w-jump', date: '2184-07-15' })).content[0].text)
    expect(body.success).toBe(true)
    expect(body.gap.before_event).toBeNull()
    expect(body.gap.after_event).toBeNull()
  })

  it('jump_to returns bracketing canonical events', async () => {
    await seedWorld('w-jump2')
    await seedChar('c-jump')
    await seedEvent('w-jump2', { verb: 'before', eventAt: '2184-01-01', canonical: true, entityId: 'c-jump' })
    await seedEvent('w-jump2', { verb: 'after', eventAt: '2184-12-01', canonical: true })
    const body = JSON.parse((await handleTimeManage(db(), { action: 'jump_to', world_id: 'w-jump2', date: '2184-07-15' })).content[0].text)
    expect(body.gap.before_event.verb).toBe('before')
    expect(body.gap.after_event.verb).toBe('after')
    expect(body.present_characters).toContain('c-jump')
    expect(body.mode).toBe('observe')
  })

  it('jump_to play mode adds constraint when after_event exists', async () => {
    await seedWorld('w-jump3')
    await seedEvent('w-jump3', { verb: 'constraint-trigger', eventAt: '2184-12-01', canonical: true })
    const body = JSON.parse((await handleTimeManage(db(), { action: 'jump_to', world_id: 'w-jump3', date: '2184-07-15', mode: 'play' })).content[0].text)
    expect(body.mode).toBe('play')
    expect(body.constraint).toBeTruthy()
  })
})
