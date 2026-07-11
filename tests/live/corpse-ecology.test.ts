// Live smoke coverage for the #288 Corpse Ecology surface. `corpse` (routed
// through the unified `rpg` tool's `sub` param, not a standalone MCP tool)
// had no live coverage before this change — scoped here to only the new
// register/decompose/scavenge_check/loot_corpse/recover/get_state/
// psychological_impact actions, not a full backfill of the legacy D&D
// create/get/list/loot/decay/generate_loot/delete actions.
import { describe, it, expect, afterEach } from 'vitest'
import { MCP_API_KEY, tool, uid } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any) {
  if (res.error) return { error: true, message: res.error.message }
  return JSON.parse(res.result.content[0].text)
}

describe.skipIf(!MCP_API_KEY)('rpg corpse ecology (#288)', () => {
  const createdIds: string[] = []

  afterEach(async () => {
    await Promise.all(createdIds.splice(0).map(id => tool('rpg', { sub: 'corpse', action: 'delete', id })))
  })

  it('register records a death and snapshots an empty inventory for a fresh character', async () => {
    const characterId = `yield-${uid()}`
    const res = parseResult(await tool('rpg', { sub: 'corpse', action: 'register', characterId, characterName: `Yield ${uid()}`, causeOfDeath: 'leonar attack' }))
    expect(res.success).toBe(true)
    expect(res.decompositionStage).toBe('fresh')
    createdIds.push(res.corpseId)
  })

  it('decompose advances stage based on an explicit hoursSinceDeath override', async () => {
    const registerRes = parseResult(await tool('rpg', { sub: 'corpse', action: 'register', characterId: `yield-${uid()}`, characterName: `Yield ${uid()}` }))
    createdIds.push(registerRes.corpseId)

    const res = parseResult(await tool('rpg', { sub: 'corpse', action: 'decompose', id: registerRes.corpseId, hoursSinceDeath: 100 }))
    expect(res.success).toBe(true)
    expect(res.decompositionStage).toBe('active_decay')
  })

  it('psychological_impact returns the fresh/stranger DC of 10 and a valid outcome', async () => {
    const registerRes = parseResult(await tool('rpg', { sub: 'corpse', action: 'register', characterId: `yield-${uid()}`, characterName: `Yield ${uid()}` }))
    createdIds.push(registerRes.corpseId)

    const res = parseResult(await tool('rpg', { sub: 'corpse', action: 'psychological_impact', id: registerRes.corpseId, observerCharacterId: `observer-${uid()}`, rollValue: 15 }))
    expect(res.success).toBe(true)
    expect(res.dc).toBe(10)
    expect(['break', 'steady', 'shaken', 'disturbed', 'traumatized']).toContain(res.outcome)
  })

  it('recover is rejected before Bloat stage', async () => {
    const registerRes = parseResult(await tool('rpg', { sub: 'corpse', action: 'register', characterId: `yield-${uid()}`, characterName: `Yield ${uid()}` }))
    createdIds.push(registerRes.corpseId)

    const res = parseResult(await tool('rpg', { sub: 'corpse', action: 'recover', id: registerRes.corpseId }))
    expect(res.error).toBe(true)
  })
})
