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
    await Promise.all(createdIds.splice(0).map(id => tool('character_manage', { action: 'delete', characterId: id })))
  })

  it('create accepts hostBodyId/active and get reflects them', async () => {
    const hostId = await createChar({ name: `Host ${uid()}` })
    const passengerId = await createChar({ name: `Passenger ${uid()}`, hostBodyId: hostId, active: false })

    const getRes = parseResult(await tool('character_manage', { action: 'get', characterId: passengerId }))
    expect(getRes.character.host_body_id).toBe(hostId)
    expect(getRes.character.active).toBe(0)
  })

  it('activate atomically switches which consciousness is active', async () => {
    const hostId = await createChar({ name: `Host ${uid()}` })
    const cordeliaId = await createChar({ name: `Cordelia ${uid()}`, hostBodyId: hostId, active: true })
    const bellonaId = await createChar({ name: `Bellona ${uid()}`, hostBodyId: hostId, active: false })

    const activateRes = parseResult(await tool('character_manage', { action: 'activate', characterId: bellonaId }))
    expect(activateRes.success).toBe(true)
    expect(activateRes.deactivated).toEqual([cordeliaId])

    const cordeliaAfter = parseResult(await tool('character_manage', { action: 'get', characterId: cordeliaId }))
    const bellonaAfter = parseResult(await tool('character_manage', { action: 'get', characterId: bellonaId }))
    expect(cordeliaAfter.character.active).toBe(0)
    expect(bellonaAfter.character.active).toBe(1)
  })

  it('list_passengers reports the active consciousness and dormant passengers', async () => {
    const hostId = await createChar({ name: `Host ${uid()}` })
    const activeId = await createChar({ name: `Active ${uid()}`, hostBodyId: hostId, active: true })
    const passengerId = await createChar({ name: `Passenger ${uid()}`, hostBodyId: hostId, active: false })

    const listRes = parseResult(await tool('character_manage', { action: 'list_passengers', hostBodyId: hostId }))
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
})
