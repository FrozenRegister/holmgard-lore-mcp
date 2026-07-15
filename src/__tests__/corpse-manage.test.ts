// Direct handler tests for corpse-manage (not registered in rpgToolRegistry)
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach, afterEach, vi } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handleCorpseManage, tickAllCorpseDecomposition } from '../rpg/handlers/corpse-manage'
import { handleResourceManage } from '../rpg/handlers/resource-manage'

describe('handleCorpseManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)
  const WORLD = 'world-1'

  async function createWorld(id = WORLD) {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare('INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, 'Test World', 'abc123', 100, 100, now, now).run()
  }

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
    const r = await handleCorpseManage(db(), { action: 'create', characterId: 'c1', characterName: 'Dead Goblin', characterType: 'enemy', worldId: 'w1', positionQ: 5, positionR: 3 })
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

  // ── #288 — register ─────────────────────────────────────────────────────

  it('register requires characterId and characterName', async () => {
    const r = await handleCorpseManage(db(), { action: 'register', characterId: 'yune' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('register snapshots an empty inventory when the character holds nothing', async () => {
    await createWorld()
    const r = await handleCorpseManage(db(), { action: 'register', characterId: 'yune', characterName: 'Yune', worldId: WORLD, causeOfDeath: 'leonar attack' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.causeOfDeath).toBe('leonar attack')
    expect(body.inventorySnapshot).toEqual([])
    expect(body.decompositionStage).toBe('fresh')
  })

  it('register snapshots the character\'s resource_inventory via resource.get_state', async () => {
    await createWorld()
    await handleResourceManage(db(), { action: 'craft', biomeName: 'pine forest', itemName: 'Splint', abilityModifier: 20, rollValue: 10, ownerType: 'character', ownerId: 'nia', worldId: WORLD, day: 3 })
    const r = await handleCorpseManage(db(), { action: 'register', characterId: 'nia', characterName: 'Nia', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.inventorySnapshot).toHaveLength(1)
    expect(body.inventorySnapshot[0].itemName).toBe('Splint')
  })

  it('register accepts an explicit deathAt override', async () => {
    const r = await handleCorpseManage(db(), { action: 'register', characterId: 'adebayo', characterName: 'Adebayo', deathAt: '2026-01-01T00:00:00.000Z' })
    const body = JSON.parse(r.content[0].text)
    expect(body.deathAt).toBe('2026-01-01T00:00:00.000Z')
  })

  // ── #288 — decompose ─────────────────────────────────────────────────────

  it('decompose requires id', async () => {
    const r = await handleCorpseManage(db(), { action: 'decompose' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('decompose errors for a nonexistent corpse', async () => {
    const r = await handleCorpseManage(db(), { action: 'decompose', id: 'no-id' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('decompose computes every stage boundary from hoursSinceDeath', async () => {
    const reg = await handleCorpseManage(db(), { action: 'register', characterId: 'yune', characterName: 'Yune' })
    const { corpseId } = JSON.parse(reg.content[0].text)
    const expectations: Array<[number, string]> = [[0, 'fresh'], [6, 'early'], [24, 'bloat'], [72, 'active_decay'], [168, 'advanced_decay'], [336, 'skeletal']]
    for (const [hours, stage] of expectations) {
      const r = await handleCorpseManage(db(), { action: 'decompose', id: corpseId, hoursSinceDeath: hours })
      const body = JSON.parse(r.content[0].text)
      expect(body.decompositionStage).toBe(stage)
    }
  })

  it('decompose sets isLandmark true at advanced_decay and skeletal, false before', async () => {
    const reg = await handleCorpseManage(db(), { action: 'register', characterId: 'yune', characterName: 'Yune' })
    const { corpseId } = JSON.parse(reg.content[0].text)
    const early = await handleCorpseManage(db(), { action: 'decompose', id: corpseId, hoursSinceDeath: 24 })
    expect(JSON.parse(early.content[0].text).isLandmark).toBe(false)
    const advanced = await handleCorpseManage(db(), { action: 'decompose', id: corpseId, hoursSinceDeath: 200 })
    expect(JSON.parse(advanced.content[0].text).isLandmark).toBe(true)
  })

  it('decompose falls back to computing elapsed time from death_at when hoursSinceDeath is omitted', async () => {
    const reg = await handleCorpseManage(db(), { action: 'register', characterId: 'yune', characterName: 'Yune', deathAt: new Date(Date.now() - 10 * 3_600_000).toISOString() })
    const { corpseId } = JSON.parse(reg.content[0].text)
    const r = await handleCorpseManage(db(), { action: 'decompose', id: corpseId })
    const body = JSON.parse(r.content[0].text)
    expect(body.decompositionStage).toBe('early')
  })

  it('decompose errors once the corpse has been recovered', async () => {
    const reg = await handleCorpseManage(db(), { action: 'register', characterId: 'yune', characterName: 'Yune' })
    const { corpseId } = JSON.parse(reg.content[0].text)
    await handleCorpseManage(db(), { action: 'decompose', id: corpseId, hoursSinceDeath: 30 })
    await handleCorpseManage(db(), { action: 'recover', id: corpseId })
    const r = await handleCorpseManage(db(), { action: 'decompose', id: corpseId, hoursSinceDeath: 100 })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  // ── #288 — scavenge_check ────────────────────────────────────────────────

  it('scavenge_check requires worldId, positionQ, and positionR', async () => {
    const r = await handleCorpseManage(db(), { action: 'scavenge_check', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('scavenge_check reports zero attraction for an empty tile', async () => {
    await createWorld()
    const r = await handleCorpseManage(db(), { action: 'scavenge_check', worldId: WORLD, positionQ: 5, positionR: 5 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.corpseCount).toBe(0)
    expect(body.totalScavengerAttractionPercent).toBe(0)
    expect(body.productionInterventionRecommended).toBe(false)
  })

  it('scavenge_check stacks attraction across multiple corpses and recommends intervention at 3+', async () => {
    await createWorld()
    for (const id of ['c-a', 'c-b', 'c-c']) {
      const reg = await handleCorpseManage(db(), { action: 'register', characterId: id, characterName: id, worldId: WORLD, positionQ: 10, positionR: 10 })
      const { corpseId } = JSON.parse(reg.content[0].text)
      await handleCorpseManage(db(), { action: 'decompose', id: corpseId, hoursSinceDeath: 30 }) // bloat, 25% each
    }
    const r = await handleCorpseManage(db(), { action: 'scavenge_check', worldId: WORLD, positionQ: 10, positionR: 10 })
    const body = JSON.parse(r.content[0].text)
    expect(body.corpseCount).toBe(3)
    expect(body.totalScavengerAttractionPercent).toBe(75)
    expect(body.productionInterventionRecommended).toBe(true)
  })

  it('scavenge_check excludes recovered corpses', async () => {
    await createWorld()
    const reg = await handleCorpseManage(db(), { action: 'register', characterId: 'c-d', characterName: 'c-d', worldId: WORLD, positionQ: 20, positionR: 20 })
    const { corpseId } = JSON.parse(reg.content[0].text)
    await handleCorpseManage(db(), { action: 'decompose', id: corpseId, hoursSinceDeath: 30 })
    await handleCorpseManage(db(), { action: 'recover', id: corpseId })
    const r = await handleCorpseManage(db(), { action: 'scavenge_check', worldId: WORLD, positionQ: 20, positionR: 20 })
    const body = JSON.parse(r.content[0].text)
    expect(body.corpseCount).toBe(0)
  })

  // ── #288 — loot_corpse ───────────────────────────────────────────────────

  it('loot_corpse requires id and looterCharacterId', async () => {
    const r = await handleCorpseManage(db(), { action: 'loot_corpse', id: 'x' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('loot_corpse errors for a nonexistent corpse', async () => {
    const r = await handleCorpseManage(db(), { action: 'loot_corpse', id: 'no-id', looterCharacterId: 'looter' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('loot_corpse errors once the corpse has been recovered', async () => {
    const reg = await handleCorpseManage(db(), { action: 'register', characterId: 'yune', characterName: 'Yune' })
    const { corpseId } = JSON.parse(reg.content[0].text)
    await handleCorpseManage(db(), { action: 'decompose', id: corpseId, hoursSinceDeath: 30 })
    await handleCorpseManage(db(), { action: 'recover', id: corpseId })
    const r = await handleCorpseManage(db(), { action: 'loot_corpse', id: corpseId, looterCharacterId: 'looter' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('loot_corpse reports failure and no items when the DEX check fails', async () => {
    const reg = await handleCorpseManage(db(), { action: 'register', characterId: 'yune', characterName: 'Yune' })
    const { corpseId } = JSON.parse(reg.content[0].text)
    const r = await handleCorpseManage(db(), { action: 'loot_corpse', id: corpseId, looterCharacterId: 'looter', rollValue: 1, dexModifier: -10 })
    const body = JSON.parse(r.content[0].text)
    expect(body.succeeded).toBe(false)
    expect(body.itemsLooted).toEqual([])
  })

  async function registerWithItems(worldId: string, characterId: string, items: Array<{ itemName: string; category: string }>) {
    await createWorld(worldId)
    for (const item of items) {
      const now = new Date().toISOString()
      await env.RPG_DB.prepare('INSERT INTO resource_inventory (id, world_id, owner_type, owner_id, item_name, category, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)')
        .bind(crypto.randomUUID(), worldId, 'character', characterId, item.itemName, item.category, now, now).run()
    }
    const reg = await handleCorpseManage(db(), { action: 'register', characterId, characterName: characterId, worldId })
    return JSON.parse(reg.content[0].text).corpseId as string
  }

  it('loot_corpse at fresh stage returns the full inventory snapshot', async () => {
    const corpseId = await registerWithItems(WORLD, 'yune', [{ itemName: 'Field Dressing', category: 'medical' }, { itemName: '50ft Rope', category: 'tools' }])
    const r = await handleCorpseManage(db(), { action: 'loot_corpse', id: corpseId, looterCharacterId: 'looter', rollValue: 20, dexModifier: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.succeeded).toBe(true)
    expect(body.itemsLooted).toHaveLength(2)
  })

  it('loot_corpse at bloat stage applies partial (50%) contamination filtering', async () => {
    const corpseId = await registerWithItems(WORLD, 'nia', [{ itemName: 'Field Dressing', category: 'medical' }, { itemName: '50ft Rope', category: 'tools' }])
    await handleCorpseManage(db(), { action: 'decompose', id: corpseId, hoursSinceDeath: 30 })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const r = await handleCorpseManage(db(), { action: 'loot_corpse', id: corpseId, looterCharacterId: 'looter', rollValue: 20, dexModifier: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.succeeded).toBe(true)
    // Math.random mocked to 0 -> 0 < 0.5 fraction always true -> everything survives filtering
    expect(body.itemsLooted).toHaveLength(2)
  })

  it('loot_corpse at active_decay stage applies heavier (20%) contamination filtering', async () => {
    const corpseId = await registerWithItems(WORLD, 'adebayo', [{ itemName: 'Field Dressing', category: 'medical' }])
    await handleCorpseManage(db(), { action: 'decompose', id: corpseId, hoursSinceDeath: 100 })
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    const r = await handleCorpseManage(db(), { action: 'loot_corpse', id: corpseId, looterCharacterId: 'looter', rollValue: 20, dexModifier: 0 })
    const body = JSON.parse(r.content[0].text)
    // 0.9 < 0.2 is false -> filtered out
    expect(body.itemsLooted).toEqual([])
  })

  it('loot_corpse at advanced_decay stage only returns metal (tools/weapon) items', async () => {
    const corpseId = await registerWithItems(WORLD, 'kat', [
      { itemName: 'Field Dressing', category: 'medical' }, { itemName: 'Survival Knife', category: 'weapon' }, { itemName: '50ft Rope', category: 'tools' },
    ])
    await handleCorpseManage(db(), { action: 'decompose', id: corpseId, hoursSinceDeath: 200 })
    const r = await handleCorpseManage(db(), { action: 'loot_corpse', id: corpseId, looterCharacterId: 'looter', rollValue: 20, dexModifier: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.itemsLooted.map((i: { itemName: string }) => i.itemName).sort()).toEqual(['50ft Rope', 'Survival Knife'])
  })

  it('loot_corpse at skeletal stage returns metal items plus synthetic Bone Fragments', async () => {
    const corpseId = await registerWithItems(WORLD, 'skeletal-1', [{ itemName: 'Survival Knife', category: 'weapon' }])
    await handleCorpseManage(db(), { action: 'decompose', id: corpseId, hoursSinceDeath: 400 })
    const r = await handleCorpseManage(db(), { action: 'loot_corpse', id: corpseId, looterCharacterId: 'looter', rollValue: 20, dexModifier: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.itemsLooted.map((i: { itemName: string }) => i.itemName).sort()).toEqual(['Bone Fragments', 'Survival Knife'])
  })

  it('loot_corpse removes looted items from the persisted snapshot', async () => {
    const corpseId = await registerWithItems(WORLD, 'persisted', [{ itemName: 'Field Dressing', category: 'medical' }])
    await handleCorpseManage(db(), { action: 'loot_corpse', id: corpseId, looterCharacterId: 'looter', rollValue: 20, dexModifier: 0 })
    const state = await handleCorpseManage(db(), { action: 'get_state', id: corpseId })
    const stateBody = JSON.parse(state.content[0].text)
    expect(stateBody.inventorySnapshot).toEqual([])
  })

  it('loot_corpse reports disease exposure when the disease roll succeeds, and null when it fails', async () => {
    const corpseId = await registerWithItems(WORLD, 'diseased', [{ itemName: 'Field Dressing', category: 'medical' }])
    await handleCorpseManage(db(), { action: 'decompose', id: corpseId, hoursSinceDeath: 30 }) // bloat, 25% disease risk

    vi.spyOn(Math, 'random').mockReturnValue(0)
    const exposed = await handleCorpseManage(db(), { action: 'loot_corpse', id: corpseId, looterCharacterId: 'looter', rollValue: 20, dexModifier: 0 })
    expect(JSON.parse(exposed.content[0].text).diseaseExposure).toEqual({ disease: 'blood_poisoning', dc: 14 })
  })

  it('loot_corpse reports null disease exposure at fresh stage (0% disease risk)', async () => {
    const corpseId = await registerWithItems(WORLD, 'clean', [{ itemName: 'Field Dressing', category: 'medical' }])
    const r = await handleCorpseManage(db(), { action: 'loot_corpse', id: corpseId, looterCharacterId: 'looter', rollValue: 20, dexModifier: 0 })
    expect(JSON.parse(r.content[0].text).diseaseExposure).toBeNull()
  })

  // ── #288 — recover ───────────────────────────────────────────────────────

  it('recover requires id', async () => {
    const r = await handleCorpseManage(db(), { action: 'recover' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('recover errors for a nonexistent corpse', async () => {
    const r = await handleCorpseManage(db(), { action: 'recover', id: 'no-id' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('recover errors before Bloat stage (fresh/early)', async () => {
    const reg = await handleCorpseManage(db(), { action: 'register', characterId: 'yune', characterName: 'Yune' })
    const { corpseId } = JSON.parse(reg.content[0].text)
    const r = await handleCorpseManage(db(), { action: 'recover', id: corpseId })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('recover succeeds at bloat stage or later with an explicit recoveryType', async () => {
    const reg = await handleCorpseManage(db(), { action: 'register', characterId: 'yune', characterName: 'Yune' })
    const { corpseId } = JSON.parse(reg.content[0].text)
    await handleCorpseManage(db(), { action: 'decompose', id: corpseId, hoursSinceDeath: 30 })
    const r = await handleCorpseManage(db(), { action: 'recover', id: corpseId, recoveryType: 'trophy_recovery' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.recoveryType).toBe('trophy_recovery')
  })

  it('recover picks a random recoveryType when none is given', async () => {
    const reg = await handleCorpseManage(db(), { action: 'register', characterId: 'yune', characterName: 'Yune' })
    const { corpseId } = JSON.parse(reg.content[0].text)
    await handleCorpseManage(db(), { action: 'decompose', id: corpseId, hoursSinceDeath: 30 })
    const r = await handleCorpseManage(db(), { action: 'recover', id: corpseId })
    const body = JSON.parse(r.content[0].text)
    expect(['memorial_package', 'warning_display', 'trophy_recovery', 'research_recovery']).toContain(body.recoveryType)
  })

  it('recover errors when already recovered', async () => {
    const reg = await handleCorpseManage(db(), { action: 'register', characterId: 'yune', characterName: 'Yune' })
    const { corpseId } = JSON.parse(reg.content[0].text)
    await handleCorpseManage(db(), { action: 'decompose', id: corpseId, hoursSinceDeath: 30 })
    await handleCorpseManage(db(), { action: 'recover', id: corpseId })
    const r = await handleCorpseManage(db(), { action: 'recover', id: corpseId })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  // ── #288 — get_state ─────────────────────────────────────────────────────

  it('get_state requires id', async () => {
    const r = await handleCorpseManage(db(), { action: 'get_state' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_state errors for a nonexistent corpse', async () => {
    const r = await handleCorpseManage(db(), { action: 'get_state', id: 'no-id' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_state reports full decomposition/loot/disease/landmark/recovery details', async () => {
    const reg = await handleCorpseManage(db(), { action: 'register', characterId: 'yune', characterName: 'Yune' })
    const { corpseId } = JSON.parse(reg.content[0].text)
    await handleCorpseManage(db(), { action: 'decompose', id: corpseId, hoursSinceDeath: 200 })
    const r = await handleCorpseManage(db(), { action: 'get_state', id: corpseId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.decompositionStage).toBe('advanced_decay')
    expect(body.isLandmark).toBe(true)
    expect(body.recovered).toBe(false)
    expect(body.lootDescription).toContain('Metal')
  })

  // ── #288 — psychological_impact ──────────────────────────────────────────

  it('psychological_impact requires id and observerCharacterId', async () => {
    const r = await handleCorpseManage(db(), { action: 'psychological_impact', id: 'x' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('psychological_impact errors for a nonexistent corpse', async () => {
    const r = await handleCorpseManage(db(), { action: 'psychological_impact', id: 'no-id', observerCharacterId: 'obs' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('psychological_impact matches the issue\'s given DCs: fresh/stranger=10, fresh/party_member=16, bloat/stranger=12, active_decay/stranger=14', async () => {
    const reg = await handleCorpseManage(db(), { action: 'register', characterId: 'yune', characterName: 'Yune' })
    const { corpseId } = JSON.parse(reg.content[0].text)

    const fresh = await handleCorpseManage(db(), { action: 'psychological_impact', id: corpseId, observerCharacterId: 'obs', rollValue: 20 })
    expect(JSON.parse(fresh.content[0].text).dc).toBe(10)

    const freshParty = await handleCorpseManage(db(), { action: 'psychological_impact', id: corpseId, observerCharacterId: 'obs', relationship: 'party_member', rollValue: 20 })
    expect(JSON.parse(freshParty.content[0].text).dc).toBe(16)

    await handleCorpseManage(db(), { action: 'decompose', id: corpseId, hoursSinceDeath: 30 })
    const bloat = await handleCorpseManage(db(), { action: 'psychological_impact', id: corpseId, observerCharacterId: 'obs', rollValue: 20 })
    expect(JSON.parse(bloat.content[0].text).dc).toBe(12)

    await handleCorpseManage(db(), { action: 'decompose', id: corpseId, hoursSinceDeath: 100 })
    const active = await handleCorpseManage(db(), { action: 'psychological_impact', id: corpseId, observerCharacterId: 'obs', rollValue: 20 })
    expect(JSON.parse(active.content[0].text).dc).toBe(14)
  })

  it('psychological_impact applies flat DC overrides for betrayed_them (18) and saved_them (20)', async () => {
    const reg = await handleCorpseManage(db(), { action: 'register', characterId: 'yune', characterName: 'Yune' })
    const { corpseId } = JSON.parse(reg.content[0].text)
    const betrayed = await handleCorpseManage(db(), { action: 'psychological_impact', id: corpseId, observerCharacterId: 'obs', relationship: 'betrayed_them', rollValue: 20 })
    expect(JSON.parse(betrayed.content[0].text).dc).toBe(18)
    const saved = await handleCorpseManage(db(), { action: 'psychological_impact', id: corpseId, observerCharacterId: 'obs', relationship: 'saved_them', rollValue: 20 })
    expect(JSON.parse(saved.content[0].text).dc).toBe(20)
  })

  it('psychological_impact adds +3 for multipleCorpses', async () => {
    const reg = await handleCorpseManage(db(), { action: 'register', characterId: 'yune', characterName: 'Yune' })
    const { corpseId } = JSON.parse(reg.content[0].text)
    const r = await handleCorpseManage(db(), { action: 'psychological_impact', id: corpseId, observerCharacterId: 'obs', multipleCorpses: true, rollValue: 20 })
    expect(JSON.parse(r.content[0].text).dc).toBe(13)
  })

  it('psychological_impact reports a critical fail (break) on a natural 1 regardless of total', async () => {
    const reg = await handleCorpseManage(db(), { action: 'register', characterId: 'yune', characterName: 'Yune' })
    const { corpseId } = JSON.parse(reg.content[0].text)
    const r = await handleCorpseManage(db(), { action: 'psychological_impact', id: corpseId, observerCharacterId: 'obs', rollValue: 1, wisModifier: 100 })
    const body = JSON.parse(r.content[0].text)
    expect(body.criticalFail).toBe(true)
    expect(body.succeeded).toBe(false)
    expect(body.outcome).toBe('break')
  })

  it('psychological_impact reports steady on a clean success', async () => {
    const reg = await handleCorpseManage(db(), { action: 'register', characterId: 'yune', characterName: 'Yune' })
    const { corpseId } = JSON.parse(reg.content[0].text)
    const r = await handleCorpseManage(db(), { action: 'psychological_impact', id: corpseId, observerCharacterId: 'obs', rollValue: 20, wisModifier: 0 })
    const body = JSON.parse(r.content[0].text)
    expect(body.succeeded).toBe(true)
    expect(body.outcome).toBe('steady')
  })

  it('psychological_impact reports shaken (fail by 1-4), disturbed (5-9), and traumatized (10+)', async () => {
    const reg = await handleCorpseManage(db(), { action: 'register', characterId: 'yune', characterName: 'Yune' })
    const { corpseId } = JSON.parse(reg.content[0].text)
    // DC 10 (fresh/stranger). roll 2 + wisModifier 5 = total 7, margin = 3 -> shaken
    const shaken = await handleCorpseManage(db(), { action: 'psychological_impact', id: corpseId, observerCharacterId: 'obs', rollValue: 2, wisModifier: 5 })
    expect(JSON.parse(shaken.content[0].text).outcome).toBe('shaken')
    // roll 2 + wisModifier 2 = total 4, margin = 6 -> disturbed
    const disturbed = await handleCorpseManage(db(), { action: 'psychological_impact', id: corpseId, observerCharacterId: 'obs', rollValue: 2, wisModifier: 2 })
    expect(JSON.parse(disturbed.content[0].text).outcome).toBe('disturbed')
    // roll 2 + wisModifier -10 = total -8, margin = 18 -> traumatized
    const traumatized = await handleCorpseManage(db(), { action: 'psychological_impact', id: corpseId, observerCharacterId: 'obs', rollValue: 2, wisModifier: -10 })
    expect(JSON.parse(traumatized.content[0].text).outcome).toBe('traumatized')
  })

  // ── #288 — tickAllCorpseDecomposition (exported, used by production-manage) ─

  it('tickAllCorpseDecomposition returns an empty array for a world with no corpses', async () => {
    await createWorld()
    const result = await tickAllCorpseDecomposition(env.RPG_DB, WORLD, new Date().toISOString())
    expect(result).toEqual([])
  })

  it('tickAllCorpseDecomposition ticks every non-recovered corpse with a death_at, and skips recovered ones', async () => {
    await createWorld()
    const reg1 = await handleCorpseManage(db(), { action: 'register', characterId: 'a', characterName: 'a', worldId: WORLD, deathAt: new Date(Date.now() - 30 * 3_600_000).toISOString() })
    const corpseId1 = JSON.parse(reg1.content[0].text).corpseId
    const reg2 = await handleCorpseManage(db(), { action: 'register', characterId: 'b', characterName: 'b', worldId: WORLD, deathAt: new Date(Date.now() - 30 * 3_600_000).toISOString() })
    const corpseId2 = JSON.parse(reg2.content[0].text).corpseId
    await handleCorpseManage(db(), { action: 'decompose', id: corpseId2, hoursSinceDeath: 30 })
    await handleCorpseManage(db(), { action: 'recover', id: corpseId2 })

    const result = await tickAllCorpseDecomposition(env.RPG_DB, WORLD, new Date().toISOString())
    expect(result).toHaveLength(1)
    expect(result[0].corpseId).toBe(corpseId1)
    expect(result[0].newStage).toBe('bloat')
  })
})
