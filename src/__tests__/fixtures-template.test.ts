import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('canonical fixture — template:standard-subject as generate_entity archetype', () => {
  const TEMPLATE_LORE = [
    '# Template: Standard Subject Entity',
    'Type: subject-archetype',
    'Category: baseline-humanoid',
    '',
    '## Default Weights',
    'Weight-1 (Drive): 30',
    'Weight-2 (Vulnerability): 55',
    '',
    '## Default Sensory',
    'Temperature-Range: 36-38°C',
    'Scent-Profile: baseline-mammalian, variable-cortisol',
    'Sound-Signature: standard-respiration',
    'Visual-Descriptors: bipedal-humanoid, variable-pigmentation',
    '',
    '## State Machine Assignment',
    'State-Machine: standard-multi-stage-processing',
    'Current-Stage: 1',
    'Total-Stages: 4',
  ].join('\n')

  beforeEach(() => seedKV('template:standard-subject', TEMPLATE_LORE))

  it('stores and retrieves template lore verbatim', async () => {
    const res = await callTool('get_lore', { query: 'template:standard-subject' })
    expect(res.result.content[0].text).toBe(TEMPLATE_LORE)
  })

  it('generate_entity creates a new entity from the template archetype', async () => {
    const res = await callTool('generate_entity', { archetype_key: 'template:standard-subject' })
    expect(res.error).toBeUndefined()
    expect(res.result.entity_key).toMatch(/^entity:standard-subject-\d+$/)
    expect(res.result.entity_text).toContain('Weight-1')
    expect(res.result.metadata.written).toBe(1)
  })

  it('generated entity is retrievable and inherits integer weight values', async () => {
    const gen = await callTool('generate_entity', { archetype_key: 'template:standard-subject' })
    const lore = await callTool('get_lore', { query: gen.result.entity_key })
    expect(lore.error).toBeUndefined()
    expect(lore.result.text).toContain('30')
    expect(lore.result.text).toContain('55')
  })
})

