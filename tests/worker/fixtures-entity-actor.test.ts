import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('canonical fixture — entity:actor-primary (predator/driver, Weight-1:85)', () => {
  const ACTOR_LORE = [
    '# Entity: Actor Primary',
    'Alias: The Director',
    'Age: Unknown',
    'Gender: Female',
    'Status: Active, Processing',
    'Location: processing-chamber-primary',
    '',
    '## Weights',
    'Weight-1 (Drive): 85',
    'Weight-2 (Vulnerability): 10',
    '',
    '## Sensory Profile',
    'Temperature-Range: 38-42°C',
    'Scent-Profile: metabolic-heat, copper, enzymatic-secretion',
    'Texture-Profile: dense-musculature, smooth-integument, thermal-radiance',
    'Sound-Signature: low-frequency-resonance, rhythmic-internal-movement',
    'Visual-Descriptors: significant-scale, bioluminescent-markings, predator-morphology',
    '',
    '## State Machine',
    'State-Machine: sustained-processing',
    'Current-Stage: 2',
    'Total-Stages: 3',
    'Stage-Names: [acquisition, processing, integration]',
    'Timeline-Value: 8',
    'Timeline-Unit: hours',
    'Thread: primary-processing-cycle',
    '',
    '## Faction',
    'Faction: processing-guild',
    'Rank: director',
    'Specialization: multi-stage-processing',
    '',
    '## Skills',
    'Processing-Efficiency: 0.9',
    'Sensory-Acuity: 0.85',
    'Output-Optimization: 0.8',
    'Patience: 0.3',
  ].join('\n')

  beforeEach(() => seedKV('entity:actor-primary', ACTOR_LORE))

  it('stores and retrieves full canonical lore verbatim', async () => {
    const res = await callTool('lore_manage', { action: 'get', query: 'entity:actor-primary' })
    expect(res.result.content[0].text).toBe(ACTOR_LORE)
  })

  it('analyze_utility entity_role=actor uses Weight-1:85 (normalizes to 0.85)', async () => {
    const res = await callTool('entity_manage', {
      action: 'analyze_utility',
      entity_id: 'entity:actor-primary',
      utility_vector: 'GASTRIC',
      entity_role: 'actor',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.entity_role).toBe('actor')
    const w1Entry = res.result.breakdown.find((b: any) => /Weight-1/i.test(b.field))
    if (w1Entry) {
      expect(w1Entry.raw_value).toBe(85)
      expect(w1Entry.effective_value).toBeCloseTo(0.85, 2)
    }
  })

  it('thread_tick on primary-processing-cycle decrements actor Timeline-Value', async () => {
    const res = await callTool('world_manage', { action: 'thread_tick', thread_id: 'primary-processing-cycle' })
    expect(res.result.metadata.entities_ticked).toBe(1)
    const lore = await callTool('lore_manage', { action: 'get', query: 'entity:actor-primary' })
    expect(lore.result.text).toContain('Timeline-Value: 7')
  })

  it('thread_tick ticks both actor and subject when both share the same thread', async () => {
    await seedKV('entity:subject-alpha', [
      'Status: Active, Stage-2-of-4',
      'Thread: primary-processing-cycle',
      'Timeline-Value: 12',
    ].join('\n'))
    const res = await callTool('world_manage', { action: 'thread_tick', thread_id: 'primary-processing-cycle' })
    expect(res.result.metadata.entities_ticked).toBe(2)
  })
})
