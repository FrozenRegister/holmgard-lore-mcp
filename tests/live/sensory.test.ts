import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MCP_API_KEY, tool, uid, setLore, deleteLore } from './helpers'

describe.skipIf(!MCP_API_KEY)('Sensory Profile', () => {
  let key: string

  beforeEach(async () => {
    key = `test:sensory-${uid()}`
    await setLore(
      key,
      [
        '**Temperature:** warm',
        '**Scent:** earthy',
        '**Texture:** smooth',
        '**Sound-Signature:** low hum',
        '**Visual-Descriptors:** amber glow',
      ].join('\n'),
    )
  })

  afterEach(async () => {
    await deleteLore(key)
  })

  it('get_sensory_profile returns all five sensory fields', async () => {
    const res = await tool('entity_manage', { action: 'get_sensory_profile', entity_key: key })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/warm/)
  })

  it('get_sensory_profile returns error for missing entity', async () => {
    const res = await tool('entity_manage', {
      action: 'get_sensory_profile',
      entity_key: 'character:no-body',
    })
    expect(res.error).toBeTruthy()
  })
})
