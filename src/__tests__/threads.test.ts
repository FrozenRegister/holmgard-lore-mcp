import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('thread_tick', () => {
  it('returns no-entities message when no entities match the thread', async () => {
    await seedKV('character:unthreaded', '**Status:** Active\n**Timeline-Value:** 5')
    const res = await callTool('world_manage', { action: 'thread_tick', thread_id: 'thread-alpha' })
    expect(res.result.content[0].text).toContain('No entities')
    expect(res.result.local_shifts).toHaveLength(0)
  })

  it('decrements Timeline-Value for all entities in the thread', async () => {
    await seedKV('character:thread-member', '**Thread:** thread-alpha\n**Timeline-Value:** 8')
    await callTool('world_manage', { action: 'thread_tick', thread_id: 'thread-alpha' })
    const get = await callTool('lore_manage', { action: 'get', query: 'character:thread-member' })
    expect(get.result.text).toContain('**Timeline-Value:** 7')
  })

  it('reports old_value and new_value in local_shifts', async () => {
    await seedKV('character:shift-check', '**Thread:** shift-thread\n**Timeline-Value:** 4')
    const res = await callTool('world_manage', { action: 'thread_tick', thread_id: 'shift-thread' })
    expect(res.result.local_shifts).toHaveLength(1)
    expect(res.result.local_shifts[0].old_value).toBe(4)
    expect(res.result.local_shifts[0].new_value).toBe(3)
    expect(res.result.local_shifts[0].key).toBe('character:shift-check')
  })

  it('marks status_change=true when Timeline-Value crosses zero', async () => {
    await seedKV('character:crossing-zero', '**Thread:** cross-thread\n**Timeline-Value:** 1')
    const res = await callTool('world_manage', { action: 'thread_tick', thread_id: 'cross-thread' })
    expect(res.result.local_shifts[0].status_change).toBe(true)
  })

  it('marks status_change=false when Timeline-Value stays positive', async () => {
    await seedKV('character:stays-positive', '**Thread:** positive-thread\n**Timeline-Value:** 5')
    const res = await callTool('world_manage', { action: 'thread_tick', thread_id: 'positive-thread' })
    expect(res.result.local_shifts[0].status_change).toBe(false)
  })

  it('ticks multiple entities in the same thread', async () => {
    await seedKV('character:multi-a', '**Thread:** multi-thread\n**Timeline-Value:** 10')
    await seedKV('character:multi-b', '**Thread:** multi-thread\n**Timeline-Value:** 3')
    const res = await callTool('world_manage', { action: 'thread_tick', thread_id: 'multi-thread' })
    expect(res.result.local_shifts).toHaveLength(2)
    expect(res.result.metadata.entities_ticked).toBe(2)
  })

  it('does not decrement entities on other threads', async () => {
    await seedKV('character:thread-a-member', '**Thread:** thread-a\n**Timeline-Value:** 5')
    await seedKV('character:thread-b-member', '**Thread:** thread-b\n**Timeline-Value:** 5')
    await callTool('world_manage', { action: 'thread_tick', thread_id: 'thread-a' })
    const get = await callTool('lore_manage', { action: 'get', query: 'character:thread-b-member' })
    expect(get.result.text).toContain('**Timeline-Value:** 5')
  })

  it('skips entities in thread that lack a Timeline-Value field', async () => {
    await seedKV('character:no-timeline', '**Thread:** skip-thread\n**Status:** Active')
    const res = await callTool('world_manage', { action: 'thread_tick', thread_id: 'skip-thread' })
    expect(res.result.local_shifts).toHaveLength(0)
    expect(res.result.content[0].text).toContain('No entities')
  })

  it('pushes history for decremented entities', async () => {
    await seedKV('character:tick-hist', '**Thread:** hist-thread\n**Timeline-Value:** 3')
    await callTool('world_manage', { action: 'thread_tick', thread_id: 'hist-thread' })
    const restore = await callTool('lore_manage', { action: 'restore', key: 'character:tick-hist' })
    expect(restore.result.metadata.restored).toBe(true)
    const get = await callTool('lore_manage', { action: 'get', query: 'character:tick-hist' })
    expect(get.result.text).toContain('**Timeline-Value:** 3')
  })

  it('populates global_snapshot with other-thread entities sharing Current-Date', async () => {
    await seedKV('character:tick-source', '**Thread:** date-thread-a\n**Timeline-Value:** 2\n**Current-Date:** 2026-05-24')
    await seedKV('character:other-thread', '**Thread:** date-thread-b\n**Current-Date:** 2026-05-24\n**Status:** Waiting')
    const res = await callTool('world_manage', { action: 'thread_tick', thread_id: 'date-thread-a' })
    expect(res.result.global_snapshot).toHaveLength(1)
    expect(res.result.global_snapshot[0].key).toBe('character:other-thread')
    expect(res.result.global_snapshot[0].thread).toBe('date-thread-b')
    expect(res.result.global_snapshot[0].status).toBe('Waiting')
  })

  it('global_snapshot is empty when no shared Current-Date exists', async () => {
    await seedKV('character:isolated-tick', '**Thread:** isolated-thread\n**Timeline-Value:** 1\n**Current-Date:** 2099-01-01')
    await seedKV('character:different-date', '**Thread:** other-thread\n**Current-Date:** 2026-05-24')
    const res = await callTool('world_manage', { action: 'thread_tick', thread_id: 'isolated-thread' })
    expect(res.result.global_snapshot).toHaveLength(0)
  })
})

