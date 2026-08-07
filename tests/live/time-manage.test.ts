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
    const worldRes = parseResult(
      await tool('rpg', { sub: 'world', action: 'create', name: `Test World ${uid()}` }),
    )
    expect(worldRes.success).toBe(true)
    const worldId = worldRes.worldId
    await tool('rpg', { sub: 'time', action: 'set_date', world_id: worldId, date: '2184-07-15' })
    const charRes = parseResult(
      await tool('character_manage', {
        action: 'create',
        name: `Partial Born ${uid()}`,
        born: '2155',
        worldId,
      }),
    )
    expect(charRes.success).toBe(true)

    const ageRes = parseResult(
      await tool('rpg', {
        sub: 'time',
        action: 'get_age',
        world_id: worldId,
        character_id: charRes.characterId,
      }),
    )
    expect(ageRes.success).toBe(true)
    expect(ageRes.age.years).toBe(29)
    expect(ageRes.age.months).toBeNull()
    expect(ageRes.age.days).toBeNull()
    expect(ageRes.next_birthday).toBeNull()
    expect(ageRes.is_partial_date).toBe(true)

    await tool('character_manage', { action: 'delete', characterId: charRes.characterId })
  })
})

describe.skipIf(!MCP_API_KEY)('rpg time advance by hours — sub-day clock (#534)', () => {
  it('advances the hour, rolls over into the next day, and get_date reports it', async () => {
    const worldRes = parseResult(
      await tool('rpg', { sub: 'world', action: 'create', name: `Hour Clock World ${uid()}` }),
    )
    expect(worldRes.success).toBe(true)
    const worldId = worldRes.worldId
    await tool('rpg', { sub: 'time', action: 'set_date', world_id: worldId, date: '2184-07-15' })

    const initialDate = parseResult(
      await tool('rpg', { sub: 'time', action: 'get_date', world_id: worldId }),
    )
    expect(initialDate.hour).toBe(12) // migration default (noon)

    const rollover = parseResult(
      await tool('rpg', { sub: 'time', action: 'advance', world_id: worldId, by: '14 hours' }),
    )
    expect(rollover.success).toBe(true)
    expect(rollover.hour).toBe(2)
    expect(rollover.new_date).toBe('2184-07-16')

    const afterDate = parseResult(
      await tool('rpg', { sub: 'time', action: 'get_date', world_id: worldId }),
    )
    expect(afterDate.hour).toBe(2)
    expect(afterDate.current_date).toBe('2184-07-16')
  })
})

describe.skipIf(!MCP_API_KEY)('rpg time advance by minutes — sim-minutes clock (#671)', () => {
  it('advances the minute, rolls over into the next hour, and reports sim_minutes/day_fraction', async () => {
    const worldRes = parseResult(
      await tool('rpg', { sub: 'world', action: 'create', name: `Minute Clock World ${uid()}` }),
    )
    expect(worldRes.success).toBe(true)
    const worldId = worldRes.worldId
    await tool('rpg', { sub: 'time', action: 'set_date', world_id: worldId, date: '2184-07-15' })

    const initialDate = parseResult(
      await tool('rpg', { sub: 'time', action: 'get_date', world_id: worldId }),
    )
    expect(initialDate.hour).toBe(12) // migration default (noon)
    expect(initialDate.minute).toBe(0)

    const rollover = parseResult(
      await tool('rpg', { sub: 'time', action: 'advance', world_id: worldId, by: '75 minutes' }),
    )
    expect(rollover.success).toBe(true)
    expect(rollover.hour).toBe(13)
    expect(rollover.minute).toBe(15)
    expect(rollover.new_date).toBe('2184-07-15')
    expect(rollover.elapsed_minutes).toBe(75)
    expect(rollover.day_fraction).toBeCloseTo(75 / 1440, 6)

    const afterDate = parseResult(
      await tool('rpg', { sub: 'time', action: 'get_date', world_id: worldId }),
    )
    expect(afterDate.hour).toBe(13)
    expect(afterDate.minute).toBe(15)
    expect(afterDate.current_date).toBe('2184-07-15')
  })
})

describe.skipIf(!MCP_API_KEY)(
  'rpg time set_owner / get_owner / advance ownership guard (#312)',
  () => {
    it('advance without an owner is unguarded; set_owner/get_owner/claim-on-advance round-trip', async () => {
      const worldRes = parseResult(
        await tool('rpg', {
          sub: 'world',
          action: 'create',
          name: `Time Owner Test World ${uid()}`,
        }),
      )
      expect(worldRes.success).toBe(true)
      const worldId = worldRes.worldId
      await tool('rpg', { sub: 'time', action: 'set_date', world_id: worldId, date: '2184-01-01' })

      const noOwnerRes = parseResult(
        await tool('rpg', { sub: 'time', action: 'get_owner', world_id: worldId }),
      )
      expect(noOwnerRes.time_owner).toBeNull()

      const claimRes = parseResult(
        await tool('rpg', {
          sub: 'time',
          action: 'advance',
          world_id: worldId,
          by: '1 day',
          owner: 'archisector',
        }),
      )
      expect(claimRes.success).toBe(true)
      expect(claimRes.time_owner).toBe('archisector')

      const conflictRes = parseResult(
        await tool('rpg', {
          sub: 'time',
          action: 'advance',
          world_id: worldId,
          by: '1 month',
          owner: 'calder-architect',
        }),
      )
      expect(conflictRes.error).toBe(true)

      await tool('rpg', { sub: 'time', action: 'set_owner', world_id: worldId, owner: null })
      const handoffRes = parseResult(
        await tool('rpg', {
          sub: 'time',
          action: 'advance',
          world_id: worldId,
          by: '1 month',
          owner: 'calder-architect',
        }),
      )
      expect(handoffRes.success).toBe(true)
      expect(handoffRes.time_owner).toBe('calder-architect')
    })
  },
)
