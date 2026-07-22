// Direct handler tests for item-manage (not registered in rpgToolRegistry)
import { describe } from './support/helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'
import { handleItemManage } from '@/rpg/handlers/item-manage'

describe('handleItemManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)

  it('returns guiding error for unknown action', async () => {
    const r = await handleItemManage(db(), { action: 'frobnicate' })
    expect(r.content[0].text).toContain('frobnicate')
  })

  it('returns validation error for missing action field', async () => {
    const r = await handleItemManage(db(), {})
    expect(r.content[0].text).toContain('Required')
  })

  it('create requires name and type', async () => {
    const r = await handleItemManage(db(), { action: 'create', name: 'Sword' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('create inserts a new item', async () => {
    const r = await handleItemManage(db(), { action: 'create', name: 'Iron Sword', type: 'weapon', weight: 3, value: 50, properties: { damage: '1d8' } })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.itemId).toBeTruthy()
    expect(body.name).toBe('Iron Sword')
  })

  it('get requires id', async () => {
    const r = await handleItemManage(db(), { action: 'get' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get returns not found for unknown id', async () => {
    const r = await handleItemManage(db(), { action: 'get', id: 'no-such-id' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('not found')
  })

  it('get returns created item', async () => {
    const c = await handleItemManage(db(), { action: 'create', name: 'Shield', type: 'armor' })
    const { itemId } = JSON.parse(c.content[0].text)
    const r = await handleItemManage(db(), { action: 'get', id: itemId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.item.name).toBe('Shield')
  })

  it('list returns all items', async () => {
    await handleItemManage(db(), { action: 'create', name: 'Dagger', type: 'weapon' })
    const r = await handleItemManage(db(), { action: 'list' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBeGreaterThanOrEqual(1)
  })

  it('list filters by itemType', async () => {
    await handleItemManage(db(), { action: 'create', name: 'Helm', type: 'armor' })
    const r = await handleItemManage(db(), { action: 'list', itemType: 'armor' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.items.every((i: any) => i.type === 'armor')).toBe(true)
  })

  it('update requires id', async () => {
    const r = await handleItemManage(db(), { action: 'update' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update modifies item fields', async () => {
    const c = await handleItemManage(db(), { action: 'create', name: 'Old Sword', type: 'weapon' })
    const { itemId } = JSON.parse(c.content[0].text)
    const r = await handleItemManage(db(), { action: 'update', id: itemId, name: 'New Sword', type: 'weapon', weight: 5, value: 100, description: 'Shiny', properties: { bonus: 1 } })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('delete requires id', async () => {
    const r = await handleItemManage(db(), { action: 'delete' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('delete removes item', async () => {
    const c = await handleItemManage(db(), { action: 'create', name: 'Torch', type: 'tool' })
    const { itemId } = JSON.parse(c.content[0].text)
    const r = await handleItemManage(db(), { action: 'delete', id: itemId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('search requires query', async () => {
    const r = await handleItemManage(db(), { action: 'search' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('search returns matching items', async () => {
    await handleItemManage(db(), { action: 'create', name: 'Fire Staff', type: 'weapon', description: 'burns' })
    const r = await handleItemManage(db(), { action: 'search', query: 'Fire' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBeGreaterThanOrEqual(1)
  })
})
