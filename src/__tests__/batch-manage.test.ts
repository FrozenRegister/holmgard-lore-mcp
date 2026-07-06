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

  it('batch_create_characters accepts custom values for every character field', async () => {
    const spec = {
      name: 'Custom Bandit',
      level: 3,
      characterClass: 'Rogue',
      race: 'Human',
      characterType: 'enemy',
      stats: { str: 12, dex: 18, con: 10, int: 9, wis: 11, cha: 8 },
      hp: 20,
      maxHp: 20,
      ac: 15,
      factionId: 'faction:bandits',
      behavior: 'ambush',
      background: 'Outlaw',
      alignment: 'Chaotic Neutral',
      origin: 'Old Mill',
      conditions: ['prone'],
      resistances: ['poison'],
      vulnerabilities: ['fire'],
      immunities: ['disease'],
      knownSpells: ['minor-illusion'],
      preparedSpells: ['minor-illusion'],
      cantripsKnown: ['prestidigitation'],
      spellSlots: { '1': { max: 2, current: 2 } },
      pactMagicSlots: { max: 1, current: 1, level: 1 },
      maxSpellLevel: 1,
      concentratingOn: 'minor-illusion',
      legendaryActions: 1,
      legendaryActionsRemaining: 1,
      legendaryResistances: 1,
      legendaryResistancesRemaining: 1,
      hasLairActions: false,
      currency: { gold: 15, silver: 3, copper: 0 },
      perceptionBonus: 2,
      stealthBonus: 4,
      resourcePools: { sneakAttack: { max: 1, current: 1 } },
    }
    const r = await handleBatchManage(db(), { action: 'batch_create_characters', characters: [spec] })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.successCount).toBe(1)

    const row = await env.RPG_DB.prepare('SELECT * FROM characters WHERE id = ?').bind(body.created[0].id).first() as Record<string, unknown>
    expect(JSON.parse(row.stats as string)).toEqual(spec.stats)
    expect(row.faction_id).toBe('faction:bandits')
    expect(row.behavior).toBe('ambush')
    expect(row.origin).toBe('Old Mill')
    expect(JSON.parse(row.conditions as string)).toEqual(['prone'])
    expect(JSON.parse(row.resistances as string)).toEqual(['poison'])
    expect(JSON.parse(row.vulnerabilities as string)).toEqual(['fire'])
    expect(JSON.parse(row.immunities as string)).toEqual(['disease'])
    expect(JSON.parse(row.known_spells as string)).toEqual(['minor-illusion'])
    expect(JSON.parse(row.prepared_spells as string)).toEqual(['minor-illusion'])
    expect(JSON.parse(row.cantrips_known as string)).toEqual(['prestidigitation'])
    expect(JSON.parse(row.spell_slots as string)).toEqual(spec.spellSlots)
    expect(JSON.parse(row.pact_magic_slots as string)).toEqual(spec.pactMagicSlots)
    expect(row.max_spell_level).toBe(1)
    expect(row.concentrating_on).toBe('minor-illusion')
    expect(row.legendary_actions).toBe(1)
    expect(row.legendary_actions_remaining).toBe(1)
    expect(row.legendary_resistances).toBe(1)
    expect(row.legendary_resistances_remaining).toBe(1)
    expect(row.has_lair_actions).toBe(0)
    expect(JSON.parse(row.currency as string)).toEqual(spec.currency)
    expect(row.perception_bonus).toBe(2)
    expect(row.stealth_bonus).toBe(4)
    expect(JSON.parse(row.resource_pools as string)).toEqual(spec.resourcePools)
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
