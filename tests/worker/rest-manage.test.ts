// Tests for rest_manage (long_rest/short_rest) — previously declined as
// out-of-scope in issue #74; implemented per issue #206.
import { describe } from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'

describe('rest_manage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    })
    const json = (await res.json()) as Record<string, any>
    const text = json.result?.content?.[0]?.text
    return text ? JSON.parse(text) : json
  }

  it('long_rest restores HP, spell slots, pact magic, legendary counters, and clears conditions', async () => {
    const char = await callTool('rpg', {
      sub: 'character',
      action: 'create',
      name: 'Weary Adventurer',
      hp: 5,
      maxHp: 30,
    })
    await callTool('rpg', {
      sub: 'character',
      action: 'update',
      characterId: char.characterId,
      conditions: ['exhausted'],
      spellSlots: { '1': { max: 4, current: 0 }, '2': { max: 2, current: 0 } },
      pactMagicSlots: { max: 2, current: 0, level: 1 },
      legendaryActions: 3,
      legendaryActionsRemaining: 0,
      legendaryResistances: 3,
      legendaryResistancesRemaining: 0,
    })

    const r = await callTool('rpg', {
      sub: 'rest',
      action: 'long_rest',
      characterId: char.characterId,
    })
    expect(r.success).toBe(true)

    const got = await callTool('rpg', {
      sub: 'character',
      action: 'get',
      characterId: char.characterId,
    })
    expect(got.character.hp).toBe(30)
    expect(got.character.spell_slots['1'].current).toBe(4)
    expect(got.character.spell_slots['2'].current).toBe(2)
    expect(got.character.pact_magic_slots.current).toBe(2)
    expect(got.character.legendary_actions_remaining).toBe(3)
    expect(got.character.legendary_resistances_remaining).toBe(3)
    expect(got.character.conditions).toEqual([])
  })

  it('long_rest clears accumulated death saves', async () => {
    const char = await callTool('rpg', {
      sub: 'character',
      action: 'create',
      name: 'Near Death',
      hp: 0,
      maxHp: 20,
    })
    await callTool('rpg', {
      sub: 'combat',
      action: 'death_save',
      characterId: char.characterId,
      saveRoll: 12,
    })
    await callTool('rpg', { sub: 'rest', action: 'long_rest', characterId: char.characterId })
    const got = await callTool('rpg', {
      sub: 'character',
      action: 'get',
      characterId: char.characterId,
    })
    expect(got.character.resource_pools.death_saves).toBeUndefined()
  })

  it('short_rest restores pact magic slots but not regular spell slots', async () => {
    const char = await callTool('rpg', {
      sub: 'character',
      action: 'create',
      name: 'Warlock',
      hp: 20,
      maxHp: 20,
    })
    await callTool('rpg', {
      sub: 'character',
      action: 'update',
      characterId: char.characterId,
      spellSlots: { '1': { max: 4, current: 0 } },
      pactMagicSlots: { max: 2, current: 0, level: 1 },
    })
    const r = await callTool('rpg', {
      sub: 'rest',
      action: 'short_rest',
      characterId: char.characterId,
    })
    expect(r.success).toBe(true)
    const got = await callTool('rpg', {
      sub: 'character',
      action: 'get',
      characterId: char.characterId,
    })
    expect(got.character.pact_magic_slots.current).toBe(2)
    expect(got.character.spell_slots['1'].current).toBe(0)
  })

  it('short_rest applies an optional healAmount, capped at max HP', async () => {
    const char = await callTool('rpg', {
      sub: 'character',
      action: 'create',
      name: 'Resting Fighter',
      hp: 5,
      maxHp: 20,
    })
    const r = await callTool('rpg', {
      sub: 'rest',
      action: 'short_rest',
      characterId: char.characterId,
      healAmount: 30,
    })
    expect(r.success).toBe(true)
    const got = await callTool('rpg', {
      sub: 'character',
      action: 'get',
      characterId: char.characterId,
    })
    expect(got.character.hp).toBe(20)
  })

  it('long_rest can rest an entire party via partyId', async () => {
    const world = await callTool('rpg', {
      sub: 'world',
      action: 'create',
      name: 'RestWorld',
      theme: 'fantasy',
    })
    const party = await callTool('rpg', {
      sub: 'party',
      action: 'create',
      name: 'Weary Party',
      worldId: world.worldId,
    })
    const char1 = await callTool('rpg', {
      sub: 'character',
      action: 'create',
      name: 'Member 1',
      hp: 1,
      maxHp: 20,
    })
    const char2 = await callTool('rpg', {
      sub: 'character',
      action: 'create',
      name: 'Member 2',
      hp: 1,
      maxHp: 25,
    })
    await callTool('rpg', {
      sub: 'party',
      action: 'add_member',
      partyId: party.partyId,
      characterId: char1.characterId,
    })
    await callTool('rpg', {
      sub: 'party',
      action: 'add_member',
      partyId: party.partyId,
      characterId: char2.characterId,
    })

    const r = await callTool('rpg', { sub: 'rest', action: 'long_rest', partyId: party.partyId })
    expect(r.characterIds.length).toBe(2)
    const got1 = await callTool('rpg', {
      sub: 'character',
      action: 'get',
      characterId: char1.characterId,
    })
    const got2 = await callTool('rpg', {
      sub: 'character',
      action: 'get',
      characterId: char2.characterId,
    })
    expect(got1.character.hp).toBe(20)
    expect(got2.character.hp).toBe(25)
  })

  it('long_rest requires characterId or partyId and 404s when neither resolves a character', async () => {
    const noTarget = await callTool('rpg', { sub: 'rest', action: 'long_rest' })
    expect(noTarget.error).toBe(true)
    const notFound = await callTool('rpg', {
      sub: 'rest',
      action: 'long_rest',
      characterId: 'nonexistent',
    })
    expect(notFound.error).toBe(true)
  })
})
