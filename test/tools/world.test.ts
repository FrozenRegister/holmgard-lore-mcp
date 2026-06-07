import { expect, it } from 'vitest'
import { describe, callTool, seedKV } from '../utils'

// ── thread_tick ───────────────────────────────────────────────────────────────

describe('thread_tick', () => {
  it('returns no-entities message when no entities match the thread', async () => {
    await seedKV('character:unthreaded', '**Status:** Active\n**Timeline-Value:** 5')
    const res = await callTool('thread_tick', { thread_id: 'thread-alpha' })
    expect(res.result.content[0].text).toContain('No entities')
    expect(res.result.local_shifts).toHaveLength(0)
  })

  it('decrements Timeline-Value for all entities in the thread', async () => {
    await seedKV('character:thread-member', '**Thread:** thread-alpha\n**Timeline-Value:** 8')
    await callTool('thread_tick', { thread_id: 'thread-alpha' })
    const get = await callTool('get_lore', { query: 'character:thread-member' })
    expect(get.result.text).toContain('**Timeline-Value:** 7')
  })

  it('reports old_value and new_value in local_shifts', async () => {
    await seedKV('character:shift-check', '**Thread:** shift-thread\n**Timeline-Value:** 4')
    const res = await callTool('thread_tick', { thread_id: 'shift-thread' })
    expect(res.result.local_shifts).toHaveLength(1)
    expect(res.result.local_shifts[0].old_value).toBe(4)
    expect(res.result.local_shifts[0].new_value).toBe(3)
    expect(res.result.local_shifts[0].key).toBe('character:shift-check')
  })

  it('marks status_change=true when Timeline-Value crosses zero', async () => {
    await seedKV('character:crossing-zero', '**Thread:** cross-thread\n**Timeline-Value:** 1')
    const res = await callTool('thread_tick', { thread_id: 'cross-thread' })
    expect(res.result.local_shifts[0].status_change).toBe(true)
  })

  it('marks status_change=false when Timeline-Value stays positive', async () => {
    await seedKV('character:stays-positive', '**Thread:** positive-thread\n**Timeline-Value:** 5')
    const res = await callTool('thread_tick', { thread_id: 'positive-thread' })
    expect(res.result.local_shifts[0].status_change).toBe(false)
  })

  it('ticks multiple entities in the same thread', async () => {
    await seedKV('character:multi-a', '**Thread:** multi-thread\n**Timeline-Value:** 10')
    await seedKV('character:multi-b', '**Thread:** multi-thread\n**Timeline-Value:** 3')
    const res = await callTool('thread_tick', { thread_id: 'multi-thread' })
    expect(res.result.local_shifts).toHaveLength(2)
    expect(res.result.metadata.entities_ticked).toBe(2)
  })

  it('does not decrement entities on other threads', async () => {
    await seedKV('character:thread-a-member', '**Thread:** thread-a\n**Timeline-Value:** 5')
    await seedKV('character:thread-b-member', '**Thread:** thread-b\n**Timeline-Value:** 5')
    await callTool('thread_tick', { thread_id: 'thread-a' })
    const get = await callTool('get_lore', { query: 'character:thread-b-member' })
    expect(get.result.text).toContain('**Timeline-Value:** 5')
  })

  it('skips entities in thread that lack a Timeline-Value field', async () => {
    await seedKV('character:no-timeline', '**Thread:** skip-thread\n**Status:** Active')
    const res = await callTool('thread_tick', { thread_id: 'skip-thread' })
    expect(res.result.local_shifts).toHaveLength(0)
    expect(res.result.content[0].text).toContain('No entities')
  })

  it('pushes history for decremented entities', async () => {
    await seedKV('character:tick-hist', '**Thread:** hist-thread\n**Timeline-Value:** 3')
    await callTool('thread_tick', { thread_id: 'hist-thread' })
    const restore = await callTool('restore_lore', { key: 'character:tick-hist' })
    expect(restore.result.metadata.restored).toBe(true)
    const get = await callTool('get_lore', { query: 'character:tick-hist' })
    expect(get.result.text).toContain('**Timeline-Value:** 3')
  })

  it('populates global_snapshot with other-thread entities sharing Current-Date', async () => {
    await seedKV('character:tick-source', '**Thread:** date-thread-a\n**Timeline-Value:** 2\n**Current-Date:** 2026-05-24')
    await seedKV('character:other-thread', '**Thread:** date-thread-b\n**Current-Date:** 2026-05-24\n**Status:** Waiting')
    const res = await callTool('thread_tick', { thread_id: 'date-thread-a' })
    expect(res.result.global_snapshot).toHaveLength(1)
    expect(res.result.global_snapshot[0].key).toBe('character:other-thread')
    expect(res.result.global_snapshot[0].thread).toBe('date-thread-b')
    expect(res.result.global_snapshot[0].status).toBe('Waiting')
  })

  it('global_snapshot is empty when no shared Current-Date exists', async () => {
    await seedKV('character:isolated-tick', '**Thread:** isolated-thread\n**Timeline-Value:** 1\n**Current-Date:** 2099-01-01')
    await seedKV('character:different-date', '**Thread:** other-thread\n**Current-Date:** 2026-05-24')
    const res = await callTool('thread_tick', { thread_id: 'isolated-thread' })
    expect(res.result.global_snapshot).toHaveLength(0)
  })
})

