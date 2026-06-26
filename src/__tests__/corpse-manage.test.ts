// Direct handler tests for corpse-manage (not registered in rpgToolRegistry)
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handleCorpseManage } from '../rpg/handlers/corpse-manage'

describe('handleCorpseManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)

  it('returns guiding error for unknown action', async () => {
    const r = await handleCorpseManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  it('returns validation error for missing action', async () => {
    const r = await handleCorpseManage(db(), {})
    expect(r.content[0].text).toContain('Required')
  })

  it('create requires characterId and characterName', async () => {
    const r = await handleCorpseManage(db(), { action: 'create', characterId: 'c1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('create inserts a new corpse', async () => {
    const r = await handleCorpseManage(db(), { action: 'create', characterId: 'c1', characterName: 'Dead Goblin', characterType: 'enemy', worldId: 'w1', positionX: 5, positionY: 3 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.state).toBe('fresh')
    expect(body.corpseId).toBeTruthy()
  })

  it('get requires id', async () => {
    const r = await handleCorpseManage(db(), { action: 'get' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get returns not found', async () => {
    const r = await handleCorpseManage(db(), { action: 'get', id: 'no-id' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get returns corpse with loot', async () => {
    const c = await handleCorpseManage(db(), { action: 'create', characterId: 'c2', characterName: 'Orc' })
    const { corpseId } = JSON.parse(c.content[0].text)
    const r = await handleCorpseManage(db(), { action: 'get', id: corpseId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.corpse.character_name).toBe('Orc')
  })

  it('list returns all corpses', async () => {
    await handleCorpseManage(db(), { action: 'create', characterId: 'c3', characterName: 'Zombie' })
    const r = await handleCorpseManage(db(), { action: 'list' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBeGreaterThanOrEqual(1)
  })

  it('list filters fresh corpses', async () => {
    const r = await handleCorpseManage(db(), { action: 'list', filter: 'fresh' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('list filters unlooted corpses', async () => {
    const r = await handleCorpseManage(db(), { action: 'list', filter: 'unlooted' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('list filters by worldId', async () => {
    const r = await handleCorpseManage(db(), { action: 'list', worldIdFilter: 'w1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('loot requires id', async () => {
    const r = await handleCorpseManage(db(), { action: 'loot' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('loot marks corpse as looted', async () => {
    const c = await handleCorpseManage(db(), { action: 'create', characterId: 'c4', characterName: 'Bandit' })
    const { corpseId } = JSON.parse(c.content[0].text)
    const r = await handleCorpseManage(db(), { action: 'loot', id: corpseId, lootedBy: 'player-1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('decay requires id', async () => {
    const r = await handleCorpseManage(db(), { action: 'decay' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('decay returns not found', async () => {
    const r = await handleCorpseManage(db(), { action: 'decay', id: 'no-id' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('decay advances state fresh → decaying', async () => {
    const c = await handleCorpseManage(db(), { action: 'create', characterId: 'c5', characterName: 'Troll' })
    const { corpseId } = JSON.parse(c.content[0].text)
    const r = await handleCorpseManage(db(), { action: 'decay', id: corpseId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.previousState).toBe('fresh')
    expect(body.newState).toBe('decaying')
  })

  it('generate_loot requires id', async () => {
    const r = await handleCorpseManage(db(), { action: 'generate_loot' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('generate_loot marks corpse as loot-generated', async () => {
    const c = await handleCorpseManage(db(), { action: 'create', characterId: 'c6', characterName: 'Dragon' })
    const { corpseId } = JSON.parse(c.content[0].text)
    const r = await handleCorpseManage(db(), { action: 'generate_loot', id: corpseId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('delete requires id', async () => {
    const r = await handleCorpseManage(db(), { action: 'delete' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('delete removes corpse', async () => {
    const c = await handleCorpseManage(db(), { action: 'create', characterId: 'c7', characterName: 'Imp' })
    const { corpseId } = JSON.parse(c.content[0].text)
    const r = await handleCorpseManage(db(), { action: 'delete', id: corpseId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })
})
