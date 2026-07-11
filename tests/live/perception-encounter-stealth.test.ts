// Live smoke coverage for the #284 stealth/perception surface. Neither
// `perception` nor `encounter` (both routed through the unified `rpg` tool's
// `sub` param, not registered as standalone MCP tools) had any live coverage
// before this change — scoped here to only the new stealth_check/
// perception_contested actions and encounter.resolve/check's stealthCheck
// param, not a full backfill of either sub-handler's pre-existing actions.
import { describe, it, expect } from 'vitest'
import { MCP_API_KEY, tool, uid } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any) {
  if (res.error) return { error: true, message: res.error.message }
  return JSON.parse(res.result.content[0].text)
}

describe.skipIf(!MCP_API_KEY)('rpg perception/encounter stealth (#284)', () => {
  it('perception.stealth_check returns an opposed-check result with modifiers', async () => {
    const res = parseResult(await tool('rpg', {
      sub: 'perception', action: 'stealth_check',
      stealthMode: 'hiding', distanceZone: 'edge', windDirection: 'away', partySize: 1,
    }))
    expect(res.success).toBe(true)
    expect(res.yieldRoll).toBeGreaterThanOrEqual(1)
    expect(res.predatorRoll).toBeGreaterThanOrEqual(1)
    expect(['avoided_entirely', 'tense_moment', 'predator_searching', 'yield_spotted', 'ambushed']).toContain(res.outcome)
    expect(res.yieldModifiers.stealthMode).toBe(2)
  })

  it('perception.perception_contested returns a generic opposed-check result', async () => {
    const res = parseResult(await tool('rpg', {
      sub: 'perception', action: 'perception_contested', observerModifier: 3, actorModifier: 1,
    }))
    expect(res.success).toBe(true)
    expect(typeof res.detected).toBe('boolean')
    expect(res.margin).toBe(res.observerTotal - res.actorTotal)
  })

  it('encounter.check short-circuits with confrontationAvoided on a clean stealth avoidance', async () => {
    // stealthCheck short-circuits before any world/tile lookup, so a
    // never-created worldId is fine here — this exercises only the new
    // stealth gate, not encounter's world-dependent threshold pipeline.
    const res = parseResult(await tool('rpg', {
      sub: 'encounter', action: 'check', worldId: `nonexistent-${uid()}`, x: 0, y: 0,
      stealthCheck: true, yieldStealthRoll: 20, predatorPerceptionBonus: -20,
    }))
    expect(res.success).toBe(true)
    expect(res.confrontationAvoided).toBe(true)
    expect(res.stealthResult.outcome).toBe('avoided_entirely')
  })

  it('encounter.check omits stealthResult when stealthCheck is not requested', async () => {
    const res = parseResult(await tool('rpg', {
      sub: 'encounter', action: 'check', worldId: `nonexistent-${uid()}`, x: 0, y: 0,
    }))
    expect(res.success).toBe(true)
    expect(res.stealthResult).toBeUndefined()
  })
})
