// Direct handler tests for aura-manage (not registered in rpgToolRegistry)
import { describe } from './support/helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'
import { handleAuraManage } from '@/rpg/handlers/aura-manage'

describe('handleAuraManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)

  async function createCharacter(id: string) {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(`INSERT OR IGNORE INTO characters (id, name, stats, hp, max_hp, ac, level, character_type, character_class, race, conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells, cantrips_known, currency, resource_pools, xp, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, id, '{}', 10, 10, 10, 1, 'pc', 'Fighter', 'Human', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', 0, now, now).run()
  }

  it('returns guiding error for unknown action', async () => {
    const r = await handleAuraManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  it('create requires ownerId and spellName', async () => {
    const r = await handleAuraManage(db(), { action: 'create', ownerId: 'char-1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('create inserts a new aura', async () => {
    await createCharacter('char-1')
    const r = await handleAuraManage(db(), { action: 'create', ownerId: 'char-1', spellName: 'Bless', requiresConcentration: true, effects: { bonus: 1 } })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.auraId).toBeTruthy()
    expect(body.spellName).toBe('Bless')
  })

  it('get requires id', async () => {
    const r = await handleAuraManage(db(), { action: 'get' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get returns not found', async () => {
    const r = await handleAuraManage(db(), { action: 'get', id: 'no-id' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get returns created aura', async () => {
    await createCharacter('char-2')
    const c = await handleAuraManage(db(), { action: 'create', ownerId: 'char-2', spellName: 'Shield' })
    const { auraId } = JSON.parse(c.content[0].text)
    const r = await handleAuraManage(db(), { action: 'get', id: auraId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.aura.spell_name).toBe('Shield')
  })

  it('list returns all auras', async () => {
    await createCharacter('c1')
    await handleAuraManage(db(), { action: 'create', ownerId: 'c1', spellName: 'Fire' })
    const r = await handleAuraManage(db(), { action: 'list' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBeGreaterThanOrEqual(1)
  })

  it('remove requires id or ownerId', async () => {
    const r = await handleAuraManage(db(), { action: 'remove' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('remove by id', async () => {
    await createCharacter('c1')
    const c = await handleAuraManage(db(), { action: 'create', ownerId: 'c1', spellName: 'Haste' })
    const { auraId } = JSON.parse(c.content[0].text)
    const r = await handleAuraManage(db(), { action: 'remove', id: auraId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('remove by ownerId', async () => {
    await createCharacter('owner-x')
    await handleAuraManage(db(), { action: 'create', ownerId: 'owner-x', spellName: 'Slow' })
    const r = await handleAuraManage(db(), { action: 'remove', ownerId: 'owner-x' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('expire removes expired auras', async () => {
    const r = await handleAuraManage(db(), { action: 'expire' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.expired).toBeGreaterThanOrEqual(0)
  })

  it('get_affecting requires targetId', async () => {
    const r = await handleAuraManage(db(), { action: 'get_affecting' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_affecting returns auras for target', async () => {
    const r = await handleAuraManage(db(), { action: 'get_affecting', targetId: 'target-1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.targetId).toBe('target-1')
  })

  it('concentrate requires characterId and spellName', async () => {
    const r = await handleAuraManage(db(), { action: 'concentrate', characterId: 'c1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('concentrate records concentration', async () => {
    await createCharacter('c1')
    const r = await handleAuraManage(db(), { action: 'concentrate', characterId: 'c1', spellName: 'Web', targetIds: ['t1', 't2'] })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.spellName).toBe('Web')
  })

  it('break_concentration requires characterId', async () => {
    const r = await handleAuraManage(db(), { action: 'break_concentration' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('break_concentration returns hadConcentration false when none active', async () => {
    const r = await handleAuraManage(db(), { action: 'break_concentration', characterId: 'no-conc' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hadConcentration).toBe(false)
  })

  it('break_concentration clears active concentration', async () => {
    await createCharacter('c2')
    await handleAuraManage(db(), { action: 'concentrate', characterId: 'c2', spellName: 'Fly' })
    const r = await handleAuraManage(db(), { action: 'break_concentration', characterId: 'c2' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.hadConcentration).toBe(true)
    expect(body.spellEnded).toBe('Fly')
  })
})
