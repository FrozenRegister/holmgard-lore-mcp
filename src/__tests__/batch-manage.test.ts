// Direct handler tests for batch-manage (not registered in rpgToolRegistry)
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handleBatchManage } from '../rpg/handlers/batch-manage'
import { handleItemManage } from '../rpg/handlers/item-manage'

describe('handleBatchManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)

  it('returns guiding error for unknown action', async () => {
    const r = await handleBatchManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  it('batch_create_characters requires non-empty array', async () => {
    const r = await handleBatchManage(db(), { action: 'batch_create_characters', characters: [] })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('batch_create_characters creates multiple characters', async () => {
    const r = await handleBatchManage(db(), {
      action: 'batch_create_characters',
      characters: [
        { name: 'Fighter1', characterClass: 'Fighter', characterType: 'pc' },
        { name: 'Mage1', characterClass: 'Wizard', characterType: 'pc', level: 3 },
      ]
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.successCount).toBe(2)
    expect(body.errorCount).toBe(0)
  })

  it('batch_create_npcs creates NPC characters', async () => {
    const r = await handleBatchManage(db(), {
      action: 'batch_create_npcs',
      characters: [{ name: 'Guard A', characterType: 'enemy' }]
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.successCount).toBe(1)
  })

  it('batch_distribute_items requires non-empty distributions', async () => {
    const r = await handleBatchManage(db(), { action: 'batch_distribute_items', distributions: [] })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('batch_distribute_items distributes items', async () => {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(`INSERT OR IGNORE INTO characters (id, name, stats, hp, max_hp, ac, level, character_type, character_class, race, conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells, cantrips_known, currency, resource_pools, xp, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('char-1', 'char-1', '{}', 10, 10, 10, 1, 'pc', 'Fighter', 'Human', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', 0, now, now).run()
    const item = await handleItemManage(db(), { action: 'create', name: 'Gold Coin', type: 'currency' })
    const { itemId } = JSON.parse(item.content[0].text)
    const r = await handleBatchManage(db(), {
      action: 'batch_distribute_items',
      distributions: [{ characterId: 'char-1', itemId, quantity: 10 }]
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.successCount).toBe(1)
  })

  it('execute_workflow requires non-empty steps', async () => {
    const r = await handleBatchManage(db(), { action: 'execute_workflow', steps: [] })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('execute_workflow records steps', async () => {
    const r = await handleBatchManage(db(), {
      action: 'execute_workflow',
      steps: [{ tool: 'character_manage', args: { action: 'list' } }]
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.stepsExecuted).toBe(1)
  })

  it('list_templates returns all templates', async () => {
    const r = await handleBatchManage(db(), { action: 'list_templates' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBeGreaterThan(0)
  })

  it('list_templates filters by category', async () => {
    const r = await handleBatchManage(db(), { action: 'list_templates', category: 'party' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.templates.every((t: any) => t.category === 'party')).toBe(true)
  })

  it('get_template requires templateId or templateName', async () => {
    const r = await handleBatchManage(db(), { action: 'get_template' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_template returns not found for unknown id', async () => {
    const r = await handleBatchManage(db(), { action: 'get_template', templateId: 'no-such' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_template returns template by id', async () => {
    const r = await handleBatchManage(db(), { action: 'get_template', templateId: 'party-4' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.template.id).toBe('party-4')
  })

  it('get_template returns template by name', async () => {
    const r = await handleBatchManage(db(), { action: 'get_template', templateName: 'Bandit' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.template.id).toBe('bandit-gang')
  })

  it('get_template returns template with empty data for unknown template id in templateData', async () => {
    // merchant-caravan has known template data
    const r = await handleBatchManage(db(), { action: 'get_template', templateId: 'merchant-caravan' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })
})
