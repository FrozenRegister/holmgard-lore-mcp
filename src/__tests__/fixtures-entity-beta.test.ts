import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('canonical fixture — entity:subject-beta (Stage-3-of-4, modified-consciousness)', () => {
  const BETA_LORE = [
    '# Entity: Subject Beta',
    'Alias: Beta',
    'Age: 26',
    'Gender: Female',
    'Status: Stage-3-of-4, Modified-Consciousness',
    'Location: processing-chamber-secondary',
    '',
    '## Weights',
    'Weight-1 (Drive): 10',
    'Weight-2 (Vulnerability): 75',
    '',
    '## State Machine',
    'State-Machine: standard-multi-stage-processing',
    'Current-Stage: 3',
    'Total-Stages: 4',
    'Stage-Names: [preparation, engagement, processing, integration]',
    'Timeline-Value: 48',
    'Timeline-Unit: hours',
    'Thread: secondary-processing-cycle',
    '',
    '## Relationships',
    'Relationships:',
    '- target: entity:subject-alpha',
    '  type: bonded-pair',
    '  affinity: 90',
    '  status: separated-unaware',
    '- target: entity:actor-primary',
    '  type: processor-subject',
    '  affinity: 70',
    '  status: bonded-processing',
  ].join('\n')

  beforeEach(() => seedKV('entity:subject-beta', BETA_LORE))

  it('stores and retrieves full canonical lore verbatim', async () => {
    const res = await callTool('lore_manage', { action: 'get', query: 'entity:subject-beta' })
    expect(res.result.content[0].text).toBe(BETA_LORE)
  })

  it('advance_state_stage reads Stage-3-of-4 from Status and advances to Stage-4-of-4 (terminal)', async () => {
    const res = await callTool('entity_manage', { action: 'advance_stage', entity_key: 'entity:subject-beta' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.old_stage).toBe(3)
    expect(res.result.new_stage).toBe(4)
    expect(res.result.total_stages).toBe(4)
    expect(res.result.is_terminal).toBe(true)
    const lore = await callTool('lore_manage', { action: 'get', query: 'entity:subject-beta' })
    expect(lore.result.text).toContain('Stage-4-of-4')
  })

  it('resolve_interaction: diminished Weight-1:10 yields very low probability (~0.04)', async () => {
    await seedKV('entity:passive-target', 'Weight-2: 20')
    const res = await callTool('entity_manage', {
      action: 'resolve_interaction',
      entity_a_id: 'entity:subject-beta',
      entity_b_id: 'entity:passive-target',
      action_type: 'resist',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1_raw).toBe(10)
    expect(res.result.metadata.weight_1).toBeCloseTo(0.10, 5)
    // P = (0.10 * 0.7) - (0.20 * 0.3) = 0.07 - 0.06 = 0.01
    expect(res.result.metadata.probability).toBeCloseTo(0.01, 3)
  })

  it('thread_tick on secondary-processing-cycle decrements subject-beta Timeline-Value', async () => {
    const res = await callTool('world_manage', { action: 'thread_tick', thread_id: 'secondary-processing-cycle' })
    expect(res.result.metadata.entities_ticked).toBe(1)
    const lore = await callTool('lore_manage', { action: 'get', query: 'entity:subject-beta' })
    expect(lore.result.text).toContain('Timeline-Value: 47')
  })
})
