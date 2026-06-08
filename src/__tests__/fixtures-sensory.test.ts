import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('canonical fixture — sensory profile with Temperature-Range and Scent-Profile field names', () => {
  it('get_sensory_profile reads Sound-Signature and Visual-Descriptors from canonical ## Sensory Profile section', async () => {
    await seedKV('entity:sensory-canonical', [
      '## Sensory Profile',
      'Temperature-Range: 36-38°C',
      'Scent-Profile: elevated-cortisol, salt',
      'Texture-Profile: soft-tissue, minimal-callus',
      'Sound-Signature: elevated-respiration, occasional-vocalization',
      'Visual-Descriptors: lean-musculature, fair-integument',
    ].join('\n'))
    const res = await callTool('get_sensory_profile', { entity_key: 'entity:sensory-canonical' })
    expect(res.error).toBeUndefined()
    expect(res.result.profile.sound_signature).toContain('elevated-respiration')
    expect(res.result.profile.visual_descriptors).toContain('lean-musculature')
  })

  it('get_sensory_profile maps Temperature-Range field to temperature profile slot', async () => {
    await seedKV('entity:temp-range-entity', [
      'Temperature-Range: 38-42°C',
      'Sound-Signature: low-frequency-resonance',
    ].join('\n'))
    const res = await callTool('get_sensory_profile', { entity_key: 'entity:temp-range-entity' })
    expect(res.error).toBeUndefined()
    const temp = res.result.profile.temperature
    expect(temp).toBeTruthy()
    expect(temp).toContain('38')
  })

  it('get_sensory_profile maps Scent-Profile field to scent profile slot', async () => {
    await seedKV('entity:scent-profile-entity', [
      'Scent-Profile: metabolic-heat, copper, enzymatic-secretion',
      'Sound-Signature: low-resonance',
    ].join('\n'))
    const res = await callTool('get_sensory_profile', { entity_key: 'entity:scent-profile-entity' })
    expect(res.error).toBeUndefined()
    const scent = res.result.profile.scent
    expect(scent).toBeTruthy()
    expect(scent).toContain('metabolic-heat')
  })
})

