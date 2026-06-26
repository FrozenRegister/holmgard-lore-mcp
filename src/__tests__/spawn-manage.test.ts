// Direct handler tests for spawn-manage (not registered in rpgToolRegistry)
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handleSpawnManage } from '../rpg/handlers/spawn-manage'

describe('handleSpawnManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)

  it('returns guiding error for unknown action', async () => {
    const r = await handleSpawnManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  it('spawn_character requires name', async () => {
    const r = await handleSpawnManage(db(), { action: 'spawn_character' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('spawn_character creates a character', async () => {
    const r = await handleSpawnManage(db(), { action: 'spawn_character', name: 'Goblin', characterType: 'enemy', level: 2, hp: 10, maxHp: 10, stats: { str: 8, dex: 14, con: 10, int: 6, wis: 8, cha: 6 } })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.name).toBe('Goblin')
    expect(body.hp).toBe(10)
  })

  it('spawn_character uses default hp based on level', async () => {
    const r = await handleSpawnManage(db(), { action: 'spawn_character', name: 'Orc', level: 3 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hp).toBeGreaterThan(0)
  })

  it('spawn_encounter creates an encounter', async () => {
    const r = await handleSpawnManage(db(), { action: 'spawn_encounter' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.encounterId).toBeTruthy()
    expect(body.status).toBe('setup')
  })

  it('spawn_location requires name', async () => {
    const r = await handleSpawnManage(db(), { action: 'spawn_location' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('spawn_location creates a room node', async () => {
    const r = await handleSpawnManage(db(), { action: 'spawn_location', name: 'Ancient Dark Cave' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.name).toBe('Ancient Dark Cave')
  })

  it('add_to_encounter requires encounterId and characterId', async () => {
    const r = await handleSpawnManage(db(), { action: 'add_to_encounter', encounterId: 'enc-1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('add_to_encounter returns error for unknown encounter', async () => {
    const r = await handleSpawnManage(db(), { action: 'add_to_encounter', encounterId: 'no-enc', characterId: 'c1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('add_to_encounter returns error for unknown character', async () => {
    const enc = await handleSpawnManage(db(), { action: 'spawn_encounter' })
    const { encounterId } = JSON.parse(enc.content[0].text)
    const r = await handleSpawnManage(db(), { action: 'add_to_encounter', encounterId, characterId: 'no-char' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('add_to_encounter adds character to encounter', async () => {
    const enc = await handleSpawnManage(db(), { action: 'spawn_encounter' })
    const { encounterId } = JSON.parse(enc.content[0].text)
    const char = await handleSpawnManage(db(), { action: 'spawn_character', name: 'Troll' })
    const { characterId } = JSON.parse(char.content[0].text)
    const r = await handleSpawnManage(db(), { action: 'add_to_encounter', encounterId, characterId, initiative: 15, position: { x: 2, y: 3 } })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.totalCombatants).toBe(1)
  })

  it('list_spawned returns npc/enemy characters', async () => {
    await handleSpawnManage(db(), { action: 'spawn_character', name: 'Rat', characterType: 'enemy' })
    const r = await handleSpawnManage(db(), { action: 'list_spawned' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBeGreaterThanOrEqual(1)
  })
})
