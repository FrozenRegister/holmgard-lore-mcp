// Tests for combat-depth features ported from Mnehmos but previously declined as
// out-of-scope (issue #74) — death saves, legendary/lair actions, combat reactions,
// and resistance/vulnerability/immunity-aware damage. See issue #206.
import { describe } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'

describe('Combat depth', () => {
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

  // ── death_save ─────────────────────────────────────────────────────────────

  it('death_save: a roll of 20 revives the character at 1 HP', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Downed Hero', hp: 0, maxHp: 20 })
    const r = await callTool('rpg', { sub: 'combat', action: 'death_save', characterId: char.characterId, saveRoll: 20 })
    expect(r.success).toBe(true)
    expect(r.status).toBe('revived')
    expect(r.hp).toBe(1)
  })

  it('death_save: three failures (rolls < 10) result in death', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Dying Hero', hp: 0, maxHp: 20 })
    await callTool('rpg', { sub: 'combat', action: 'death_save', characterId: char.characterId, saveRoll: 5 })
    await callTool('rpg', { sub: 'combat', action: 'death_save', characterId: char.characterId, saveRoll: 8 })
    const r = await callTool('rpg', { sub: 'combat', action: 'death_save', characterId: char.characterId, saveRoll: 3 })
    expect(r.status).toBe('dead')
  })

  it('death_save: three successes (rolls >= 10) stabilize the character', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Stabilizing Hero', hp: 0, maxHp: 20 })
    await callTool('rpg', { sub: 'combat', action: 'death_save', characterId: char.characterId, saveRoll: 15 })
    await callTool('rpg', { sub: 'combat', action: 'death_save', characterId: char.characterId, saveRoll: 12 })
    const r = await callTool('rpg', { sub: 'combat', action: 'death_save', characterId: char.characterId, saveRoll: 10 })
    expect(r.status).toBe('stable')
    expect(r.successes).toBe(3)
  })

  it('death_save: a roll of 1 counts as two failures', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Crit-Fail Hero', hp: 0, maxHp: 20 })
    const r = await callTool('rpg', { sub: 'combat', action: 'death_save', characterId: char.characterId, saveRoll: 1 })
    expect(r.failures).toBe(2)
    expect(r.status).toBe('dying')
  })

  it('death_save rejects a character above 0 HP', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Healthy Hero', hp: 10, maxHp: 20 })
    const r = await callTool('rpg', { sub: 'combat', action: 'death_save', characterId: char.characterId, saveRoll: 15 })
    expect(r.error).toBe(true)
  })

  it('death_save requires characterId and 404s for unknown character', async () => {
    const noId = await callTool('rpg', { sub: 'combat', action: 'death_save' })
    expect(noId.error).toBe(true)
    const notFound = await callTool('rpg', { sub: 'combat', action: 'death_save', characterId: 'nonexistent' })
    expect(notFound.error).toBe(true)
  })

  // ── legendary_action ─────────────────────────────────────────────────────────

  it('legendary_action consumes remaining legendary actions and rejects when exhausted', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Ancient Dragon', hp: 200, maxHp: 200 })
    await env.RPG_DB.prepare('UPDATE characters SET legendary_actions = 3 WHERE id = ?').bind(char.characterId).run()

    const r1 = await callTool('rpg', { sub: 'combat', action: 'legendary_action', characterId: char.characterId, actionName: 'Tail Attack' })
    expect(r1.success).toBe(true)
    expect(r1.remaining).toBe(2)

    await callTool('rpg', { sub: 'combat', action: 'legendary_action', characterId: char.characterId, cost: 2 })
    const exhausted = await callTool('rpg', { sub: 'combat', action: 'legendary_action', characterId: char.characterId })
    expect(exhausted.error).toBe(true)
  })

  it('legendary_action rejects a character with no legendary actions', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Commoner' })
    const r = await callTool('rpg', { sub: 'combat', action: 'legendary_action', characterId: char.characterId })
    expect(r.error).toBe(true)
  })

  it('legendary_action requires characterId and 404s for unknown character', async () => {
    const noId = await callTool('rpg', { sub: 'combat', action: 'legendary_action' })
    expect(noId.error).toBe(true)
    const notFound = await callTool('rpg', { sub: 'combat', action: 'legendary_action', characterId: 'nonexistent' })
    expect(notFound.error).toBe(true)
  })

  // ── lair_action ────────────────────────────────────────────────────────────

  it('lair_action triggers for a creature with has_lair_actions and logs to an encounter', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Lich', hp: 150, maxHp: 150 })
    await env.RPG_DB.prepare('UPDATE characters SET has_lair_actions = 1 WHERE id = ?').bind(char.characterId).run()
    const enc = await callTool('rpg', { sub: 'combat', action: 'create_encounter' })

    const r = await callTool('rpg', { sub: 'combat', action: 'lair_action', characterId: char.characterId, encounterId: enc.encounterId, actionName: 'The floor becomes difficult terrain' })
    expect(r.success).toBe(true)

    const log = await callTool('rpg', { sub: 'combat_action', action: 'get_log', encounterId: enc.encounterId })
    expect(log.log.some((e: any) => e.action_type === 'lair_action')).toBe(true)
  })

  it('lair_action rejects a creature without has_lair_actions and requires characterId', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Goblin' })
    const noLair = await callTool('rpg', { sub: 'combat', action: 'lair_action', characterId: char.characterId })
    expect(noLair.error).toBe(true)
    const noId = await callTool('rpg', { sub: 'combat', action: 'lair_action' })
    expect(noId.error).toBe(true)
    const notFound = await callTool('rpg', { sub: 'combat', action: 'lair_action', characterId: 'nonexistent' })
    expect(notFound.error).toBe(true)
  })

  // ── combat_action reactions: dash, dodge, disengage, help, ready ────────────

  it('dash logs the action', async () => {
    const enc = await callTool('rpg', { sub: 'combat', action: 'create_encounter' })
    const r = await callTool('rpg', { sub: 'combat_action', action: 'dash', encounterId: enc.encounterId, actorId: 'hero-1', actorName: 'Hero' })
    expect(r.success).toBe(true)
    expect(r.summary).toContain('Dash')
  })

  it('dash requires actorId', async () => {
    const r = await callTool('rpg', { sub: 'combat_action', action: 'dash' })
    expect(r.error).toBe(true)
  })

  it('dodge sets the dodging condition on the actor', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Dodger' })
    await callTool('rpg', { sub: 'combat_action', action: 'dodge', actorId: char.characterId, actorName: 'Dodger' })
    const got = await callTool('rpg', { sub: 'character', action: 'get', characterId: char.characterId })
    expect(got.character.conditions).toContain('dodging')
  })

  it('dodge requires actorId', async () => {
    const r = await callTool('rpg', { sub: 'combat_action', action: 'dodge' })
    expect(r.error).toBe(true)
  })

  it('disengage sets the disengaged condition on the actor', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Retreater' })
    await callTool('rpg', { sub: 'combat_action', action: 'disengage', actorId: char.characterId })
    const got = await callTool('rpg', { sub: 'character', action: 'get', characterId: char.characterId })
    expect(got.character.conditions).toContain('disengaged')
  })

  it('disengage requires actorId', async () => {
    const r = await callTool('rpg', { sub: 'combat_action', action: 'disengage' })
    expect(r.error).toBe(true)
  })

  it('help sets the helped condition on the target(s)', async () => {
    const helper = await callTool('rpg', { sub: 'character', action: 'create', name: 'Helper' })
    const ally = await callTool('rpg', { sub: 'character', action: 'create', name: 'Ally' })
    await callTool('rpg', { sub: 'combat_action', action: 'help', actorId: helper.characterId, targetIds: [ally.characterId] })
    const got = await callTool('rpg', { sub: 'character', action: 'get', characterId: ally.characterId })
    expect(got.character.conditions).toContain('helped')
  })

  it('help requires actorId and targetIds', async () => {
    const r = await callTool('rpg', { sub: 'combat_action', action: 'help' })
    expect(r.error).toBe(true)
  })

  it('ready sets the readying condition and logs the trigger', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Sentinel' })
    const enc = await callTool('rpg', { sub: 'combat', action: 'create_encounter' })
    const r = await callTool('rpg', { sub: 'combat_action', action: 'ready', encounterId: enc.encounterId, actorId: char.characterId, description: 'Attack the first enemy that enters the doorway' })
    expect(r.success).toBe(true)
    expect(r.trigger).toContain('doorway')
    const got = await callTool('rpg', { sub: 'character', action: 'get', characterId: char.characterId })
    expect(got.character.conditions).toContain('readying')
  })

  it('ready requires actorId and description', async () => {
    const r = await callTool('rpg', { sub: 'combat_action', action: 'ready' })
    expect(r.error).toBe(true)
  })

  // ── apply_damage: resistance / vulnerability / immunity ─────────────────────

  it('apply_damage halves damage of a resisted type', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Fire Resistant', hp: 20, maxHp: 20 })
    await env.RPG_DB.prepare('UPDATE characters SET resistances = ? WHERE id = ?').bind(JSON.stringify(['fire']), char.characterId).run()
    const r = await callTool('rpg', { sub: 'combat_action', action: 'apply_damage', targetIds: [char.characterId], damage: 10, damageType: 'fire' })
    expect(r.hpChanges[char.characterId]).toBe(-5)
  })

  it('apply_damage zeroes damage of an immune type', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Poison Immune', hp: 20, maxHp: 20 })
    await env.RPG_DB.prepare('UPDATE characters SET immunities = ? WHERE id = ?').bind(JSON.stringify(['poison']), char.characterId).run()
    const r = await callTool('rpg', { sub: 'combat_action', action: 'apply_damage', targetIds: [char.characterId], damage: 10, damageType: 'poison' })
    expect(r.hpChanges[char.characterId]).toBe(0)
  })

  it('apply_damage doubles damage of a vulnerable type', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Cold Vulnerable', hp: 20, maxHp: 20 })
    await env.RPG_DB.prepare('UPDATE characters SET vulnerabilities = ? WHERE id = ?').bind(JSON.stringify(['cold']), char.characterId).run()
    const r = await callTool('rpg', { sub: 'combat_action', action: 'apply_damage', targetIds: [char.characterId], damage: 6, damageType: 'cold' })
    expect(r.hpChanges[char.characterId]).toBe(-12)
  })

  it('apply_damage applies unmodified damage when no damageType is given', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Plain Target', hp: 20, maxHp: 20 })
    const r = await callTool('rpg', { sub: 'combat_action', action: 'apply_damage', targetIds: [char.characterId], damage: 7 })
    expect(r.hpChanges[char.characterId]).toBe(-7)
  })

  it('apply_damage flags a concentration check when a concentrating character takes damage', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Concentrating Caster', hp: 30, maxHp: 30 })
    await env.RPG_DB.prepare('UPDATE characters SET concentrating_on = ? WHERE id = ?').bind('Bless', char.characterId).run()
    const r = await callTool('rpg', { sub: 'combat_action', action: 'apply_damage', targetIds: [char.characterId], damage: 12 })
    expect(r.concentrationChecks[char.characterId]).toBe(10)
  })

  it('apply_damage omits a concentration check when the target is not concentrating', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Non-Caster', hp: 30, maxHp: 30 })
    const r = await callTool('rpg', { sub: 'combat_action', action: 'apply_damage', targetIds: [char.characterId], damage: 12 })
    expect(r.concentrationChecks[char.characterId]).toBeUndefined()
  })

  // ── #315 — co-habitating targets share one HP pool on the host body ─────────

  it('apply_damage aimed at a passenger consciousness lands on the shared host body HP, not a separate field', async () => {
    const host = await callTool('rpg', { sub: 'character', action: 'create', name: 'Host Body', hp: 30, maxHp: 30 })
    const passenger = await callTool('rpg', {
      sub: 'character', action: 'create', name: 'Passenger Consciousness', hp: 30, maxHp: 30,
      hostBodyId: host.characterId, active: true,
    })

    const r = await callTool('rpg', { sub: 'combat_action', action: 'apply_damage', targetIds: [passenger.characterId], damage: 12 })
    expect(r.hpChanges[passenger.characterId]).toBe(-12)

    const hostAfter = await callTool('rpg', { sub: 'character', action: 'get', characterId: host.characterId })
    const passengerAfter = await callTool('rpg', { sub: 'character', action: 'get', characterId: passenger.characterId })
    expect(hostAfter.character.hp).toBe(18)
    // The passenger's own hp column is untouched — the damage never lands there.
    expect(passengerAfter.character.hp).toBe(30)
  })

  it('heal aimed at a passenger consciousness restores the shared host body HP, not a separate field', async () => {
    const host = await callTool('rpg', { sub: 'character', action: 'create', name: 'Host Body 2', hp: 10, maxHp: 30 })
    const passenger = await callTool('rpg', {
      sub: 'character', action: 'create', name: 'Passenger Consciousness 2', hp: 10, maxHp: 30,
      hostBodyId: host.characterId, active: false,
    })

    const r = await callTool('rpg', { sub: 'combat_action', action: 'heal', targetIds: [passenger.characterId], healAmount: 5 })
    expect(r.hpChanges[passenger.characterId]).toBe(5)

    const hostAfter = await callTool('rpg', { sub: 'character', action: 'get', characterId: host.characterId })
    const passengerAfter = await callTool('rpg', { sub: 'character', action: 'get', characterId: passenger.characterId })
    expect(hostAfter.character.hp).toBe(15)
    expect(passengerAfter.character.hp).toBe(10)
  })

  it('apply_damage/heal against a nonexistent targetId are a harmless no-op', async () => {
    const dmgRes = await callTool('rpg', { sub: 'combat_action', action: 'apply_damage', targetIds: ['no-such-character'], damage: 5 })
    expect(dmgRes.hpChanges).toEqual({})
    const healRes = await callTool('rpg', { sub: 'combat_action', action: 'heal', targetIds: ['no-such-character'], healAmount: 5 })
    expect(healRes.hpChanges).toEqual({})
  })

  it('apply_damage/heal on a solo (non-co-habitating) character are unaffected', async () => {
    const solo = await callTool('rpg', { sub: 'character', action: 'create', name: 'Solo Fighter', hp: 20, maxHp: 20 })
    const dmgRes = await callTool('rpg', { sub: 'combat_action', action: 'apply_damage', targetIds: [solo.characterId], damage: 5 })
    expect(dmgRes.hpChanges[solo.characterId]).toBe(-5)
    const healRes = await callTool('rpg', { sub: 'combat_action', action: 'heal', targetIds: [solo.characterId], healAmount: 2 })
    expect(healRes.hpChanges[solo.characterId]).toBe(2)
  })
})
