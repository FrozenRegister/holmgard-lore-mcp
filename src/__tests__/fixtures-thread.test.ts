import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('canonical fixture — thread comparison: primary vs secondary processing cycle', () => {
  beforeEach(async () => {
    await seedKV('entity:subject-alpha', [
      '# Entity: Subject Alpha',
      'Status: Active, Stage-2-of-4',
      'Thread: primary-processing-cycle',
      'Timeline-Value: 12',
      'Current-Date: cycle-day-1',
    ].join('\n'))
    await seedKV('entity:subject-beta', [
      '# Entity: Subject Beta',
      'Status: Stage-3-of-4, Modified-Consciousness',
      'Thread: secondary-processing-cycle',
      'Timeline-Value: 48',
      'Current-Date: cycle-day-3',
    ].join('\n'))
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
    await seedKV('entity:subject-alpha', [
      'Thread: primary-processing-cycle',
      'Timeline-Value: 12',
      'Current-Date: convergence-point',
    ].join('\n'))
    await seedKV('entity:subject-beta', [
      'Thread: secondary-processing-cycle',
      'Timeline-Value: 48',
      'Current-Date: convergence-point',
    ].join('\n'))
    const res = await callTool('world_manage', {
      action: 'check_convergence',
      thread_a: 'primary-processing-cycle',
      thread_b: 'secondary-processing-cycle',
    })
    expect(res.result.can_converge).toBe(true)
    expect(res.result.shared_dates).toContain('convergence-point')
  })
})
