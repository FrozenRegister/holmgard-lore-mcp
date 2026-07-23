import { it, expect, beforeEach } from 'vitest'
import { describe, env } from './support/helpers'
import { setupRpgDb } from './support/setup-d1'
import { handleCharacterManage } from '@/rpg/handlers/character-manage'
import type { AppBindings } from '@/types'

// Helper to parse McpResponse
function parseResponse(mcpResponse: any) {
  const text = mcpResponse.content?.[0]?.text
  if (!text) return { error: true, message: 'No text in response' }
  try {
    return JSON.parse(text)
  } catch {
    return { error: true, message: `Failed to parse: ${text}` }
  }
}

async function readKvProjection(testEnv: AppBindings, name: string): Promise<string | null> {
  const key = `character:${name.toLowerCase().replace(/\s+/g, '-')}`
  const raw = await testEnv.LORE_DB!.get(key)
  if (!raw) return null
  return JSON.parse(raw).text
}

describe('Character Co-Habitation (#226 Phase 2)', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  it('create accepts hostBodyId/active directly', async () => {
    const testEnv = env as unknown as AppBindings

    const hostRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'create', name: 'Katerina Sloane' }),
    )
    const hostId = (hostRes as any).characterId

    const passengerRes = parseResponse(
      await handleCharacterManage(testEnv, {
        action: 'create',
        name: 'Bellona Keel',
        hostBodyId: hostId,
        active: false,
      }),
    )
    expect(passengerRes).toHaveProperty('success', true)
    const passengerId = (passengerRes as any).characterId

    const getRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'get', characterId: passengerId }),
    )
    expect((getRes as any).character.host_body_id).toBe(hostId)
    expect((getRes as any).character.active).toBe(0)
  })

  it('update sets hostBodyId/active as a raw single-row PATCH that does not cascade', async () => {
    const testEnv = env as unknown as AppBindings

    const hostRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'create', name: 'Host Body' }),
    )
    const hostId = (hostRes as any).characterId

    const aRes = parseResponse(
      await handleCharacterManage(testEnv, {
        action: 'create',
        name: 'Consciousness A',
        hostBodyId: hostId,
      }),
    )
    const aId = (aRes as any).characterId
    const bRes = parseResponse(
      await handleCharacterManage(testEnv, {
        action: 'create',
        name: 'Consciousness B',
        hostBodyId: hostId,
      }),
    )
    const bId = (bRes as any).characterId

    // Directly PATCH B's active flag off via `update`, not `activate` — should NOT
    // touch A's active state, since only `activate` performs the atomic swap.
    await handleCharacterManage(testEnv, { action: 'update', characterId: bId, active: false })

    const aAfter = parseResponse(
      await handleCharacterManage(testEnv, { action: 'get', characterId: aId }),
    )
    const bAfter = parseResponse(
      await handleCharacterManage(testEnv, { action: 'get', characterId: bId }),
    )
    expect((aAfter as any).character.active).toBe(1)
    expect((bAfter as any).character.active).toBe(0)
  })

  // ── activate ─────────────────────────────────────────────────────────────

  it('activate atomically activates the target and deactivates its siblings', async () => {
    const testEnv = env as unknown as AppBindings

    const hostRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'create', name: 'Katerina Sloane 2' }),
    )
    const hostId = (hostRes as any).characterId

    const cordeliaRes = parseResponse(
      await handleCharacterManage(testEnv, {
        action: 'create',
        name: 'Cordelia Keel 2',
        hostBodyId: hostId,
        active: true,
      }),
    )
    const cordeliaId = (cordeliaRes as any).characterId
    const bellonaRes = parseResponse(
      await handleCharacterManage(testEnv, {
        action: 'create',
        name: 'Bellona Keel 2',
        hostBodyId: hostId,
        active: false,
      }),
    )
    const bellonaId = (bellonaRes as any).characterId

    const activateRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'activate', characterId: bellonaId }),
    )
    expect(activateRes).toHaveProperty('success', true)
    expect((activateRes as any).actionType).toBe('activate')
    expect((activateRes as any).hostBodyId).toBe(hostId)
    expect((activateRes as any).deactivated).toEqual([cordeliaId])

    const cordeliaAfter = parseResponse(
      await handleCharacterManage(testEnv, { action: 'get', characterId: cordeliaId }),
    )
    const bellonaAfter = parseResponse(
      await handleCharacterManage(testEnv, { action: 'get', characterId: bellonaId }),
    )
    expect((cordeliaAfter as any).character.active).toBe(0)
    expect((bellonaAfter as any).character.active).toBe(1)
  })

  it('activate syncs KV projections for the activated character and every deactivated sibling', async () => {
    const testEnv = env as unknown as AppBindings

    const hostRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'create', name: 'Katerina Sloane 3' }),
    )
    const hostId = (hostRes as any).characterId
    const cordeliaRes = parseResponse(
      await handleCharacterManage(testEnv, {
        action: 'create',
        name: 'Cordelia Keel 3',
        hostBodyId: hostId,
        active: true,
      }),
    )
    const cordeliaId = (cordeliaRes as any).characterId
    await handleCharacterManage(testEnv, {
      action: 'create',
      name: 'Bellona Keel 3',
      hostBodyId: hostId,
      active: false,
    })

    await handleCharacterManage(testEnv, { action: 'activate', characterId: cordeliaId })

    const cordeliaProjection = await readKvProjection(testEnv, 'Cordelia Keel 3')
    const bellonaProjection = await readKvProjection(testEnv, 'Bellona Keel 3')
    expect(cordeliaProjection).toContain('**Host-Body:**')
    expect(cordeliaProjection).not.toContain('**Active:** false')
    expect(bellonaProjection).toContain('**Host-Body:**')
    expect(bellonaProjection).toContain('**Active:** false')
  })

  it('activate on a character with no host_body_id is a harmless solo activation', async () => {
    const testEnv = env as unknown as AppBindings

    const soloRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'create', name: 'Solo Character' }),
    )
    const soloId = (soloRes as any).characterId

    const activateRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'activate', characterId: soloId }),
    )
    expect(activateRes).toHaveProperty('success', true)
    expect((activateRes as any).hostBodyId).toBeNull()
    expect((activateRes as any).deactivated).toEqual([])
  })

  it('activate accepts an explicit hostBodyId to assign-and-activate in one call', async () => {
    const testEnv = env as unknown as AppBindings

    const hostRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'create', name: 'Katerina Sloane 4' }),
    )
    const hostId = (hostRes as any).characterId
    // Created with no host_body_id at all
    const freshRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'create', name: 'Fresh Consciousness' }),
    )
    const freshId = (freshRes as any).characterId

    const activateRes = parseResponse(
      await handleCharacterManage(testEnv, {
        action: 'activate',
        characterId: freshId,
        hostBodyId: hostId,
      }),
    )
    expect((activateRes as any).hostBodyId).toBe(hostId)

    const freshAfter = parseResponse(
      await handleCharacterManage(testEnv, { action: 'get', characterId: freshId }),
    )
    expect((freshAfter as any).character.host_body_id).toBe(hostId)
    expect((freshAfter as any).character.active).toBe(1)
  })

  it('activate reassigning to a different host group leaves the old group untouched', async () => {
    const testEnv = env as unknown as AppBindings

    const hostARes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'create', name: 'Host A' }),
    )
    const hostAId = (hostARes as any).characterId
    const hostBRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'create', name: 'Host B' }),
    )
    const hostBId = (hostBRes as any).characterId

    const siblingRes = parseResponse(
      await handleCharacterManage(testEnv, {
        action: 'create',
        name: 'Group A Sibling',
        hostBodyId: hostAId,
        active: true,
      }),
    )
    const siblingId = (siblingRes as any).characterId
    const movingRes = parseResponse(
      await handleCharacterManage(testEnv, {
        action: 'create',
        name: 'Moving Consciousness',
        hostBodyId: hostAId,
        active: false,
      }),
    )
    const movingId = (movingRes as any).characterId

    // Reassign "Moving Consciousness" to Host B instead
    await handleCharacterManage(testEnv, {
      action: 'activate',
      characterId: movingId,
      hostBodyId: hostBId,
    })

    const siblingAfter = parseResponse(
      await handleCharacterManage(testEnv, { action: 'get', characterId: siblingId }),
    )
    // Old group A's sibling is untouched — still active, still on hostA
    expect((siblingAfter as any).character.active).toBe(1)
    expect((siblingAfter as any).character.host_body_id).toBe(hostAId)
  })

  it('activate returns an error for a non-existent character', async () => {
    const testEnv = env as unknown as AppBindings
    const res = parseResponse(
      await handleCharacterManage(testEnv, { action: 'activate', characterId: 'non-existent-id' }),
    )
    expect(res).toHaveProperty('error', true)
    expect((res as any).message).toContain('not found')
  })

  it('activate requires id or characterId', async () => {
    const testEnv = env as unknown as AppBindings
    const res = parseResponse(await handleCharacterManage(testEnv, { action: 'activate' }))
    expect(res).toHaveProperty('error', true)
  })

  it('activate supports switch/take_control/possess aliases', async () => {
    const testEnv = env as unknown as AppBindings
    const soloRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'create', name: 'Alias Test Char' }),
    )
    const soloId = (soloRes as any).characterId

    const switchRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'switch', characterId: soloId }),
    )
    expect((switchRes as any).actionType).toBe('activate')
    const possessRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'possess', characterId: soloId }),
    )
    expect((possessRes as any).actionType).toBe('activate')
  })

  // ── list_passengers ──────────────────────────────────────────────────────

  it('list_passengers lists dormant passengers and the active consciousness via hostBodyId', async () => {
    const testEnv = env as unknown as AppBindings

    const hostRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'create', name: 'Katerina Sloane 5' }),
    )
    const hostId = (hostRes as any).characterId
    const activeRes = parseResponse(
      await handleCharacterManage(testEnv, {
        action: 'create',
        name: 'Active One',
        hostBodyId: hostId,
        active: true,
      }),
    )
    const activeId = (activeRes as any).characterId
    const passengerRes = parseResponse(
      await handleCharacterManage(testEnv, {
        action: 'create',
        name: 'Passenger One',
        hostBodyId: hostId,
        active: false,
      }),
    )
    const passengerId = (passengerRes as any).characterId

    const listRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'list_passengers', hostBodyId: hostId }),
    )
    expect(listRes).toHaveProperty('success', true)
    expect((listRes as any).activeCharacterId).toBe(activeId)
    expect((listRes as any).count).toBe(1)
    expect((listRes as any).passengers.map((p: any) => p.id)).toEqual([passengerId])
  })

  it('list_passengers reports a null active consciousness when nobody in the group is active', async () => {
    const testEnv = env as unknown as AppBindings

    // Deactivating the last active member via `update` (not `activate`) is a
    // real, reachable state — every row sharing a host_body_id can end up with
    // active=0, since `update` deliberately doesn't enforce "at least one active".
    const hostRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'create', name: 'Katerina Sloane 5b' }),
    )
    const hostId = (hostRes as any).characterId
    const oneRes = parseResponse(
      await handleCharacterManage(testEnv, {
        action: 'create',
        name: 'Dormant One',
        hostBodyId: hostId,
        active: true,
      }),
    )
    const oneId = (oneRes as any).characterId
    await handleCharacterManage(testEnv, { action: 'update', characterId: oneId, active: false })

    const listRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'list_passengers', hostBodyId: hostId }),
    )
    expect((listRes as any).activeCharacterId).toBeNull()
    expect((listRes as any).active).toBeNull()
    expect((listRes as any).passengers.map((p: any) => p.id)).toEqual([oneId])
  })

  it('list_passengers resolves hostBodyId from a character id when not passed directly', async () => {
    const testEnv = env as unknown as AppBindings

    const hostRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'create', name: 'Katerina Sloane 6' }),
    )
    const hostId = (hostRes as any).characterId
    const activeRes = parseResponse(
      await handleCharacterManage(testEnv, {
        action: 'create',
        name: 'Active Two',
        hostBodyId: hostId,
        active: true,
      }),
    )
    const activeId = (activeRes as any).characterId
    const passengerRes = parseResponse(
      await handleCharacterManage(testEnv, {
        action: 'create',
        name: 'Passenger Two',
        hostBodyId: hostId,
        active: false,
      }),
    )
    const passengerId = (passengerRes as any).characterId

    const listRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'list_passengers', characterId: passengerId }),
    )
    expect((listRes as any).hostBodyId).toBe(hostId)
    expect((listRes as any).activeCharacterId).toBe(activeId)
    expect((listRes as any).count).toBe(1)
  })

  it('list_passengers returns an empty result for a character with no host_body_id', async () => {
    const testEnv = env as unknown as AppBindings
    const soloRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'create', name: 'No Group Character' }),
    )
    const soloId = (soloRes as any).characterId

    const listRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'list_passengers', characterId: soloId }),
    )
    expect(listRes).toHaveProperty('success', true)
    expect((listRes as any).hostBodyId).toBeNull()
    expect((listRes as any).passengers).toEqual([])
    expect((listRes as any).count).toBe(0)
  })

  it('list_passengers returns an error for a non-existent character', async () => {
    const testEnv = env as unknown as AppBindings
    const res = parseResponse(
      await handleCharacterManage(testEnv, {
        action: 'list_passengers',
        characterId: 'non-existent-id',
      }),
    )
    expect(res).toHaveProperty('error', true)
    expect((res as any).message).toContain('not found')
  })

  it('list_passengers requires hostBodyId or id/characterId', async () => {
    const testEnv = env as unknown as AppBindings
    const res = parseResponse(await handleCharacterManage(testEnv, { action: 'list_passengers' }))
    expect(res).toHaveProperty('error', true)
  })

  it('list_passengers supports passengers/list_dormant/co_habitants aliases', async () => {
    const testEnv = env as unknown as AppBindings
    const soloRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'create', name: 'Alias Passenger Char' }),
    )
    const soloId = (soloRes as any).characterId

    const passengersRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'passengers', characterId: soloId }),
    )
    expect((passengersRes as any).actionType).toBe('list_passengers')
    const dormantRes = parseResponse(
      await handleCharacterManage(testEnv, { action: 'list_dormant', characterId: soloId }),
    )
    expect((dormantRes as any).actionType).toBe('list_passengers')
  })

  it('an ordinary non-co-habitating character has no Host-Body/Active lines in its KV projection', async () => {
    const testEnv = env as unknown as AppBindings
    await handleCharacterManage(testEnv, { action: 'create', name: 'Plain Villager' })
    const projection = await readKvProjection(testEnv, 'Plain Villager')
    expect(projection).not.toContain('**Host-Body:**')
    expect(projection).not.toContain('**Active:**')
  })
})
