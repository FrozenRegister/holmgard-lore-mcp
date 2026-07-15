// Direct handler tests for npc-manage (not registered in rpgToolRegistry)
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handleNpcManage } from '../rpg/handlers/npc-manage'

describe('handleNpcManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)

  it('returns guiding error for unknown action', async () => {
    const r = await handleNpcManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  it('create requires name', async () => {
    const r = await handleNpcManage(db(), { action: 'create' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('create inserts a new NPC', async () => {
    const r = await handleNpcManage(db(), { action: 'create', name: 'Innkeeper', class: 'Commoner', race: 'Human', level: 1, hp: 8, maxHp: 8, stats: { str: 10, dex: 10, con: 12, int: 11, wis: 13, cha: 14 } })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.name).toBe('Innkeeper')
  })

  it('get_full_context requires id', async () => {
    const r = await handleNpcManage(db(), { action: 'get_full_context' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_full_context returns not found for unknown id', async () => {
    const r = await handleNpcManage(db(), { action: 'get_full_context', id: 'no-id' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_full_context returns NPC with relationships and memories', async () => {
    const c = await handleNpcManage(db(), { action: 'create', name: 'Guard' })
    const { characterId } = JSON.parse(c.content[0].text)
    const r = await handleNpcManage(db(), { action: 'get_full_context', id: characterId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.character.name).toBe('Guard')
  })

  it('get_relationship requires characterId and npcId', async () => {
    const r = await handleNpcManage(db(), { action: 'get_relationship', characterId: 'c1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_relationship returns null for no existing relationship', async () => {
    const r = await handleNpcManage(db(), { action: 'get_relationship', characterId: 'c1', npcId: 'n1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.relationship).toBeNull()
  })

  it('update_relationship requires characterId and npcId', async () => {
    const r = await handleNpcManage(db(), { action: 'update_relationship', characterId: 'c1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update_relationship creates new relationship', async () => {
    const r = await handleNpcManage(db(), { action: 'update_relationship', characterId: 'c1', npcId: 'n1', familiarity: 'friend', disposition: 'friendly', notes: 'Old pal' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.familiarity).toBe('friend')
  })

  it('update_relationship updates existing relationship', async () => {
    await handleNpcManage(db(), { action: 'update_relationship', characterId: 'c2', npcId: 'n2', familiarity: 'stranger' })
    const r = await handleNpcManage(db(), { action: 'update_relationship', characterId: 'c2', npcId: 'n2', familiarity: 'acquaintance', disposition: 'neutral', notes: 'Met again' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('record_memory requires characterId, npcId, summary', async () => {
    const r = await handleNpcManage(db(), { action: 'record_memory', characterId: 'c1', npcId: 'n1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('record_memory stores conversation memory', async () => {
    const r = await handleNpcManage(db(), { action: 'record_memory', characterId: 'c1', npcId: 'n1', summary: 'Talked about the quest', importance: 'high', topics: ['quest', 'dragon'] })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('get_history requires characterId and npcId', async () => {
    const r = await handleNpcManage(db(), { action: 'get_history', characterId: 'c1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_history returns memories', async () => {
    await handleNpcManage(db(), { action: 'record_memory', characterId: 'c3', npcId: 'n3', summary: 'First meeting', importance: 'low' })
    const r = await handleNpcManage(db(), { action: 'get_history', characterId: 'c3', npcId: 'n3' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBeGreaterThanOrEqual(1)
  })

  it('get_recent requires characterId', async () => {
    const r = await handleNpcManage(db(), { action: 'get_recent' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_recent returns recent interactions', async () => {
    const r = await handleNpcManage(db(), { action: 'get_recent', characterId: 'c4' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBeGreaterThanOrEqual(0)
  })

  it('get_context requires id', async () => {
    const r = await handleNpcManage(db(), { action: 'get_context' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_context returns not found for unknown id', async () => {
    const r = await handleNpcManage(db(), { action: 'get_context', id: 'no-id' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_context returns NPC summary', async () => {
    const c = await handleNpcManage(db(), { action: 'create', name: 'Merchant' })
    const { characterId } = JSON.parse(c.content[0].text)
    const r = await handleNpcManage(db(), { action: 'get_context', id: characterId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.npc).toBeDefined()
  })

  it('interact requires characterId and npcId', async () => {
    const r = await handleNpcManage(db(), { action: 'interact', characterId: 'c1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('interact records interaction', async () => {
    const r = await handleNpcManage(db(), { action: 'interact', characterId: 'c5', npcId: 'n5', context: 'Bought a potion' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.interactionRecorded).toBe(true)
  })

  it('interact without context still records interaction', async () => {
    const r = await handleNpcManage(db(), { action: 'interact', characterId: 'c6', npcId: 'n6' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('list requires no parameters but accepts optional worldId', async () => {
    const r = await handleNpcManage(db(), { action: 'list' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.npcs).toBeDefined()
  })

  it('list returns all NPCs', async () => {
    await handleNpcManage(db(), { action: 'create', name: 'NPC1' })
    await handleNpcManage(db(), { action: 'create', name: 'NPC2' })
    const r = await handleNpcManage(db(), { action: 'list' })
    const body = JSON.parse(r.content[0].text)
    expect(body.count).toBeGreaterThanOrEqual(2)
  })

  it('get requires npcId or id', async () => {
    const r = await handleNpcManage(db(), { action: 'get' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get returns not found for unknown npcId', async () => {
    const r = await handleNpcManage(db(), { action: 'get', npcId: 'invalid-id' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get returns NPC with relationships', async () => {
    const c = await handleNpcManage(db(), { action: 'create', name: 'Paladin', level: 5 })
    const { characterId } = JSON.parse(c.content[0].text)
    const r = await handleNpcManage(db(), { action: 'get', npcId: characterId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.npc.name).toBe('Paladin')
    expect(body.npc.level).toBe(5)
  })

  it('update requires npcId or id', async () => {
    const r = await handleNpcManage(db(), { action: 'update' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update modifies NPC state', async () => {
    const c = await handleNpcManage(db(), { action: 'create', name: 'Rogue', disposition: 'neutral' })
    const { characterId } = JSON.parse(c.content[0].text)
    const r = await handleNpcManage(db(), { action: 'update', npcId: characterId, name: 'Master Rogue', disposition: 'friendly', hp: 15 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.updated).toBeGreaterThan(0)
  })

  it('assign_to_location requires npcId and location or hex coords', async () => {
    const r = await handleNpcManage(db(), { action: 'assign_to_location', npcId: 'n1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('assign_to_location places NPC at location_key', async () => {
    const c = await handleNpcManage(db(), { action: 'create', name: 'Guard' })
    const { characterId } = JSON.parse(c.content[0].text)
    const r = await handleNpcManage(db(), { action: 'assign_to_location', npcId: characterId, locationKey: 'location:tavern' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.locationKey).toBe('location:tavern')
  })

  it('assign_to_location places NPC at hex coordinates', async () => {
    const c = await handleNpcManage(db(), { action: 'create', name: 'Scout' })
    const { characterId } = JSON.parse(c.content[0].text)
    const r = await handleNpcManage(db(), { action: 'assign_to_location', npcId: characterId, hexQ: 5, hexR: 7 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hexQ).toBe(5)
    expect(body.hexR).toBe(7)
  })
})
