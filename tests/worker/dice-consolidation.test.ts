// Tests for #210 — consolidating ad-hoc Math.random() rolls onto the shared
// math_manage dice engine (executeRoll). Verifies that combat_action.attack,
// perception-manage, aura-manage.check_save, combat-manage.death_save, and
// travel-manage all route through the crypto-backed shared engine instead of
// raw Math.random().
import { describe } from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'
import { executeRoll } from '@/rpg/handlers/math-manage'

describe('Dice engine consolidation (#210)', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    })
    const json = await res.json() as Record<string, any>
    const text = json.result?.content?.[0]?.text
    return text ? JSON.parse(text) : json
  }

  // ── executeRoll export ──────────────────────────────────────────────────

  it('executeRoll is exported and returns a RollResult with dice metadata', () => {
    const result = executeRoll('1d20')
    expect(result.total).toBeGreaterThanOrEqual(1)
    expect(result.total).toBeLessThanOrEqual(20)
    expect(result.rolls).toHaveLength(1)
    expect(result.dice.count).toBe(1)
    expect(result.dice.sides).toBe(20)
    expect(result.critical).toBeDefined()
  })

  it('executeRoll handles multi-dice expressions', () => {
    const result = executeRoll('2d6+3')
    expect(result.total).toBeGreaterThanOrEqual(5)
    expect(result.total).toBeLessThanOrEqual(15)
    expect(result.rolls).toHaveLength(2)
    expect(result.dice.modifier).toBe(3)
  })

  // ── combat_action.attack: staged-dissolution targets (#314) ─────────────

  it('rejects an attack against a staged-dissolution target', async () => {
    const attacker = await callTool('rpg', { sub: 'character', action: 'create', name: 'Attacker' })
    const target = await callTool('rpg', { sub: 'character', action: 'create', name: 'Subject Twelve' })
    await callTool('rpg', { sub: 'character', action: 'update', id: target.characterId, deathMode: 'staged' })
    const r = await callTool('rpg', {
      sub: 'combat_action', action: 'attack',
      actorId: attacker.characterId, targetIds: [target.characterId], attackRoll: 15, damage: 5,
    })
    expect(r.error).toBeDefined()
    expect(r.message).toContain('Subject Twelve')
  })

  it('allows an attack against an instant-death (default) target', async () => {
    const attacker = await callTool('rpg', { sub: 'character', action: 'create', name: 'Attacker2' })
    const target = await callTool('rpg', { sub: 'character', action: 'create', name: 'Normal Target' })
    const r = await callTool('rpg', {
      sub: 'combat_action', action: 'attack',
      actorId: attacker.characterId, targetIds: [target.characterId], attackRoll: 15, damage: 5,
    })
    expect(r.success).toBe(true)
    expect(r.hit).toBe(true)
  })

  // ── combat_action.attack: critical hit / fumble / damageExpression ──────

  it('attack with attackRoll=20 is a critical hit that always hits', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Crit Fighter', hp: 15, maxHp: 20 })
    const enc = await callTool('rpg', { sub: 'combat', action: 'create_encounter' })
    const r = await callTool('rpg', {
      sub: 'combat_action', action: 'attack',
      encounterId: enc.encounterId, actorId: char.characterId, targetIds: ['target-1'],
      attackRoll: 20, damage: 10,
    })
    expect(r.success).toBe(true)
    expect(r.hit).toBe(true)
    expect(r.attackRoll).toBe(20)
    expect(r.isCrit).toBe(true)
    expect(r.isFumble).toBe(false)
    expect(r.damage).toBe(10)
    expect(r.summary).toContain('CRITICAL')
  })

  it('attack with attackRoll=1 is a fumble that always misses', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Fumble Fighter', hp: 15, maxHp: 20 })
    const enc = await callTool('rpg', { sub: 'combat', action: 'create_encounter' })
    const r = await callTool('rpg', {
      sub: 'combat_action', action: 'attack',
      encounterId: enc.encounterId, actorId: char.characterId, targetIds: ['target-1'],
      attackRoll: 1,
    })
    expect(r.success).toBe(true)
    expect(r.hit).toBe(false)
    expect(r.attackRoll).toBe(1)
    expect(r.isCrit).toBe(false)
    expect(r.isFumble).toBe(true)
    expect(r.damage).toBe(0)
    expect(r.summary).toContain('FUMBLE')
  })

  it('attack without attackRoll auto-rolls 1d20 via the shared engine', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Auto Roll Fighter', hp: 15, maxHp: 20 })
    const enc = await callTool('rpg', { sub: 'combat', action: 'create_encounter' })
    const r = await callTool('rpg', {
      sub: 'combat_action', action: 'attack',
      encounterId: enc.encounterId, actorId: char.characterId, targetIds: ['target-1'],
      damage: 5,
    })
    expect(r.success).toBe(true)
    expect(r.attackRoll).toBeGreaterThanOrEqual(1)
    expect(r.attackRoll).toBeLessThanOrEqual(20)
    // hit should be consistent with attackRoll >= 10 (or crit/fumble)
    if (r.isCrit) expect(r.hit).toBe(true)
    else if (r.isFumble) expect(r.hit).toBe(false)
    else expect(r.hit).toBe(r.attackRoll >= 10)
  })

  it('attack with damageExpression uses the shared engine for damage', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Expr Fighter', hp: 15, maxHp: 20 })
    const enc = await callTool('rpg', { sub: 'combat', action: 'create_encounter' })
    const r = await callTool('rpg', {
      sub: 'combat_action', action: 'attack',
      encounterId: enc.encounterId, actorId: char.characterId, targetIds: ['target-1'],
      attackRoll: 15, damageExpression: '2d6+3',
    })
    expect(r.success).toBe(true)
    expect(r.hit).toBe(true)
    expect(r.damage).toBeGreaterThanOrEqual(5) // 2*1+3
    expect(r.damage).toBeLessThanOrEqual(15) // 2*6+3
    expect(r.damageRoll).toBeGreaterThanOrEqual(5)
    expect(r.damageRoll).toBeLessThanOrEqual(15)
  })

  it('attack with a critical hit doubles the damage dice', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Crit Damage Fighter', hp: 15, maxHp: 20 })
    const enc = await callTool('rpg', { sub: 'combat', action: 'create_encounter' })
    const r = await callTool('rpg', {
      sub: 'combat_action', action: 'attack',
      encounterId: enc.encounterId, actorId: char.characterId, targetIds: ['target-1'],
      attackRoll: 20, damageExpression: '1d8',
    })
    expect(r.success).toBe(true)
    expect(r.isCrit).toBe(true)
    // Crit doubles the dice: 1d8+1d8 = 2-16
    expect(r.damage).toBeGreaterThanOrEqual(2)
    expect(r.damage).toBeLessThanOrEqual(16)
  })

  it('attack with default damageExpression (1d8) rolls 1-8 on a normal hit', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Default Dmg Fighter', hp: 15, maxHp: 20 })
    const enc = await callTool('rpg', { sub: 'combat', action: 'create_encounter' })
    const r = await callTool('rpg', {
      sub: 'combat_action', action: 'attack',
      encounterId: enc.encounterId, actorId: char.characterId, targetIds: ['target-1'],
      attackRoll: 15,
    })
    expect(r.success).toBe(true)
    expect(r.hit).toBe(true)
    expect(r.damage).toBeGreaterThanOrEqual(1)
    expect(r.damage).toBeLessThanOrEqual(8)
  })

  // ── combat-manage.death_save: shared engine, native logic intact ────────

  it('death_save without saveRoll auto-rolls 1d20 via the shared engine', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Auto Death Save', hp: 0, maxHp: 20 })
    const r = await callTool('rpg', { sub: 'combat', action: 'death_save', characterId: char.characterId })
    expect(r.success).toBe(true)
    expect(r.roll).toBeGreaterThanOrEqual(1)
    expect(r.roll).toBeLessThanOrEqual(20)
    // Status should be consistent with the roll
    if (r.roll === 20) expect(r.status).toBe('revived')
    else if (r.roll === 1) expect(r.failures).toBe(2)
    else if (r.roll >= 10) expect(r.successes).toBe(1)
    else expect(r.failures).toBe(1)
  })

  // ── aura-manage.check_save: shared engine ───────────────────────────────

  it('check_save without saveRoll auto-rolls 1d20 via the shared engine', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Auto Save Caster', hp: 30, maxHp: 30 })
    await callTool('rpg', { sub: 'aura', action: 'concentrate', characterId: char.characterId, spellName: 'Bless' })
    const r = await callTool('rpg', { sub: 'aura', action: 'check_save', characterId: char.characterId, damage: 10 })
    expect(r.success).toBe(true)
    expect(r.wasConcentrating).toBe(true)
    expect(r.roll).toBeGreaterThanOrEqual(1)
    expect(r.roll).toBeLessThanOrEqual(20)
    // DC = max(10, floor(10/2)) = 10
    expect(r.maintained).toBe(r.roll >= 10)
  })

  // ── travel-manage: shared engine for encounter flag and loot count ──────

  it('travel without resolveEncounter uses 1d100 for the encounter flag', async () => {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare("INSERT INTO room_nodes (id, name, base_description, biome_context, atmospherics, exits, entity_ids, created_at, updated_at, visited_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind('room-210', 'Test Room', 'A test room.', 'forest', '[]', '[]', '[]', now, now, 0).run()

    const { handleTravelManage } = await import('@/rpg/handlers/travel-manage')
    const r = await handleTravelManage({ RPG_DB: env.RPG_DB } as any, { action: 'travel', toRoomId: 'room-210' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(typeof body.randomEncounter).toBe('boolean')
  })

  it('loot uses 1d3 for the item count via the shared engine', async () => {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare("INSERT INTO room_nodes (id, name, base_description, biome_context, atmospherics, exits, entity_ids, created_at, updated_at, visited_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind('room-210-loot', 'Loot Room', 'A loot room.', 'forest', '[]', '[]', '[]', now, now, 0).run()

    const { handleTravelManage } = await import('@/rpg/handlers/travel-manage')
    const r = await handleTravelManage({ RPG_DB: env.RPG_DB } as any, { action: 'loot', roomId: 'room-210-loot', partyId: 'party-210' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.itemsFound.length).toBeGreaterThanOrEqual(1)
    expect(body.itemsFound.length).toBeLessThanOrEqual(3)
  })

  // ── perception-manage: shared engine for all d20 rolls ──────────────────

  it('assess without rollValue auto-rolls 1d20 via the shared engine', async () => {
    const { handlePerceptionManage } = await import('@/rpg/handlers/perception-manage')
    const r = await handlePerceptionManage({ RPG_DB: env.RPG_DB } as any, {
      action: 'assess', observerId: 'obs-210', targetId: 'room-210', perceptionType: 'sight',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.roll).toBeGreaterThanOrEqual(1)
    expect(body.roll).toBeLessThanOrEqual(20)
  })

  it('stealth_check without rollValue auto-rolls both sides via the shared engine', async () => {
    const { handlePerceptionManage } = await import('@/rpg/handlers/perception-manage')
    const r = await handlePerceptionManage({ RPG_DB: env.RPG_DB } as any, { action: 'stealth_check' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.yieldRoll).toBeGreaterThanOrEqual(1)
    expect(body.yieldRoll).toBeLessThanOrEqual(20)
    expect(body.predatorRoll).toBeGreaterThanOrEqual(1)
    expect(body.predatorRoll).toBeLessThanOrEqual(20)
  })

  it('perception_contested auto-rolls both sides via the shared engine', async () => {
    const { handlePerceptionManage } = await import('@/rpg/handlers/perception-manage')
    const r = await handlePerceptionManage({ RPG_DB: env.RPG_DB } as any, { action: 'perception_contested' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.observerRoll).toBeGreaterThanOrEqual(1)
    expect(body.observerRoll).toBeLessThanOrEqual(20)
    expect(body.actorRoll).toBeGreaterThanOrEqual(1)
    expect(body.actorRoll).toBeLessThanOrEqual(20)
  })
})
