// Live smoke coverage for rpg{sub:"waypoint"}. This sub had zero live coverage
// before this change — scoped here to #399's optional-lat/lon behavior, not a
// full backfill of waypoint-manage's pre-existing actions (list/get/update/
// delete/seed_defaults/hex_to_latlon).
import { describe, it, expect } from 'vitest'
import { MCP_API_KEY, tool, uid } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any) {
  if (res.error) return { error: true, message: res.error.message }
  return JSON.parse(res.result.content[0].text)
}

describe.skipIf(!MCP_API_KEY)('rpg waypoint register — optional lat/lon (#399)', () => {
  it('registers without lat/lon on a non-geo-calibrated world', async () => {
    const worldRes = parseResult(await tool('rpg', { sub: 'world', action: 'create', name: `Waypoint Test World ${uid()}` }))
    expect(worldRes.success).toBe(true)
    const worldId = worldRes.worldId

    const registerRes = parseResult(await tool('rpg', {
      sub: 'waypoint', action: 'register', worldId, name: `Grid Outpost ${uid()}`, q: 3, r: -2,
    }))
    expect(registerRes.success).toBe(true)
    expect(registerRes.lat).toBeNull()
    expect(registerRes.lon).toBeNull()
  })

  it('requires lat/lon once the world is geo-calibrated', async () => {
    const worldRes = parseResult(await tool('rpg', { sub: 'world', action: 'create', name: `Calibrated Waypoint World ${uid()}` }))
    const worldId = worldRes.worldId
    await tool('rpg', { sub: 'waypoint', action: 'calibrate', worldId, originLat: 57.6349, originLon: 18.2948, kmPerHex: 1 })

    const missingLatLon = parseResult(await tool('rpg', {
      sub: 'waypoint', action: 'register', worldId, name: `No Coords ${uid()}`, q: 0, r: 0,
    }))
    expect(missingLatLon.error).toBe(true)

    const withLatLon = parseResult(await tool('rpg', {
      sub: 'waypoint', action: 'register', worldId, name: `Has Coords ${uid()}`, q: 0, r: 0, lat: 57.6349, lon: 18.2948,
    }))
    expect(withLatLon.success).toBe(true)
    expect(withLatLon.lat).toBe(57.6349)
  })
})