// ── get_relationship ──────────────────────────────────────────────────────────

describe('get_relationship', () => {
  it('finds affinity field and cross-references', async () => {
    await seedKV('character:alice', '**Affinity:** 0.8\n**Faction:** guild\nBob is a trusted ally.')
    await seedKV('character:bob', '**Faction:** guild\nAlice mentored me.')
    const res = await callTool('get_relationship', { entity_a: 'character:alice', entity_b: 'character:bob' })
    expect(res.result.relationship).not.toBeNull()
    expect(res.result.relationship.affinity).toBe(0.8)
    expect(res.result.relationship.faction_overlap).toContain('guild')
    expect(res.result.relationship.cross_references.a_mentions_b).toBe(true)
    expect(res.result.relationship.cross_references.b_mentions_a).toBe(true)
    expect(res.result.metadata.retrieved).toBe(2)
  })

  it('returns null relationship and suggestion when no data found', async () => {
    await seedKV('character:stranger-a', 'No connections here.')
    await seedKV('character:stranger-b', 'Likewise.')
    const res = await callTool('get_relationship', { entity_a: 'character:stranger-a', entity_b: 'character:stranger-b' })
    expect(res.result.relationship).toBeNull()
    expect(res.result.suggestion).toContain('relationship:')
  })

  it('returns error for missing entity', async () => {
    await seedKV('character:exists', 'text')
    const res = await callTool('get_relationship', { entity_a: 'character:exists', entity_b: 'character:no-such' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

// ── get_faction_standing ──────────────────────────────────────────────────────

describe('get_faction_standing', () => {
  it('detects membership when entity name appears in faction text', async () => {
    await seedKV('character:knight', '**Rank:** Captain\n**Reputation:** 0.9\n**Faction:** order')
    await seedKV('faction:order', 'Members: knight, paladin, squire.')
    const res = await callTool('get_faction_standing', { entity_key: 'character:knight', faction_key: 'faction:order' })
    expect(res.result.standing.is_member).toBe(true)
    expect(res.result.standing.rank).toBe('Captain')
    expect(res.result.standing.reputation).toBe(0.9)
  })

  it('returns non-member when entity not in faction text', async () => {
    await seedKV('character:outsider', '**Faction:** rival-guild')
    await seedKV('faction:order', 'Members: knight only.')
    const res = await callTool('get_faction_standing', { entity_key: 'character:outsider', faction_key: 'faction:order' })
    expect(res.result.standing.is_member).toBe(false)
  })

  it('returns error for missing faction', async () => {
    await seedKV('character:x', 'text')
    const res = await callTool('get_faction_standing', { entity_key: 'character:x', faction_key: 'faction:missing' })
    expect(res.error).toBeDefined()
  })
})

// ── get_entity_knowledge ──────────────────────────────────────────────────────

describe('get_entity_knowledge', () => {
  it('returns known=true and excerpts when topic appears in text', async () => {
    await seedKV('character:spy', '**Knows:** secret-vault, patrol-routes\nI discovered the secret-vault last week.')
    const res = await callTool('get_entity_knowledge', { entity_key: 'character:spy', topic: 'secret-vault' })
    expect(res.result.known).toBe(true)
    expect(res.result.known_via_field).toBe(true)
    expect(res.result.excerpts.length).toBeGreaterThan(0)
  })

  it('returns known=false when topic is absent', async () => {
    await seedKV('character:naive', 'No special knowledge here.')
    const res = await callTool('get_entity_knowledge', { entity_key: 'character:naive', topic: 'hidden-base' })
    expect(res.result.known).toBe(false)
    expect(res.result.excerpts).toHaveLength(0)
  })
})

// ── get_location_occupants ────────────────────────────────────────────────────

describe('get_location_occupants', () => {
  it('returns entities whose Location field matches', async () => {
    await seedKV('character:guard-1', '**Location:** location:barracks\n**Status:** Active')
    await seedKV('character:guard-2', '**Location:** location:barracks\n**Status:** Sleeping')
    await seedKV('character:merchant', '**Location:** location:market')
    const res = await callTool('get_location_occupants', { location_key: 'location:barracks' })
    expect(res.result.occupants).toHaveLength(2)
    const keys = res.result.occupants.map((o: { key: string }) => o.key)
    expect(keys).toContain('character:guard-1')
    expect(keys).toContain('character:guard-2')
  })

  it('returns empty array when no matches', async () => {
    const res = await callTool('get_location_occupants', { location_key: 'location:empty-room' })
    expect(res.result.occupants).toHaveLength(0)
    expect(res.result.content[0].text).toContain('No occupants')
  })

  it('finds entities with loose plain-colon Location field', async () => {
    // AI may write "Location: chamber-x" without **bold:** — loose pass should find them
    await seedKV('character:loose-loc-1', 'Location: location:loose-chamber\nStatus: Active')
    await seedKV('character:loose-loc-2', 'Location: location:loose-chamber\nStatus: Dormant')
    const res = await callTool('get_location_occupants', { location_key: 'location:loose-chamber' })
    expect(res.result.occupants).toHaveLength(2)
  })
})

// ── get_reachable_locations ───────────────────────────────────────────────────

describe('get_reachable_locations', () => {
  it('parses Exits field and checks each destination', async () => {
    await seedKV('location:hub', '**Exits:** location:north-road, location:cave')
    await seedKV('location:north-road', '**Danger-Level:** 0.2\n**Travel-Cost:** 30')
    const res = await callTool('get_reachable_locations', { origin_key: 'location:hub' })
    expect(res.result.locations).toHaveLength(2)
    const northRoad = res.result.locations.find((l: { key: string }) => l.key === 'location:north-road')
    expect(northRoad.exists).toBe(true)
    expect(northRoad.danger_level).toBe(0.2)
    expect(northRoad.travel_cost).toBe(30)
    const cave = res.result.locations.find((l: { key: string }) => l.key === 'location:cave')
    expect(cave.exists).toBe(false)
  })

  it('returns empty locations when no Exits field', async () => {
    await seedKV('location:dead-end', 'No way out.')
    const res = await callTool('get_reachable_locations', { origin_key: 'location:dead-end' })
    expect(res.result.locations).toHaveLength(0)
  })

  it('returns error for missing origin', async () => {
    const res = await callTool('get_reachable_locations', { origin_key: 'location:nonexistent' })
    expect(res.error).toBeDefined()
  })
})

// ── sense_environment ─────────────────────────────────────────────────────────

describe('sense_environment', () => {
  it('shows all details for high-perception entity', async () => {
    await seedKV('location:cave', 'Stalactites hang overhead.\nA shimmer in the dark [hidden] marks a gem deposit.\nA growl echoes [threat] from the east.')
    await seedKV('character:eagle-eye', '**Perception:** 0.9')
    const res = await callTool('sense_environment', { location_key: 'location:cave', entity_key: 'character:eagle-eye' })
    expect(res.result.perception_score).toBe(0.9)
    expect(res.result.hidden_count).toBe(0)
  })

  it('hides [hidden] lines for low-perception entity', async () => {
    await seedKV('location:cave', 'A shimmer in the dark [hidden] marks a gem deposit.\nStone walls surround you.')
    await seedKV('character:blind-fighter', '**Perception:** 0.3')
    const res = await callTool('sense_environment', { location_key: 'location:cave', entity_key: 'character:blind-fighter' })
    expect(res.result.hidden_count).toBeGreaterThan(0)
  })
})

// ── get_thread_comparison ─────────────────────────────────────────────────────

describe('get_thread_comparison', () => {
  it('compares entity counts and timeline offsets across two threads', async () => {
    await seedKV('character:alpha-1', '**Thread:** thread-a\n**Timeline-Value:** 10\n**Current-Date:** day-5')
    await seedKV('character:alpha-2', '**Thread:** thread-a\n**Timeline-Value:** 8\n**Current-Date:** day-5')
    await seedKV('character:beta-1', '**Thread:** thread-b\n**Timeline-Value:** 5\n**Current-Date:** day-5')
    const res = await callTool('get_thread_comparison', { thread_a: 'thread-a', thread_b: 'thread-b' })
    expect(res.result.thread_a.entity_count).toBe(2)
    expect(res.result.thread_b.entity_count).toBe(1)
    expect(res.result.timeline_offset).toBeCloseTo(4, 0)
    expect(res.result.shared_dates).toContain('day-5')
  })

  it('returns empty threads when no entities found', async () => {
    const res = await callTool('get_thread_comparison', { thread_a: 'no-thread-x', thread_b: 'no-thread-y' })
    expect(res.result.thread_a.entity_count).toBe(0)
    expect(res.result.thread_b.entity_count).toBe(0)
    expect(res.result.timeline_offset).toBeNull()
  })
})

// ── check_convergence ─────────────────────────────────────────────────────────

describe('check_convergence', () => {
  it('detects convergence via shared date', async () => {
    await seedKV('character:ga', '**Thread:** ta\n**Current-Date:** day-10')
    await seedKV('character:gb', '**Thread:** tb\n**Current-Date:** day-10')
    const res = await callTool('check_convergence', { thread_a: 'ta', thread_b: 'tb' })
    expect(res.result.can_converge).toBe(true)
    expect(res.result.shared_dates).toContain('day-10')
  })

  it('returns can_converge=false when no overlap', async () => {
    await seedKV('character:xa', '**Thread:** tx\n**Current-Date:** day-1')
    await seedKV('character:xb', '**Thread:** ty\n**Current-Date:** day-99')
    const res = await callTool('check_convergence', { thread_a: 'tx', thread_b: 'ty' })
    expect(res.result.can_converge).toBe(false)
    expect(res.result.shared_dates).toHaveLength(0)
    expect(res.result.shared_locations).toHaveLength(0)
  })
})
