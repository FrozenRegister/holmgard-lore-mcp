// Live smoke coverage for the #330/#335/#336 bug-cluster fixes:
// - #330: world_manage.create/generate now seed a world_state row, so
//   time.get_date works immediately without a prior set_date call.
// - #335: "stealth" is now a working alias sub for perception's stealth_check.
// - #336: time.get_date/timeline.get_events now accept camelCase worldId as
//   an alias for their historical snake_case world_id param.
import { describe, it, expect, afterEach } from 'vitest'
import { MCP_API_KEY, tool, uid } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any) {
  if (res.error) return { error: true, message: res.error.message }
  return JSON.parse(res.result.content[0].text)
}

describe.skipIf(!MCP_API_KEY)('routing/init bug-cluster fixes (#330, #335, #336)', () => {
  const createdWorldIds: string[] = []

  afterEach(async () => {
    await Promise.all(createdWorldIds.splice(0).map(worldId => tool('rpg', { sub: 'world', action: 'delete', worldId })))
  })

  async function createWorld() {
    const world = parseResult(await tool('rpg', { sub: 'world', action: 'create', name: `RoutingFixWorld ${uid()}` }))
    createdWorldIds.push(world.worldId)
    return world.worldId as string
  }

  it('world.create auto-seeds a world_state row so time.get_date works with no prior set_date (#330)', async () => {
    const worldId = await createWorld()
    const res = parseResult(await tool('rpg', { sub: 'time', action: 'get_date', world_id: worldId }))
    expect(res.error).toBeUndefined()
    expect(res.success).toBe(true)
    expect(res.current_date).toBeTruthy()
  })

  it('time.get_date accepts camelCase worldId as an alias for world_id (#336)', async () => {
    const worldId = await createWorld()
    const res = parseResult(await tool('rpg', { sub: 'time', action: 'get_date', worldId }))
    expect(res.error).toBeUndefined()
    expect(res.success).toBe(true)
  })

  it('stealth is a working alias sub for perception\'s stealth_check (#335)', async () => {
    const res = parseResult(await tool('rpg', { sub: 'stealth', action: 'stealth_check' }))
    expect(res.error).toBeUndefined()
    expect(res.success).toBe(true)
    expect(res.actionType).toBe('stealth_check')
  })
})
