import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('canonical fixture — scene:threshold-discovery (YAML choice tree)', () => {
  const SCENE_LORE = [
    '# Scene: Threshold Discovery',
    'Thread: primary-processing-cycle',
    'Location: location:processing-chamber-primary',
    'Status: active',
    '',
    '## Scene State',
    'Active-Entity: entity:subject-alpha',
    'Environmental-Conditions: low-light, organic-decay-scent, distant-rhythmic-sound',
    'Time: night, approximately 11pm',
    '',
    '## Choices',
    'Choices:',
    '- id: investigate-sound',
    '  label: "Follow the rhythmic sound deeper into the chamber"',
    '  requirements: perception: 0.3',
    '',
    '- id: search-perimeter',
    '  label: "Search the chamber perimeter for tracks or traces"',
    '  requirements: tracking: 0.2',
    '',
    '- id: call-out',
    '  label: "Call out into the darkness"',
    '  requirements: none',
    '',
    '- id: retreat',
    '  label: "Withdraw and find another approach"',
    '  requirements: none',
    '',
    '## Scene Flags',
    'first-visit: true',
    'evidence-collected: false',
    'actor-alerted: false',
  ].join('\n')

  beforeEach(() => seedKV('scene:threshold-discovery', SCENE_LORE))

  it('stores and retrieves full canonical scene lore verbatim', async () => {
    const res = await callTool('get_lore', { query: 'scene:threshold-discovery' })
    expect(res.result.content[0].text).toBe(SCENE_LORE)
  })

  it('activate_scene loads scene and returns all four choice IDs', async () => {
    const res = await callTool('activate_scene', { scene_key: 'scene:threshold-discovery' })
    expect(res.error).toBeUndefined()
    expect(res.result.scene_key).toBe('scene:threshold-discovery')
    const choices = res.result.available_choices as string[]
    expect(choices).toContain('investigate-sound')
    expect(choices).toContain('search-perimeter')
    expect(choices).toContain('call-out')
    expect(choices).toContain('retreat')
  })
})

