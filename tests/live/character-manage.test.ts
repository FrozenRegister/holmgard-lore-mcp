// Live smoke coverage for character_manage's co-habitation surface (#226 Phase 2).
// This tool previously had zero live coverage at all — scoped here to only the
// new hostBodyId/active/activate/list_passengers surface added by this change,
// not a full backfill of character_manage's pre-existing actions (create/update/
// add_xp/level_up/etc.), which is a separate, larger gap.
import { describe, it, expect, afterEach } from 'vitest'
import { MCP_API_KEY, tool, uid } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any) {
  if (res.error) return { error: true, message: res.error.message }
  return JSON.parse(res.result.content[0].text)
}

describe.skipIf(!MCP_API_KEY)('character_manage co-habitation', () => {
  const createdIds: string[] = []

  async function createChar(args: Record<string, unknown>): Promise<string> {
    const res = parseResult(await tool('character_manage', { action: 'create', ...args }))
    expect(res.success).toBe(true)
    createdIds.push(res.characterId)
    return res.characterId
  }

  afterEach(async () => {
    await Promise.all(
      createdIds
        .splice(0)
        .map((id) => tool('character_manage', { action: 'delete', characterId: id })),
    )
  })

  it('create accepts hostBodyId/active and get reflects them', async () => {
    const hostId = await createChar({ name: `Host ${uid()}` })
    const passengerId = await createChar({
      name: `Passenger ${uid()}`,
      hostBodyId: hostId,
      active: false,
    })

    const getRes = parseResult(
      await tool('character_manage', { action: 'get', characterId: passengerId }),
    )
    expect(getRes.character.host_body_id).toBe(hostId)
    expect(getRes.character.active).toBe(0)
  })

  it('activate atomically switches which consciousness is active', async () => {
    const hostId = await createChar({ name: `Host ${uid()}` })
    const cordeliaId = await createChar({
      name: `Cordelia ${uid()}`,
      hostBodyId: hostId,
      active: true,
    })
    const bellonaId = await createChar({
      name: `Bellona ${uid()}`,
      hostBodyId: hostId,
      active: false,
    })

    const activateRes = parseResult(
      await tool('character_manage', { action: 'activate', characterId: bellonaId }),
    )
    expect(activateRes.success).toBe(true)
    expect(activateRes.deactivated).toEqual([cordeliaId])

    const cordeliaAfter = parseResult(
      await tool('character_manage', { action: 'get', characterId: cordeliaId }),
    )
    const bellonaAfter = parseResult(
      await tool('character_manage', { action: 'get', characterId: bellonaId }),
    )
    expect(cordeliaAfter.character.active).toBe(0)
    expect(bellonaAfter.character.active).toBe(1)
  })

  it('list_passengers reports the active consciousness and dormant passengers', async () => {
    const hostId = await createChar({ name: `Host ${uid()}` })
    const activeId = await createChar({ name: `Active ${uid()}`, hostBodyId: hostId, active: true })
    const passengerId = await createChar({
      name: `Passenger ${uid()}`,
      hostBodyId: hostId,
      active: false,
    })

    const listRes = parseResult(
      await tool('character_manage', { action: 'list_passengers', hostBodyId: hostId }),
    )
    expect(listRes.success).toBe(true)
    expect(listRes.activeCharacterId).toBe(activeId)
    expect(listRes.passengers.map((p: { id: string }) => p.id)).toEqual([passengerId])
  })

  it('list includes the born field (#302)', async () => {
    const bornId = await createChar({ name: `Born ${uid()}`, born: '2166-03-10' })

    const listRes = parseResult(await tool('character_manage', { action: 'list', limit: 200 }))
    expect(listRes.success).toBe(true)
    const found = listRes.characters.find((c: { id: string }) => c.id === bornId)
    expect(found.born).toBe('2166-03-10')
  })

  it('get retrieves a character by exact name (#309)', async () => {
    const name = `Unique Name ${uid()}`
    const charId = await createChar({ name })

    const getRes = parseResult(await tool('character_manage', { action: 'get', name }))
    expect(getRes.success).toBe(true)
    expect(getRes.character.id).toBe(charId)
  })

  it('get by name with duplicates returns a warning and both matches (#309)', async () => {
    const name = `Duplicate Name ${uid()}`
    const id1 = await createChar({ name })
    const id2 = await createChar({ name })

    const getRes = parseResult(await tool('character_manage', { action: 'get', name }))
    expect(getRes.error).toBe(true)
    expect(getRes.message).toContain('Multiple characters')
    const ids = getRes.characters.map((c: { id: string }) => c.id)
    expect(ids).toContain(id1)
    expect(ids).toContain(id2)
  })

  it('recompute_derived recalculates ac/perception_bonus/stealth_bonus from stats (#266)', async () => {
    const charId = await createChar({
      name: `Recompute ${uid()}`,
      stats: { str: 10, dex: 12, con: 10, int: 10, wis: 16, cha: 10 },
      ac: 999,
      perceptionBonus: 999,
      stealthBonus: 999,
    })

    const recomputeRes = parseResult(
      await tool('character_manage', { action: 'recompute_derived', characterId: charId }),
    )
    expect(recomputeRes.success).toBe(true)
    expect(recomputeRes.charactersUpdated).toBe(1)

    const getRes = parseResult(
      await tool('character_manage', { action: 'get', characterId: charId }),
    )
    expect(getRes.character.ac).toBe(11) // 10 + (12-10)/2
    expect(getRes.character.perception_bonus).toBe(3) // (16-10)/2
    expect(getRes.character.stealth_bonus).toBe(1) // (12-10)/2
  })

  it('move_to_location and move_to_tile set position independently, dual-mode (#313)', async () => {
    const charId = await createChar({ name: `Mover ${uid()}` })

    const locRes = parseResult(
      await tool('character_manage', {
        action: 'move_to_location',
        characterId: charId,
        locationKey: 'location:linwood-estate',
      }),
    )
    expect(locRes.success).toBe(true)

    const tileRes = parseResult(
      await tool('character_manage', { action: 'move_to_tile', characterId: charId, q: 52, r: 28 }),
    )
    expect(tileRes.success).toBe(true)
    expect(tileRes.mapId).toBe('main')

    const getRes = parseResult(
      await tool('character_manage', { action: 'get', characterId: charId }),
    )
    expect(getRes.character.location_key).toBe('location:linwood-estate')
    expect(getRes.character.current_hex_q).toBe(52)
    expect(getRes.character.current_hex_r).toBe(28)
  })

  it('create defaults death_mode to instant, update sets staged dissolution fields (#314)', async () => {
    const charId = await createChar({ name: `Dissolving ${uid()}` })

    const defaultRes = parseResult(
      await tool('character_manage', { action: 'get', characterId: charId }),
    )
    expect(defaultRes.character.death_mode).toBe('instant')

    const updateRes = parseResult(
      await tool('character_manage', {
        action: 'update',
        characterId: charId,
        deathMode: 'staged',
        dissolutionStage: 2,
        dissolutionStages: 5,
        dissolutionTerminal: 'consumed',
      }),
    )
    expect(updateRes.success).toBe(true)

    const getRes = parseResult(
      await tool('character_manage', { action: 'get', characterId: charId }),
    )
    expect(getRes.character.death_mode).toBe('staged')
    expect(getRes.character.dissolution_stage).toBe(2)
    expect(getRes.character.dissolution_stages).toBe(5)
    expect(getRes.character.dissolution_terminal).toBe('consumed')
  })

  it('combat_action.attack rejects a staged-dissolution target (#314)', async () => {
    const attackerId = await createChar({ name: `Attacker ${uid()}` })
    const targetId = await createChar({ name: `StagedTarget ${uid()}` })
    await tool('character_manage', { action: 'update', characterId: targetId, deathMode: 'staged' })

    const attackRes = parseResult(
      await tool('rpg', {
        sub: 'combat_action',
        action: 'attack',
        actorId: attackerId,
        targetIds: [targetId],
        attackRoll: 15,
        damage: 5,
      }),
    )
    expect(attackRes.error).toBe(true)
    expect(attackRes.message).toContain('staged-dissolution')
  })

  it('kill removes the dead character from their party and archives it once empty (#398)', async () => {
    const worldRes = parseResult(
      await tool('rpg', {
        sub: 'world',
        action: 'create',
        name: `Kill Party World ${uid()}`,
        theme: 'fantasy',
      }),
    )
    const worldId = worldRes.worldId
    const partyRes = parseResult(
      await tool('rpg', { sub: 'party', action: 'create', name: `Solo Party ${uid()}`, worldId }),
    )
    const partyId = partyRes.partyId
    const doomedId = await createChar({ name: `Last One ${uid()}` })
    await tool('rpg', { sub: 'party', action: 'add_member', partyId, characterId: doomedId })

    const killRes = parseResult(await tool('character_manage', { action: 'kill', id: doomedId }))
    expect(killRes.success).toBe(true)
    expect(killRes.partyUpdates).toEqual([
      { partyId, remainingMembers: 0, archived: true, soloSurvivorId: null },
    ])

    const partyAfter = parseResult(await tool('rpg', { sub: 'party', action: 'get', partyId }))
    expect(partyAfter.party.status).toBe('archived')
  })
})
