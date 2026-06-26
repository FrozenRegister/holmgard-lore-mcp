// Direct handler tests for theft-manage (not registered in rpgToolRegistry)
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handleTheftManage } from '../rpg/handlers/theft-manage'

describe('handleTheftManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)

  // Pre-seed an item and two characters for FK-constrained tests
  async function seed() {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare('INSERT OR IGNORE INTO items (id, name, description, type, weight, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind('test-item', 'Gold Ring', null, 'jewelry', 0, 100, now, now).run()
    for (const id of ['thief-char', 'victim-char']) {
      await env.RPG_DB.prepare(`INSERT OR IGNORE INTO characters (id, name, stats, hp, max_hp, ac, level, character_type, character_class, race, conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells, cantrips_known, currency, resource_pools, xp, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, id, '{}', 10, 10, 10, 1, 'pc', 'Rogue', 'Human', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', 0, now, now).run()
    }
  }

  it('returns guiding error for unknown action', async () => {
    const r = await handleTheftManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  it('steal requires itemId, stolenFrom, stolenBy', async () => {
    const r = await handleTheftManage(db(), { action: 'steal', itemId: 'i1', stolenFrom: 'c1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('steal records theft', async () => {
    await seed()
    const r = await handleTheftManage(db(), { action: 'steal', itemId: 'test-item', stolenFrom: 'victim-char', stolenBy: 'thief-char', stolenLocation: 'market', witnesses: ['npc-1'], bounty: 50 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.heatLevel).toBe('burning')
    expect(body.stolenItemId).toBeTruthy()
  })

  it('get requires id', async () => {
    const r = await handleTheftManage(db(), { action: 'get' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get returns not found', async () => {
    const r = await handleTheftManage(db(), { action: 'get', id: 'no-id' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get returns stolen item record', async () => {
    await seed()
    const c = await handleTheftManage(db(), { action: 'steal', itemId: 'test-item', stolenFrom: 'victim-char', stolenBy: 'thief-char' })
    const { stolenItemId } = JSON.parse(c.content[0].text)
    const r = await handleTheftManage(db(), { action: 'get', id: stolenItemId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.stolenItem.item_id).toBe('test-item')
  })

  it('list returns all stolen items', async () => {
    await seed()
    await handleTheftManage(db(), { action: 'steal', itemId: 'test-item', stolenFrom: 'victim-char', stolenBy: 'thief-char' })
    const r = await handleTheftManage(db(), { action: 'list' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBeGreaterThanOrEqual(1)
  })

  it('list filters by thief', async () => {
    const r = await handleTheftManage(db(), { action: 'list', filter: { thief: 'specific-rogue' } })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('list filters by heat level', async () => {
    const r = await handleTheftManage(db(), { action: 'list', filter: { heat: 'burning' } })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('list filters by recovered status', async () => {
    const r = await handleTheftManage(db(), { action: 'list', filter: { recovered: false } })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('fence requires id', async () => {
    const r = await handleTheftManage(db(), { action: 'fence' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('fence marks item as fenced', async () => {
    await seed()
    const c = await handleTheftManage(db(), { action: 'steal', itemId: 'test-item', stolenFrom: 'victim-char', stolenBy: 'thief-char' })
    const { stolenItemId } = JSON.parse(c.content[0].text)
    const r = await handleTheftManage(db(), { action: 'fence', id: stolenItemId, fencedTo: 'fence-npc' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('recover requires id', async () => {
    const r = await handleTheftManage(db(), { action: 'recover' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('recover marks item as recovered', async () => {
    await seed()
    const c = await handleTheftManage(db(), { action: 'steal', itemId: 'test-item', stolenFrom: 'victim-char', stolenBy: 'thief-char' })
    const { stolenItemId } = JSON.parse(c.content[0].text)
    const r = await handleTheftManage(db(), { action: 'recover', id: stolenItemId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.heatLevel).toBe('cold')
  })

  it('cool_heat requires id', async () => {
    const r = await handleTheftManage(db(), { action: 'cool_heat' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('cool_heat returns not found', async () => {
    const r = await handleTheftManage(db(), { action: 'cool_heat', id: 'no-id' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('cool_heat reduces heat level', async () => {
    await seed()
    const c = await handleTheftManage(db(), { action: 'steal', itemId: 'test-item', stolenFrom: 'victim-char', stolenBy: 'thief-char' })
    const { stolenItemId } = JSON.parse(c.content[0].text)
    const r = await handleTheftManage(db(), { action: 'cool_heat', id: stolenItemId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.previousHeat).toBe('burning')
    expect(body.newHeat).toBe('hot')
  })

  it('report requires id', async () => {
    const r = await handleTheftManage(db(), { action: 'report' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('report flags item as reported to guards', async () => {
    await seed()
    const c = await handleTheftManage(db(), { action: 'steal', itemId: 'test-item', stolenFrom: 'victim-char', stolenBy: 'thief-char' })
    const { stolenItemId } = JSON.parse(c.content[0].text)
    const r = await handleTheftManage(db(), { action: 'report', id: stolenItemId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.reportedToGuards).toBe(true)
  })
})
