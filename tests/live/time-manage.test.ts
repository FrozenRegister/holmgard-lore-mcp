// Live smoke coverage for rpg{sub:'time'}. This sub had zero live coverage
// before this change — scoped here to the #303 year-only-born fix
// (get_age's next_birthday/age.months/age.days handling), not a full
// backfill of time_manage's pre-existing actions (set_date/get_date/advance).
import { describe, it, expect } from 'vitest'
import { MCP_API_KEY, tool, uid } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any) {
  if (res.error) return { error: true, message: res.error.message }
  return JSON.parse(res.result.content[0].text)
}

describe.skipIf(!MCP_API_KEY)('rpg time get_age year-only born (#303)', () => {
  it('returns null months/days/next_birthday (not "undefined-undefined") for a year-only born date', async () => {
    const worldRes = parseResult(await tool('rpg', { sub: 'world', action: 'create', name: `Test World ${uid()}` }))
    expect(worldRes.success).toBe(true)
    const worldId = worldRes.worldId
    await tool('rpg', { sub: 'time', action: 'set_date', world_id: worldId, date: '2184-07-15' })
    const charRes = parseResult(await tool('character_manage', {
      action: 'create', name: `Partial Born ${uid()}`, born: '2155', worldId,
    }))
    expect(charRes.success).toBe(true)

    const ageRes = parseResult(await tool('rpg', {
      sub: 'time', action: 'get_age', world_id: worldId, character_id: charRes.characterId,
    }))
    expect(ageRes.success).toBe(true)
    expect(ageRes.age.years).toBe(29)
    expect(ageRes.age.months).toBeNull()
    expect(ageRes.age.days).toBeNull()
    expect(ageRes.next_birthday).toBeNull()
    expect(ageRes.is_partial_date).toBe(true)

    await tool('character_manage', { action: 'delete', characterId: charRes.characterId })
  })
})
