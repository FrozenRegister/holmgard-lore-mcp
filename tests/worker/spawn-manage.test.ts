// Direct handler tests for spawn-manage (not registered in rpgToolRegistry)
import { describe } from './support/helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'
import { handleSpawnManage } from '@/rpg/handlers/spawn-manage'

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

  it('place_character requires characterId', async () => {
    const r = await handleSpawnManage(db(), { action: 'place_character', q: 0, r: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('characterId')
  })

  it('place_character requires q and r', async () => {
    const r = await handleSpawnManage(db(), { action: 'place_character', characterId: 'char-1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('"q"')
  })

  it('place_character returns error for unknown character', async () => {
    const r = await handleSpawnManage(db(), { action: 'place_character', characterId: 'no-char', q: 0, r: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('not found')
  })

  it('place_character places a character at a hex with default mapId', async () => {
    const char = await handleSpawnManage(db(), { action: 'spawn_character', name: 'Goblin Scout' })
    const { characterId } = JSON.parse(char.content[0].text)
    const r = await handleSpawnManage(db(), { action: 'place_character', characterId, q: 3, r: -2 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.q).toBe(3)
    expect(body.r).toBe(-2)
    expect(body.mapId).toBe('main')
    const stored = await env.RPG_DB.prepare('SELECT current_hex_q, current_hex_r, map_id FROM characters WHERE id = ?').bind(characterId).first() as any
    expect(stored.current_hex_q).toBe(3)
    expect(stored.current_hex_r).toBe(-2)
    expect(stored.map_id).toBe('main')
  })

  it('place_character places a character at a hex with explicit mapId', async () => {
    const char = await handleSpawnManage(db(), { action: 'spawn_character', name: 'Orc Shaman' })
    const { characterId } = JSON.parse(char.content[0].text)
    const r = await handleSpawnManage(db(), { action: 'place_character', characterId, q: 1, r: 1, mapId: 'dungeon-level-1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.mapId).toBe('dungeon-level-1')
    const stored = await env.RPG_DB.prepare('SELECT current_hex_q, current_hex_r, map_id FROM characters WHERE id = ?').bind(characterId).first() as any
    expect(stored.map_id).toBe('dungeon-level-1')
  })
})
