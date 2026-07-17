// Live smoke coverage for #423 (world_map schema now matches the real
// hex-axial handler) and #424 (rpg tool's no-sub load_tool_schema response
// surfaces an aliases map for the aliasOf pattern).
import { describe, it, expect } from 'vitest'
import { MCP_API_KEY, tool } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any) {
  if (res.error) return { error: true, message: res.error.message }
  return JSON.parse(res.result.content[0].text)
}

describe.skipIf(!MCP_API_KEY)('rpg schema accuracy (#423, #424)', () => {
  it('world_map schema advertises real hex-axial actions and q/r coordinates', async () => {
    const r = parseResult(await tool('load_tool_schema', { toolName: 'rpg', sub: 'world_map' }))
    expect(r.schema.description).toContain('overview')
    expect(r.schema.description).toContain('render_svg')
    expect(r.schema.description).not.toMatch(/\bget_hex\b/)
    expect(r.schema.inputSchema.properties.q).toBeDefined()
    expect(r.schema.inputSchema.properties.x).toBeUndefined()
  })

  it('rpg no-sub schema includes the aliases map', async () => {
    const r = parseResult(await tool('load_tool_schema', { toolName: 'rpg' }))
    expect(r.aliases.maps).toBe('world_map')
  })
})