describe('get_thread_comparison', () => {
  it('compares entity counts and timeline offsets across two threads', async () => {
    await seedKV('character:alpha-1', '**Thread:** thread-a\n**Timeline-Value:** 10\n**Current-Date:** day-5')
    await seedKV('character:alpha-2', '**Thread:** thread-a\n**Timeline-Value:** 8\n**Current-Date:** day-5')
    await seedKV('character:beta-1', '**Thread:** thread-b\n**Timeline-Value:** 5\n**Current-Date:** day-5')
    const res = await callTool('world_manage', { action: 'get_thread_comparison', thread_a: 'thread-a', thread_b: 'thread-b' })
    expect(res.result.thread_a.entity_count).toBe(2)
    expect(res.result.thread_b.entity_count).toBe(1)
    expect(res.result.timeline_offset).toBeCloseTo(4, 0)
    expect(res.result.shared_dates).toContain('day-5')
  })

  it('returns empty threads when no entities found', async () => {
    const res = await callTool('world_manage', { action: 'get_thread_comparison', thread_a: 'no-thread-x', thread_b: 'no-thread-y' })
    expect(res.result.thread_a.entity_count).toBe(0)
    expect(res.result.thread_b.entity_count).toBe(0)
    expect(res.result.timeline_offset).toBeNull()
  })
})

describe('check_convergence', () => {
  it('detects convergence via shared date', async () => {
    await seedKV('character:ga', '**Thread:** ta\n**Current-Date:** day-10')
    await seedKV('character:gb', '**Thread:** tb\n**Current-Date:** day-10')
    const res = await callTool('world_manage', { action: 'check_convergence', thread_a: 'ta', thread_b: 'tb' })
    expect(res.result.can_converge).toBe(true)
    expect(res.result.shared_dates).toContain('day-10')
  })

  it('returns can_converge=false when no overlap', async () => {
    await seedKV('character:xa', '**Thread:** tx\n**Current-Date:** day-1')
    await seedKV('character:xb', '**Thread:** ty\n**Current-Date:** day-99')
    const res = await callTool('world_manage', { action: 'check_convergence', thread_a: 'tx', thread_b: 'ty' })
    expect(res.result.can_converge).toBe(false)
    expect(res.result.shared_dates).toHaveLength(0)
    expect(res.result.shared_locations).toHaveLength(0)
  })
})
