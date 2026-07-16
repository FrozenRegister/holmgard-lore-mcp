// Live smoke coverage for #411 — advance_stage mirrors its new KV State-Stage
// into D1's characters.dissolution_stage for characters whose death_mode is
// already 'staged', so combat_action.attack's staged-rejection guard (which
// reads D1) never drifts behind the KV stage a narrator actually advances.
import { describe, it, expect } from 'vitest'
import { MCP_API_KEY, tool, setLore, deleteLore, uid } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any) {
  if (res.error) return { error: true, message: res.error.message }
  return JSON.parse(res.result.content[0].text)
}

describe.skipIf(!MCP_API_KEY)('entity_manage advance_stage D1 mirror (#411)', () => {
  it('mirrors the new stage into dissolution_stage for a staged character resolved by name', async () => {
    const name = `Mirror Live Test ${uid()}`
    const charRes = parseResult(await tool('character_manage', { action: 'create', name }))
    expect(charRes.success).toBe(true)
    const characterId = charRes.characterId
    await tool('character_manage', { action: 'update', characterId, deathMode: 'staged', dissolutionStage: 2, dissolutionStages: 5 })

    const entityKey = `character:${name.toLowerCase().replace(/\s+/g, '-')}`
    await setLore(entityKey, '**State-Stage:** 2\n**State-Total:** 5\n**Stage-Timer:** 1')

    const advanceRes = await tool('entity_manage', { action: 'advance_stage', entity_key: entityKey })
    expect(advanceRes.result.advanced).toBe(true)
    expect(advanceRes.result.new_stage).toBe(3)
    expect(advanceRes.result.d1_mirrored).toBe(true)

    const got = parseResult(await tool('character_manage', { action: 'get', characterId }))
    expect(got.character.dissolution_stage).toBe(3)

    await deleteLore(entityKey)
    await tool('character_manage', { action: 'delete', characterId })
  })
})
