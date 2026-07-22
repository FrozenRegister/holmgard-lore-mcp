import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './support/helpers'
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
    const res = await callTool('entity_manage', { action: 'get_sensory_profile', entity_key: 'entity:sensory-canonical' })
    expect(res.error).toBeUndefined()
    expect(res.result.profile.sound_signature).toContain('elevated-respiration')
    expect(res.result.profile.visual_descriptors).toContain('lean-musculature')
  })

  it('get_sensory_profile maps Temperature-Range field to temperature profile slot', async () => {
    await seedKV('entity:temp-range-entity', [
      'Temperature-Range: 38-42°C',
      'Sound-Signature: low-frequency-resonance',
    ].join('\n'))
    const res = await callTool('entity_manage', { action: 'get_sensory_profile', entity_key: 'entity:temp-range-entity' })
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
    const res = await callTool('entity_manage', { action: 'get_sensory_profile', entity_key: 'entity:scent-profile-entity' })
    expect(res.error).toBeUndefined()
    const scent = res.result.profile.scent
    expect(scent).toBeTruthy()
    expect(scent).toContain('metabolic-heat')
  })
})

describe('species fallback with namespace prefix fix (#44)', () => {
  it('get_sensory_profile falls back to species key with namespace prefix', async () => {
    await seedKV('species:lamia', [
      'Temperature: cold-blooded',
      'Scent: musky-musk, shedding-skin',
      'Texture: scales, smooth',
    ].join('\n'))
    await seedKV('entity:zira-test', [
      'Species: lamia',
      '# Zira (test)',
    ].join('\n'))
    const res = await callTool('entity_manage', { action: 'get_sensory_profile', entity_key: 'entity:zira-test' })
    expect(res.error).toBeUndefined()
    expect(res.result.profile.temperature).toContain('cold-blooded')
    expect(res.result.profile.scent).toContain('musky-musk')
    expect(res.result.sensory_source).toContain('species:lamia')
  })

  it('get_sensory_profile returns sensory_source indicating entity-only when no species fallback', async () => {
    await seedKV('entity:standalone', [
      'Temperature: ambient',
      'Scent: none',
    ].join('\n'))
    const res = await callTool('entity_manage', { action: 'get_sensory_profile', entity_key: 'entity:standalone' })
    expect(res.error).toBeUndefined()
    expect(res.result.sensory_source).toBe('entity')
  })

  it('get_sensory_profile with already-prefixed species key (species:lamia) looks it up directly', async () => {
    await seedKV('species:lamia', [
      'Temperature: cold-blooded',
      'Scent: musky',
    ].join('\n'))
    await seedKV('entity:zira-prefixed', [
      'Species: species:lamia',
      '# Zira',
    ].join('\n'))
    const res = await callTool('entity_manage', { action: 'get_sensory_profile', entity_key: 'entity:zira-prefixed' })
    expect(res.error).toBeUndefined()
    expect(res.result.profile.temperature).toContain('cold-blooded')
    expect(res.result.sensory_source).toContain('species:lamia')
  })

  it('get_sensory_profile when species key not found still returns entity sensory data', async () => {
    await seedKV('entity:orphan-species', [
      'Species: nonexistent-species',
      'Temperature: warm',
      'Scent: unknown',
    ].join('\n'))
    const res = await callTool('entity_manage', { action: 'get_sensory_profile', entity_key: 'entity:orphan-species' })
    expect(res.error).toBeUndefined()
    expect(res.result.profile.temperature).toContain('warm')
    expect(res.result.sensory_source).toBe('entity')
  })
})
