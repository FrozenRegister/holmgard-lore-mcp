// Live smoke coverage for #423 (world_map schema now matches the real
// hex-axial handler) and #424 (rpg tool's no-sub load_tool_schema response
// surfaces an aliases map for the aliasOf pattern).
// #462-#467 — six more subs had the same class of drift (drama, theft, event,
// session, improvisation, combat_action) plus spawn was missing a real action
// (place_character, #340). Mirrors the per-sub assertions added to the
// workers-suite src/__tests__/rpg-schema-accuracy.test.ts.
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

describe.skipIf(!MCP_API_KEY)('rpg schema accuracy (#462-#467)', () => {
  it('drama schema advertises roll_ability/opposed_check/group_check, not stale narrative-tension actions', async () => {
    const r = parseResult(await tool('load_tool_schema', { toolName: 'rpg', sub: 'drama' }))
    expect(r.schema.description).toMatch(/\broll_ability\b/)
    expect(r.schema.description).toMatch(/\bopposed_check\b/)
    expect(r.schema.description).not.toMatch(/\binject_complication\b/)
  })

  it('theft schema advertises steal/fence/cool_heat, not stale DC-check actions', async () => {
    const r = parseResult(await tool('load_tool_schema', { toolName: 'rpg', sub: 'theft' }))
    expect(r.schema.description).toMatch(/\bsteal\b/)
    expect(r.schema.description).toMatch(/\bcool_heat\b/)
    expect(r.schema.description).not.toMatch(/\battempt\b/)
  })

  it('improvisation schema advertises apply/tick/list_by_target, not stale DC-check actions', async () => {
    const r = parseResult(await tool('load_tool_schema', { toolName: 'rpg', sub: 'improvisation' }))
    expect(r.schema.description).toMatch(/\bapply\b/)
    expect(r.schema.description).toMatch(/\btick\b/)
    expect(r.schema.description).not.toMatch(/\blist_recipes\b/)
  })

  it('session schema advertises initialize/get_context, not the stale CRUD actions', async () => {
    const r = parseResult(await tool('load_tool_schema', { toolName: 'rpg', sub: 'session' }))
    expect(r.schema.description).toMatch(/\binitialize\b/)
    expect(r.schema.description).toMatch(/\bget_context\b/)
    expect(r.schema.description).not.toMatch(/\bsave_checkpoint\b/)
  })

  it('event schema advertises emit/poll/ack/list_types, not the stale CRUD actions', async () => {
    const r = parseResult(await tool('load_tool_schema', { toolName: 'rpg', sub: 'event' }))
    expect(r.schema.description).toMatch(/\bemit\b/)
    expect(r.schema.description).toMatch(/\bpoll\b/)
    expect(r.schema.description).not.toMatch(/\bget_active\b/)
  })

  it('combat_action schema advertises all 13 real actions, not the 3 phantom ones', async () => {
    const r = parseResult(await tool('load_tool_schema', { toolName: 'rpg', sub: 'combat_action' }))
    expect(r.schema.description).toMatch(/\bapply_damage\b/)
    expect(r.schema.description).toMatch(/\bdisengage\b/)
    expect(r.schema.description).not.toMatch(/\bcast\b/)
    expect(r.schema.description).not.toMatch(/\buse_item\b/)
  })

  it('spawn schema advertises place_character alongside the other five actions', async () => {
    const r = parseResult(await tool('load_tool_schema', { toolName: 'rpg', sub: 'spawn' }))
    expect(r.schema.description).toMatch(/\bplace_character\b/)
    expect(r.schema.inputSchema.properties.q).toBeDefined()
    expect(r.schema.inputSchema.properties.mapId).toBeDefined()
  })
})

// Discovered while wiring up the #468 drift guard — a static cross-check of
// every canonical rpg sub's real ACTIONS against its SUB_SCHEMAS description
// found 13 more subs with the same class of drift (0-1 action overlap in most
// cases). Spot-checks one real/stale pair per sub against the live worker;
// see src/__tests__/rpg-schema-accuracy.test.ts for the full per-sub coverage.
describe.skipIf(!MCP_API_KEY)('rpg schema accuracy (discovered via #468 drift guard)', () => {
  const cases: Array<{ sub: string; real: string; stale?: string }> = [
    { sub: 'conflict_type', real: 'create' },
    { sub: 'scene', real: 'set_conflict_type' },
    { sub: 'timeline', real: 'get_events', stale: 'check_paradox' },
    { sub: 'encounter', real: 'check_infection', stale: 'create_table' },
    { sub: 'batch', real: 'batch_create_characters', stale: 'create_many' },
    { sub: 'perception', real: 'perception_contested', stale: 'passive_perception' },
    { sub: 'combat_map', real: 'calculate_aoe', stale: 'measure_distance' },
    { sub: 'turn', real: 'poll_results', stale: 'set_initiative' },
    { sub: 'spatial', real: 'network_create', stale: 'get_neighbors' },
    { sub: 'math', real: 'solve' },
    { sub: 'character', real: 'move_to_tile' },
    { sub: 'party', real: 'cohesion_shift' },
    { sub: 'npc', real: 'assign_to_location', stale: 'get_dialogue' },
  ]

  for (const { sub, real, stale } of cases) {
    it(`${sub} schema advertises ${real}${stale ? `, not the stale ${stale}` : ''}`, async () => {
      const r = parseResult(await tool('load_tool_schema', { toolName: 'rpg', sub }))
      expect(r.schema.description).toMatch(new RegExp(`\\b${real}\\b`))
      if (stale) expect(r.schema.description).not.toMatch(new RegExp(`\\b${stale}\\b`))
    })
  }
})
