import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('canonical fixture — entity:subject-alpha (active Stage-2-of-4)', () => {
  const ALPHA_LORE = [
    '# Entity: Subject Alpha',
    'Alias: Alpha',
    'Age: 24',
    'Gender: Female',
    'Status: Active, Stage-2-of-4',
    'Location: processing-chamber-primary',
    '',
    '## Weights',
    'Weight-1 (Drive): 30',
    'Weight-2 (Vulnerability): 55',
    '',
    '## Sensory Profile',
    'Temperature-Range: 36-38°C',
    'Scent-Profile: elevated-cortisol, salt, botanical-residue',
    'Texture-Profile: soft-tissue, minimal-callus, healed-scar-tissue-left-shoulder',
    'Sound-Signature: elevated-respiration, occasional-vocalization-distress',
    'Visual-Descriptors: lean-musculature, fair-integument, copper-cranial-filament',
    '',
    '## State Machine',
    'State-Machine: standard-multi-stage-processing',
    'Current-Stage: 2',
    'Total-Stages: 4',
    'Stage-Names: [preparation, engagement, processing, integration]',
    'Timeline-Value: 12',
    'Timeline-Unit: hours',
    'Thread: primary-processing-cycle',
    '',
    '## Inventory',
    'Inventory:',
    '- item: provision-pack-dried',
    '  quantity: 1',
    '  condition: partial',
    '- item: ornamental-blade',
    '  quantity: 1',
    '  condition: display-only',
    '- item: botanical-sachet',
    '  quantity: 2',
    '  condition: intact',
    '',
    '## Relationships',
    'Relationships:',
    '- target: entity:subject-beta',
    '  type: bonded-pair',
    '  affinity: 85',
    '  status: separated',
    '- target: faction:traveling-performers',
    '  type: member',
    '  rank: junior',
    '  standing: good',
    '',
    '## Skills',
    'Tracking: 0.2',
    'Negotiation: 0.4',
    'Physical-Resistance: 0.3',
    'Perception: 0.5',
  ].join('\n')

  beforeEach(() => seedKV('entity:subject-alpha', ALPHA_LORE))

  it('stores and retrieves full canonical lore verbatim', async () => {
    const res = await callTool('lore_manage', { action: 'get', query: 'entity:subject-alpha' })
    expect(res.result.content[0].text).toBe(ALPHA_LORE)
  })

  it('advance_state_stage reads embedded Stage-2-of-4 in Status and advances to Stage-3-of-4', async () => {
    const res = await callTool('entity_manage', { action: 'advance_stage', entity_key: 'entity:subject-alpha' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.old_stage).toBe(2)
    expect(res.result.new_stage).toBe(3)
    expect(res.result.total_stages).toBe(4)
    expect(res.result.is_terminal).toBe(false)
    const lore = await callTool('lore_manage', { action: 'get', query: 'entity:subject-alpha' })
    expect(lore.result.text).toContain('Stage-3-of-4')
    expect(lore.result.text).not.toContain('Stage-2-of-4')
  })

  it('resolve_interaction normalizes integer Weight-1:85/Weight-2:55 from ## Weights section', async () => {
    await seedKV('entity:actor-stub', [
      '## Weights',
      'Weight-1 (Drive): 85',
      'Weight-2 (Vulnerability): 10',
      'State-Level: 0',
    ].join('\n'))
    const res = await callTool('entity_manage', {
      action: 'resolve_interaction',
      entity_a_id: 'entity:actor-stub',
      entity_b_id: 'entity:subject-alpha',
      action_type: 'process',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1_raw).toBe(85)
    expect(res.result.metadata.weight_2_raw).toBe(55)
    expect(res.result.metadata.weight_1).toBeCloseTo(0.85, 5)
    expect(res.result.metadata.weight_2).toBeCloseTo(0.55, 5)
    // P = (0.85 * 0.7) - (0.55 * 0.3) = 0.595 - 0.165 = 0.43
    expect(res.result.metadata.probability).toBeCloseTo(0.43, 3)
  })

  it('thread_tick finds entity:subject-alpha via Thread field in ## State Machine section', async () => {
    const res = await callTool('world_manage', { action: 'thread_tick', thread_id: 'primary-processing-cycle' })
    expect(res.result.metadata.entities_ticked).toBe(1)
    const lore = await callTool('lore_manage', { action: 'get', query: 'entity:subject-alpha' })
    expect(lore.result.text).toContain('Timeline-Value: 11')
  })

  it('get_sensory_profile reads Sound-Signature and Visual-Descriptors from canonical section', async () => {
    const res = await callTool('entity_manage', { action: 'get_sensory_profile', entity_key: 'entity:subject-alpha' })
    expect(res.error).toBeUndefined()
    expect(res.result.profile.sound_signature).toContain('elevated-respiration')
    expect(res.result.profile.visual_descriptors).toContain('lean-musculature')
  })

  it('search_lore finds entity:subject-alpha by stage string', async () => {
    const res = await callTool('lore_manage', { action: 'search', query: 'Stage-2-of-4' })
    expect(res.result.metadata.match_count).toBeGreaterThan(0)
    const keys = res.result.results.map((r: { key: string }) => r.key)
    expect(keys).toContain('entity:subject-alpha')
  })
})
