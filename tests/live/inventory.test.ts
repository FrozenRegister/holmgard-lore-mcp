import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MCP_API_KEY, tool, uid, setLore, deleteLore } from './helpers'

describe.skipIf(!MCP_API_KEY)('Inventory Transfer', () => {
  let fromKey: string, toKey: string

  beforeEach(async () => {
    fromKey = `test:xfer-from-${uid()}`
    toKey = `test:xfer-to-${uid()}`
    await Promise.all([
      setLore(fromKey, '**Inventory:** sword:2, gold:50'),
      setLore(toKey, '**Inventory:** gold:10'),
    ])
  })

  afterEach(async () => { await deleteLore(fromKey, toKey) })

  it('transfer_item moves item and updates both entities', async () => {
    const res = await tool('entity_manage', {
      action: 'transfer_item',
      from_entity: fromKey, to_entity: toKey, item_key: 'sword', quantity: 1,
    })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/Transferred 1/)
  })

  it('transfer_item rejects missing item', async () => {
    const res = await tool('entity_manage', {
      action: 'transfer_item',
      from_entity: toKey, to_entity: fromKey, item_key: 'magic-staff',
    })
    expect(res.result.content[0].text).toMatch(/not found/)
  })
})
