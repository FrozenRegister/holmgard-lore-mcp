// Tests for concentration saving throws and spell-slot casting — features ported
// from Mnehmos but previously declined as out-of-scope (issue #74). See issue #206.
import { describe } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'

describe('Concentration checks and spellcasting', () => {
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

  // ── aura_manage: check_save ─────────────────────────────────────────────────

  it('check_save maintains concentration on a roll that meets the DC', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Caster' })
    await callTool('rpg', { sub: 'aura', action: 'concentrate', characterId: char.characterId, spellName: 'Bless' })
    const r = await callTool('rpg', { sub: 'aura', action: 'check_save', characterId: char.characterId, damage: 12, saveRoll: 15 })
    expect(r.wasConcentrating).toBe(true)
    expect(r.dc).toBe(10)
    expect(r.maintained).toBe(true)
  })

  it('check_save breaks concentration on a failed roll and removes concentration-requiring auras', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Fragile Caster' })
    await callTool('rpg', { sub: 'aura', action: 'concentrate', characterId: char.characterId, spellName: 'Hold Person' })
    await callTool('rpg', { sub: 'aura', action: 'create', ownerId: char.characterId, spellName: 'Hold Person', requiresConcentration: true })

    const r = await callTool('rpg', { sub: 'aura', action: 'check_save', characterId: char.characterId, damage: 20, saveRoll: 3 })
    expect(r.dc).toBe(10)
    expect(r.maintained).toBe(false)

    const auras = await callTool('rpg', { sub: 'aura', action: 'list' })
    expect(auras.auras.length).toBe(0)
  })

  it('check_save reports not concentrating when there is nothing active', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Idle' })
    const r = await callTool('rpg', { sub: 'aura', action: 'check_save', characterId: char.characterId, damage: 10 })
    expect(r.wasConcentrating).toBe(false)
  })

  it('check_save requires characterId and damage', async () => {
    const noId = await callTool('rpg', { sub: 'aura', action: 'check_save' })
    expect(noId.error).toBe(true)
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Caster2' })
    await callTool('rpg', { sub: 'aura', action: 'concentrate', characterId: char.characterId, spellName: 'Bless' })
    const noDamage = await callTool('rpg', { sub: 'aura', action: 'check_save', characterId: char.characterId })
    expect(noDamage.error).toBe(true)
  })

  // ── aura_manage: check_duration ──────────────────────────────────────────────

  it('check_duration reports concentrating with remaining time when not expired', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Long Caster' })
    await callTool('rpg', { sub: 'aura', action: 'concentrate', characterId: char.characterId, spellName: 'Haste', maxDuration: 600_000 })
    const r = await callTool('rpg', { sub: 'aura', action: 'check_duration', characterId: char.characterId })
    expect(r.concentrating).toBe(true)
    expect(r.remainingMs).toBeGreaterThan(0)
  })

  it('check_duration expires and breaks concentration once max_duration has elapsed', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Expired Caster' })
    await callTool('rpg', { sub: 'aura', action: 'concentrate', characterId: char.characterId, spellName: 'Haste', maxDuration: 1 })
    await new Promise(resolve => setTimeout(resolve, 5))
    const r = await callTool('rpg', { sub: 'aura', action: 'check_duration', characterId: char.characterId })
    expect(r.concentrating).toBe(false)
    expect(r.expired).toBe(true)
  })

  it('check_duration reports not concentrating when nothing is active, and requires characterId', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Nobody' })
    const r = await callTool('rpg', { sub: 'aura', action: 'check_duration', characterId: char.characterId })
    expect(r.concentrating).toBe(false)
    const noId = await callTool('rpg', { sub: 'aura', action: 'check_duration' })
    expect(noId.error).toBe(true)
  })

  // ── character_manage: search ─────────────────────────────────────────────────

  it('search finds characters by a name substring', async () => {
    await callTool('rpg', { sub: 'character', action: 'create', name: 'Aragorn' })
    await callTool('rpg', { sub: 'character', action: 'create', name: 'Legolas' })
    const r = await callTool('rpg', { sub: 'character', action: 'search', query: 'agor' })
    expect(r.characters.some((c: any) => c.name === 'Aragorn')).toBe(true)
    expect(r.characters.some((c: any) => c.name === 'Legolas')).toBe(false)
  })

  it('search requires a query', async () => {
    const r = await callTool('rpg', { sub: 'character', action: 'search' })
    expect(r.error).toBe(true)
  })

  // ── character_manage: update wires up spell/condition/legendary fields ──────

  it('update persists conditions, resistances, spell slots, and legendary fields', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Fully Loaded' })
    await callTool('rpg', {
      sub: 'character', action: 'update', characterId: char.characterId,
      conditions: ['poisoned'], resistances: ['fire'], vulnerabilities: ['cold'], immunities: ['poison'],
      spellSlots: { '1': { max: 4, current: 4 } }, pactMagicSlots: { max: 2, current: 2, level: 1 },
      knownSpells: ['Magic Missile'], preparedSpells: ['Magic Missile'], cantripsKnown: ['Fire Bolt'],
      maxSpellLevel: 1, legendaryActions: 3, legendaryActionsRemaining: 3,
      legendaryResistances: 2, legendaryResistancesRemaining: 2, hasLairActions: true,
      resourcePools: { ki: 4 }, currency: { gold: 50 },
    })
    const got = await callTool('rpg', { sub: 'character', action: 'get', characterId: char.characterId })
    expect(got.character.conditions).toEqual(['poisoned'])
    expect(got.character.resistances).toEqual(['fire'])
    expect(got.character.spell_slots).toBeTruthy()
    expect(got.character.legendary_actions).toBe(3)
    expect(got.character.has_lair_actions).toBe(1)
    expect(got.character.resource_pools).toEqual({ ki: 4 })
    expect(got.character.currency).toEqual({ gold: 50 })
  })

  // ── character_manage: cast_spell ─────────────────────────────────────────────

  it('cast_spell consumes a leveled spell slot for a known/prepared spell', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Wizard' })
    await callTool('rpg', { sub: 'character', action: 'update', characterId: char.characterId, knownSpells: ['Magic Missile'], spellSlots: { '1': { max: 4, current: 4 } } })
    const r = await callTool('rpg', { sub: 'character', action: 'cast_spell', characterId: char.characterId, spellName: 'Magic Missile', slotLevel: 1 })
    expect(r.success).toBe(true)
    expect(r.remainingSlots['1'].current).toBe(3)
  })

  it('cast_spell casts a cantrip without consuming any slot', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Cantrip Caster' })
    await callTool('rpg', { sub: 'character', action: 'update', characterId: char.characterId, cantripsKnown: ['Fire Bolt'] })
    const r = await callTool('rpg', { sub: 'character', action: 'cast_spell', characterId: char.characterId, spellName: 'Fire Bolt' })
    expect(r.success).toBe(true)
    expect(r.isCantrip).toBe(true)
    expect(r.remainingSlots).toBe(null)
  })

  it('cast_spell blocks casting a spell the character does not know (anti-hallucination check)', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'No Spells' })
    const r = await callTool('rpg', { sub: 'character', action: 'cast_spell', characterId: char.characterId, spellName: 'Wish', slotLevel: 9 })
    expect(r.error).toBe(true)
  })

  it('cast_spell blocks casting when no slots remain at the requested level', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Out of Slots' })
    await callTool('rpg', { sub: 'character', action: 'update', characterId: char.characterId, knownSpells: ['Shield'], spellSlots: { '1': { max: 4, current: 0 } } })
    const r = await callTool('rpg', { sub: 'character', action: 'cast_spell', characterId: char.characterId, spellName: 'Shield', slotLevel: 1 })
    expect(r.error).toBe(true)
  })

  it('cast_spell requires slotLevel for a non-cantrip spell', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Ambiguous Caster' })
    await callTool('rpg', { sub: 'character', action: 'update', characterId: char.characterId, knownSpells: ['Shield'], spellSlots: { '1': { max: 4, current: 4 } } })
    const r = await callTool('rpg', { sub: 'character', action: 'cast_spell', characterId: char.characterId, spellName: 'Shield' })
    expect(r.error).toBe(true)
  })

  it('cast_spell consumes a pact magic slot when usePactMagic is set', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Warlock' })
    await callTool('rpg', { sub: 'character', action: 'update', characterId: char.characterId, knownSpells: ['Eldritch Blast'], pactMagicSlots: { max: 2, current: 2, level: 1 } })
    const r = await callTool('rpg', { sub: 'character', action: 'cast_spell', characterId: char.characterId, spellName: 'Eldritch Blast', usePactMagic: true })
    expect(r.success).toBe(true)
    expect(r.remainingSlots.current).toBe(1)
  })

  it('cast_spell blocks casting when no pact magic slots remain', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Spent Warlock' })
    await callTool('rpg', { sub: 'character', action: 'update', characterId: char.characterId, knownSpells: ['Eldritch Blast'], pactMagicSlots: { max: 2, current: 0, level: 1 } })
    const r = await callTool('rpg', { sub: 'character', action: 'cast_spell', characterId: char.characterId, spellName: 'Eldritch Blast', usePactMagic: true })
    expect(r.error).toBe(true)
  })

  it('cast_spell sets up concentration when requiresConcentration is true, replacing any prior concentration', async () => {
    const char = await callTool('rpg', { sub: 'character', action: 'create', name: 'Concentrating Wizard' })
    await callTool('rpg', { sub: 'character', action: 'update', characterId: char.characterId, knownSpells: ['Bless', 'Hold Person'], spellSlots: { '1': { max: 4, current: 4 }, '2': { max: 3, current: 3 } } })
    await callTool('rpg', { sub: 'character', action: 'cast_spell', characterId: char.characterId, spellName: 'Bless', slotLevel: 1, requiresConcentration: true })
    const r = await callTool('rpg', { sub: 'character', action: 'cast_spell', characterId: char.characterId, spellName: 'Hold Person', slotLevel: 2, requiresConcentration: true })
    expect(r.concentrating).toBe(true)
    const got = await callTool('rpg', { sub: 'character', action: 'get', characterId: char.characterId })
    expect(got.character.concentrating_on).toBe('Hold Person')
  })

  it('cast_spell requires characterId and spellName, and 404s for an unknown character', async () => {
    const noArgs = await callTool('rpg', { sub: 'character', action: 'cast_spell' })
    expect(noArgs.error).toBe(true)
    const notFound = await callTool('rpg', { sub: 'character', action: 'cast_spell', characterId: 'nonexistent', spellName: 'Anything' })
    expect(notFound.error).toBe(true)
  })
})
