import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MCP_API_KEY, tool, uid, setLore, deleteLore } from './helpers'

describe.skipIf(!MCP_API_KEY)('Field Extraction - Bullet + Descriptor Format', () => {
  let key: string

  beforeEach(async () => {
    key = `test:bullet-increment-${uid()}`
    await setLore(key, '- **Weight-1 (Aggression/Predator-Drive):** 0.75\n**Status:** active')
  })

  afterEach(async () => { await deleteLore(key) })

  it('increment_topic_field parses bullet+descriptor float field', async () => {
    const res = await tool('increment_topic_field', {
      key, field_path: 'Weight-1', increment: 0.1, reason: 'test',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/0\.85/)
  })

  it('increment_topic_field preserves bullet+descriptor format', async () => {
    await tool('increment_topic_field', {
      key, field_path: 'Weight-1', increment: 0.1, reason: 'test',
    })
    const res = await tool('get_lore', { query: key })
    expect(res.result.content[0].text).toMatch(/Weight-1 \(Aggression\/Predator-Drive\)/)
  })
})
