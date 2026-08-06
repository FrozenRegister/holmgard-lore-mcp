import {
  describe,
  rpc,
  callTool,
  callToolWithApiKey,
  seedKV,
  ADMIN_SECRET,
  parseEncounterTable,
} from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('canonical fixture — thread comparison: primary vs secondary processing cycle', () => {
  beforeEach(async () => {
    await seedKV(
      'entity:subject-alpha',
      [
        '# Entity: Subject Alpha',
        'Status: Active, Stage-2-of-4',
        'Thread: primary-processing-cycle',
        'Timeline-Value: 12',
        'Current-Date: cycle-day-1',
      ].join('\n'),
    )
    await seedKV(
      'entity:subject-beta',
      [
        '# Entity: Subject Beta',
        'Status: Stage-3-of-4, Modified-Consciousness',
        'Thread: secondary-processing-cycle',
        'Timeline-Value: 48',
        'Current-Date: cycle-day-3',
      ].join('\n'),
    )
  })

  it('get_thread_comparison reports one entity per thread and correct timeline offset', async () => {
    const res = await callTool('world_manage', {
      action: 'get_thread_comparison',
      thread_a: 'primary-processing-cycle',
      thread_b: 'secondary-processing-cycle',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.thread_a.entity_count).toBe(1)
    expect(res.result.thread_b.entity_count).toBe(1)
    // avg(12) vs avg(48) → offset = 36
    expect(res.result.timeline_offset).toBeCloseTo(36, 0)
  })

  it('check_convergence returns can_converge=false when threads share no Current-Date', async () => {
    const res = await callTool('world_manage', {
      action: 'check_convergence',
      thread_a: 'primary-processing-cycle',
      thread_b: 'secondary-processing-cycle',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.can_converge).toBe(false)
    expect(res.result.shared_dates).toHaveLength(0)
  })

  it('check_convergence returns can_converge=true when threads share a Current-Date', async () => {
    await seedKV(
      'entity:subject-alpha',
      [
        'Thread: primary-processing-cycle',
        'Timeline-Value: 12',
        'Current-Date: convergence-point',
      ].join('\n'),
    )
    await seedKV(
      'entity:subject-beta',
      [
        'Thread: secondary-processing-cycle',
        'Timeline-Value: 48',
        'Current-Date: convergence-point',
      ].join('\n'),
    )
    const res = await callTool('world_manage', {
      action: 'check_convergence',
      thread_a: 'primary-processing-cycle',
      thread_b: 'secondary-processing-cycle',
    })
    expect(res.result.can_converge).toBe(true)
    expect(res.result.shared_dates).toContain('convergence-point')
  })

  it('get_thread_comparison handles multiple entities in same thread', async () => {
    await seedKV(
      'entity:subject-alpha-2',
      [
        'Thread: primary-processing-cycle',
        'Timeline-Value: 15',
        'Current-Date: cycle-day-1',
      ].join('\n'),
    )
    // Now primary-processing-cycle has 2 entities
    const res = await callTool('world_manage', {
      action: 'get_thread_comparison',
      thread_a: 'primary-processing-cycle',
      thread_b: 'secondary-processing-cycle',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.thread_a.entity_count).toBe(2)
    // avg of 12 and 15 = 13.5
    expect(res.result.thread_a.avg_timeline).toBeCloseTo(13.5, 1)
  })

  it('get_thread_comparison handles threads with no Timeline-Value', async () => {
    await seedKV(
      'entity:subject-no-timeline',
      [
        'Thread: timeline-less',
        'Current-Date: some-date',
        'Status: Active',
      ].join('\n'),
    )
    await seedKV(
      'entity:other-thread-entity',
      [
        'Thread: other-thread',
        'Timeline-Value: 20',
        'Current-Date: some-date',
      ].join('\n'),
    )
    const res = await callTool('world_manage', {
      action: 'get_thread_comparison',
      thread_a: 'timeline-less',
      thread_b: 'other-thread',
    })
    expect(res.error).toBeUndefined()
    // timeline-less thread has no Timeline-Value, so avg_timeline should be null
    expect(res.result.thread_a.avg_timeline).toBeNull()
    expect(res.result.thread_b.avg_timeline).toBeCloseTo(20, 0)
  })

  it('get_thread_comparison reports shared dates and locations', async () => {
    await seedKV(
      'entity:alpha-shared-location',
      [
        'Thread: thread-a',
        'Timeline-Value: 5',
        'Current-Date: shared-date-1',
        'Location: location:throne-room',
      ].join('\n'),
    )
    await seedKV(
      'entity:beta-shared-location',
      [
        'Thread: thread-b',
        'Timeline-Value: 10',
        'Current-Date: shared-date-1',
        'Location: location:throne-room',
      ].join('\n'),
    )
    const res = await callTool('world_manage', {
      action: 'get_thread_comparison',
      thread_a: 'thread-a',
      thread_b: 'thread-b',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.shared_dates).toContain('shared-date-1')
    expect(res.result.shared_locations).toContain('location:throne-room')
  })

  it('check_convergence with shared locations but no shared dates', async () => {
    await seedKV(
      'entity:shared-loc-a',
      [
        'Thread: thread-loc-a',
        'Current-Date: date-a-only',
        'Location: location:common-room',
      ].join('\n'),
    )
    await seedKV(
      'entity:shared-loc-b',
      [
        'Thread: thread-loc-b',
        'Current-Date: date-b-only',
        'Location: location:common-room',
      ].join('\n'),
    )
    const res = await callTool('world_manage', {
      action: 'check_convergence',
      thread_a: 'thread-loc-a',
      thread_b: 'thread-loc-b',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.can_converge).toBe(true)
    expect(res.result.shared_locations).toContain('location:common-room')
    expect(res.result.shared_dates).toHaveLength(0)
  })

  it('check_convergence trims whitespace from thread names', async () => {
    const res = await callTool('world_manage', {
      action: 'check_convergence',
      thread_a: '  primary-processing-cycle  ',
      thread_b: '  secondary-processing-cycle  ',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.thread_a).toBe('primary-processing-cycle')
    expect(res.result.thread_b).toBe('secondary-processing-cycle')
  })

  it('get_thread_comparison returns empty thread info for nonexistent thread', async () => {
    const res = await callTool('world_manage', {
      action: 'get_thread_comparison',
      thread_a: 'nonexistent-thread-1',
      thread_b: 'nonexistent-thread-2',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.thread_a.entity_count).toBe(0)
    expect(res.result.thread_b.entity_count).toBe(0)
    expect(res.result.thread_a.avg_timeline).toBeNull()
    expect(res.result.thread_b.avg_timeline).toBeNull()
  })
})
