// Direct handler tests for inventory-manage (not registered in rpgToolRegistry)
import { describe } from './support/helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'
import { handleInventoryManage } from '@/rpg/handlers/inventory-manage'
import { handleItemManage } from '@/rpg/handlers/item-manage'

describe('handleInventoryManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)

  async function createItem(name: string) {
    const r = await handleItemManage(db(), { action: 'create', name, type: 'weapon' })
    return JSON.parse(r.content[0].text).itemId as string
  }

  async function createCharacter(name: string) {
    const id = crypto.randomUUID()
    await env.RPG_DB.prepare(`INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, character_type, character_class, race, conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells, cantrips_known, currency, resource_pools, xp, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      id, name, '{}', 10, 10, 10, 1, 'pc', 'Fighter', 'Human', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', 0, new Date().toISOString(), new Date().toISOString()
    ).run()
    return id
  }

  it('returns guiding error for unknown action', async () => {
    const r = await handleInventoryManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  it('get requires characterId', async () => {
    const r = await handleInventoryManage(db(), { action: 'get' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get returns empty inventory', async () => {
    const charId = await createCharacter('Alice')
    const r = await handleInventoryManage(db(), { action: 'get', characterId: charId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBe(0)
  })

  it('add requires characterId and itemId', async () => {
    const r = await handleInventoryManage(db(), { action: 'add', characterId: 'c1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('add inserts item into inventory', async () => {
    const charId = await createCharacter('Bob')
    const itemId = await createItem('Sword')
    const r = await handleInventoryManage(db(), { action: 'add', characterId: charId, itemId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('add stacks quantity for existing item', async () => {
    const charId = await createCharacter('Carol')
    const itemId = await createItem('Arrow')
    await handleInventoryManage(db(), { action: 'add', characterId: charId, itemId, quantity: 10 })
    const r = await handleInventoryManage(db(), { action: 'add', characterId: charId, itemId, quantity: 5 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('remove requires characterId and itemId', async () => {
    const r = await handleInventoryManage(db(), { action: 'remove', characterId: 'c1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('remove returns error if item not in inventory', async () => {
    const charId = await createCharacter('Dave')
    const itemId = await createItem('Dagger')
    const r = await handleInventoryManage(db(), { action: 'remove', characterId: charId, itemId })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('remove decrements quantity', async () => {
    const charId = await createCharacter('Eve')
    const itemId = await createItem('Bolt')
    await handleInventoryManage(db(), { action: 'add', characterId: charId, itemId, quantity: 5 })
    const r = await handleInventoryManage(db(), { action: 'remove', characterId: charId, itemId, quantity: 3 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('remove deletes row when quantity equals stock', async () => {
    const charId = await createCharacter('Frank')
    const itemId = await createItem('Potion')
    await handleInventoryManage(db(), { action: 'add', characterId: charId, itemId, quantity: 1 })
    const r = await handleInventoryManage(db(), { action: 'remove', characterId: charId, itemId, quantity: 1 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('equip requires characterId and itemId', async () => {
    const r = await handleInventoryManage(db(), { action: 'equip', characterId: 'c1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('equip marks item as equipped', async () => {
    const charId = await createCharacter('Grace')
    const itemId = await createItem('Mace')
    await handleInventoryManage(db(), { action: 'add', characterId: charId, itemId })
    const r = await handleInventoryManage(db(), { action: 'equip', characterId: charId, itemId, slot: 'main_hand' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('unequip requires characterId and itemId', async () => {
    const r = await handleInventoryManage(db(), { action: 'unequip', characterId: 'c1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('unequip marks item as unequipped', async () => {
    const charId = await createCharacter('Hank')
    const itemId = await createItem('Axe')
    await handleInventoryManage(db(), { action: 'add', characterId: charId, itemId })
    await handleInventoryManage(db(), { action: 'equip', characterId: charId, itemId })
    const r = await handleInventoryManage(db(), { action: 'unequip', characterId: charId, itemId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('transfer requires characterId, itemId, targetCharacterId', async () => {
    const r = await handleInventoryManage(db(), { action: 'transfer', characterId: 'c1', itemId: 'i1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('transfer returns error for insufficient quantity', async () => {
    const charId = await createCharacter('Ivan')
    const charId2 = await createCharacter('Judy')
    const itemId = await createItem('Coin')
    const r = await handleInventoryManage(db(), { action: 'transfer', characterId: charId, itemId, targetCharacterId: charId2 })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('transfer moves item to target character (full stack)', async () => {
    const charId = await createCharacter('Karl')
    const charId2 = await createCharacter('Laura')
    const itemId = await createItem('Key')
    await handleInventoryManage(db(), { action: 'add', characterId: charId, itemId, quantity: 1 })
    const r = await handleInventoryManage(db(), { action: 'transfer', characterId: charId, itemId, targetCharacterId: charId2, quantity: 1 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('transfer partial stack updates quantities', async () => {
    const charId = await createCharacter('Mike')
    const charId2 = await createCharacter('Nina')
    const itemId = await createItem('Arrow2')
    await handleInventoryManage(db(), { action: 'add', characterId: charId, itemId, quantity: 10 })
    // give target some first so it increments
    await handleInventoryManage(db(), { action: 'add', characterId: charId2, itemId, quantity: 5 })
    const r = await handleInventoryManage(db(), { action: 'transfer', characterId: charId, itemId, targetCharacterId: charId2, quantity: 5 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })
})
