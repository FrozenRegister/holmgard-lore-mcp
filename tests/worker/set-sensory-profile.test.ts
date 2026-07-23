import { describe, rpc, callTool, seedKV } from './support/helpers'
import { expect, it } from 'vitest'

describe('set_sensory_profile', () => {
  it('writes individual sensory fields to an entity', async () => {
    await seedKV(
      'character:test-subject',
      '**Name:** Test Subject\n**Location:** location:test-room',
    )
    const res = await callTool('entity_manage', {
      action: 'set_sensory_profile',
      entity_key: 'character:test-subject',
      temperature: 'warm, 37°C',
      scent: 'moss and iron',
      texture: 'soft, yielding',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.fields_written).toContain('Temperature')
    expect(res.result.metadata.fields_written).toContain('Scent')
    expect(res.result.metadata.fields_written).toContain('Texture')
    expect(res.result.metadata.version).toBe(2)
  })

  it('writes composite Sensory-Profile field', async () => {
    await seedKV('entity:composite-test', '**Name:** Composite Test')
    const res = await callTool('entity_manage', {
      action: 'set_sensory_profile',
      entity_key: 'entity:composite-test',
      composite: 'warm-blooded, metallic, soft-tissue',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.fields_written).toContain('Sensory-Profile')
  })

  it('writes all sensory fields including sound and visual', async () => {
    await seedKV('character:full-profile', '**Name:** Full Profile')
    const res = await callTool('entity_manage', {
      action: 'set_sensory_profile',
      entity_key: 'character:full-profile',
      temperature: 'elevated, 38.5°C',
      scent: 'copper, sweat, ozone',
      texture: 'rough, callused',
      sound_signature: 'heavy breathing, metallic clink',
      visual_descriptors: 'lean, scarred, tense',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.fields_written).toHaveLength(5)
    expect(res.result.metadata.fields_written).toContain('Sound-Signature')
    expect(res.result.metadata.fields_written).toContain('Visual-Descriptors')
  })

  it('set_sensory_profile then get_sensory_profile round-trips correctly', async () => {
    await seedKV('character:roundtrip', '**Name:** Roundtrip Test')
    await callTool('entity_manage', {
      action: 'set_sensory_profile',
      entity_key: 'character:roundtrip',
      temperature: 'hot, 42°C',
      scent: 'sulfur and ash',
    })
    const getRes = await callTool('entity_manage', {
      action: 'get_sensory_profile',
      entity_key: 'character:roundtrip',
    })
    expect(getRes.error).toBeUndefined()
    expect(getRes.result.profile.temperature).toContain('42°C')
    expect(getRes.result.profile.scent).toContain('sulfur')
  })

  it('rejects missing entity', async () => {
    const res = await callTool('entity_manage', {
      action: 'set_sensory_profile',
      entity_key: 'character:nonexistent',
      temperature: 'warm',
    })
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('not found')
  })

  it('rejects when no sensory fields provided', async () => {
    await seedKV('character:empty-profile', '**Name:** Empty')
    const res = await callTool('entity_manage', {
      action: 'set_sensory_profile',
      entity_key: 'character:empty-profile',
    })
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('No sensory profile fields provided')
  })

  it('updates existing sensory fields', async () => {
    await seedKV('character:updatable', '**Name:** Updatable\n**Temperature:** cold')
    const res = await callTool('entity_manage', {
      action: 'set_sensory_profile',
      entity_key: 'character:updatable',
      temperature: 'warm',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.fields_written).toContain('Temperature')
    const getRes = await callTool('entity_manage', {
      action: 'get_sensory_profile',
      entity_key: 'character:updatable',
    })
    expect(getRes.result.profile.temperature).toContain('warm')
  })
})
