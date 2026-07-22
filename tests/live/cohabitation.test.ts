// Live smoke coverage for #315 — co-habitation combat/check stat resolution.
// Covers the two real fixes: drama_manage's physical/mental stat split for a
// co-habitating character, and combat_action's shared-HP-pool redirection for
// apply_damage/heal aimed at a passenger consciousness's own id.
import { describe, it, expect } from 'vitest'
import { MCP_API_KEY, tool, uid } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any) {
  if (res.error) return { error: true, message: res.error.message }
  return JSON.parse(res.result.content[0].text)
}

describe.skipIf(!MCP_API_KEY)('rpg co-habitation stat resolution (#315)', () => {
  it('drama roll_ability: physical from host, mental from active passenger', async () => {
    const hostRes = parseResult(
      await tool('rpg', {
        sub: 'character',
        action: 'create',
        name: `Host Body ${uid()}`,
        stats: { str: 12, dex: 14, con: 20, int: 12, wis: 14, cha: 12 },
      }),
    )
    expect(hostRes.success).toBe(true)
    const hostId = hostRes.characterId

    const passengerRes = parseResult(
      await tool('rpg', {
        sub: 'character',
        action: 'create',
        name: `Passenger ${uid()}`,
        stats: { str: 30, dex: 30, con: 30, int: 20, wis: 6, cha: 18 },
        hostBodyId: hostId,
        active: true,
      }),
    )
    expect(passengerRes.success).toBe(true)

    const strCheck = parseResult(
      await tool('rpg', {
        sub: 'drama',
        action: 'roll_ability',
        character: hostId,
        ability: 'str',
      }),
    )
    expect(strCheck.score).toBe(12) // host's own physical stat, not the passenger's 30

    const chaCheck = parseResult(
      await tool('rpg', {
        sub: 'drama',
        action: 'roll_ability',
        character: hostId,
        ability: 'cha',
      }),
    )
    expect(chaCheck.score).toBe(18) // the active passenger's mental stat, not the host's 12

    await tool('rpg', { sub: 'character', action: 'delete', characterId: passengerRes.characterId })
    await tool('rpg', { sub: 'character', action: 'delete', characterId: hostId })
  })

  it('combat_action apply_damage/heal on a passenger id lands on the shared host HP pool', async () => {
    const hostRes = parseResult(
      await tool('rpg', {
        sub: 'character',
        action: 'create',
        name: `Host HP ${uid()}`,
        hp: 30,
        maxHp: 30,
      }),
    )
    const hostId = hostRes.characterId
    const passengerRes = parseResult(
      await tool('rpg', {
        sub: 'character',
        action: 'create',
        name: `Passenger HP ${uid()}`,
        hp: 30,
        maxHp: 30,
        hostBodyId: hostId,
        active: true,
      }),
    )
    const passengerId = passengerRes.characterId

    const dmgRes = parseResult(
      await tool('rpg', {
        sub: 'combat_action',
        action: 'apply_damage',
        targetIds: [passengerId],
        damage: 10,
      }),
    )
    expect(dmgRes.hpChanges[passengerId]).toBe(-10)

    const hostAfterDmg = parseResult(
      await tool('rpg', { sub: 'character', action: 'get', characterId: hostId }),
    )
    expect(hostAfterDmg.character.hp).toBe(20)

    const healRes = parseResult(
      await tool('rpg', {
        sub: 'combat_action',
        action: 'heal',
        targetIds: [passengerId],
        healAmount: 4,
      }),
    )
    expect(healRes.hpChanges[passengerId]).toBe(4)

    const hostAfterHeal = parseResult(
      await tool('rpg', { sub: 'character', action: 'get', characterId: hostId }),
    )
    expect(hostAfterHeal.character.hp).toBe(24)

    await tool('rpg', { sub: 'character', action: 'delete', characterId: passengerId })
    await tool('rpg', { sub: 'character', action: 'delete', characterId: hostId })
  })

  it('character set_driver/get_driver aliases map onto activate/list_passengers', async () => {
    const hostRes = parseResult(
      await tool('rpg', { sub: 'character', action: 'create', name: `Driver Host ${uid()}` }),
    )
    const hostId = hostRes.characterId
    const passengerRes = parseResult(
      await tool('rpg', {
        sub: 'character',
        action: 'create',
        name: `Driver Passenger ${uid()}`,
        hostBodyId: hostId,
        active: false,
      }),
    )
    const passengerId = passengerRes.characterId

    const setDriverRes = parseResult(
      await tool('rpg', { sub: 'character', action: 'set_driver', characterId: passengerId }),
    )
    expect(setDriverRes.actionType).toBe('activate')
    expect(setDriverRes.hostBodyId).toBe(hostId)

    const getDriverRes = parseResult(
      await tool('rpg', { sub: 'character', action: 'get_driver', hostBodyId: hostId }),
    )
    expect(getDriverRes.actionType).toBe('list_passengers')
    expect(getDriverRes.activeCharacterId).toBe(passengerId)

    await tool('rpg', { sub: 'character', action: 'delete', characterId: passengerId })
    await tool('rpg', { sub: 'character', action: 'delete', characterId: hostId })
  })
})
