// #423 — the world_map sub-schema (SUB_SCHEMAS in index.ts) previously advertised
// square-grid actions (generate/get_hex/set_hex/get_map) and x/y coordinates that
// don't exist in the real hex-axial handler (world-map.ts, rewritten for #320).
// #424 — the aliasOf pattern (maps->world_map, stealth->perception, etc.) had no
// discoverability path beyond guessing; load_tool_schema({toolName:"rpg"})'s
// no-sub response now surfaces an `aliases` map.
// #462-#467 — six more subs (drama, theft, improvisation, session, event,
// combat_action) had the same class of drift (SUB_SCHEMAS is hand-maintained and
// disconnected from each handler's real ACTIONS), plus spawn was missing a real
// action (place_character, #340). assertSchemaActions() below is the shared
// word-boundary real-actions-present/stale-actions-absent check used for each.
import { describe } from './support/helpers'
import { SELF } from 'cloudflare:test'
import { expect, it } from 'vitest'

// load_tool_schema (and every other rpg-registry tool routed through wrap() in
// rpg/registry.ts) returns its payload as ok(data) — a JSON-stringified blob
// inside content[0].text, not spread at the top level of the JSON-RPC result
// the way entity_manage/lore_manage-style handlers do. The shared callTool in
// ./helpers returns the raw envelope, so rpg-tool tests need this unwrapping
// variant instead — same pattern as rpg-tools.test.ts and rpg-handler-aliases.test.ts.
async function callTool(name: string, args: Record<string, unknown>) {
  const res = await SELF.fetch('http://example.com/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  const json = await res.json() as Record<string, any>
  const text = json.result?.content?.[0]?.text
  return text ? JSON.parse(text) : json
}

describe('world_map schema accuracy (#423)', () => {
  it('advertises the real hex-axial actions, not the stale square-grid ones', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'world_map' })
    expect(r.success).toBe(true)
    const description: string = r.schema.description
    for (const action of ['overview', 'region', 'hexes', 'patch', 'batch', 'preview', 'find_poi', 'suggest_poi', 'update_poi', 'query_zone', 'list_zones', 'render_svg']) {
      expect(description).toContain(action)
    }
    // Word-boundary match — plain .toContain('get_hex') would false-positive
    // against the real 'get_hexes' alias name that legitimately appears now.
    for (const staleAction of ['generate', 'get_hex', 'set_hex', 'get_map', 'list_regions']) {
      expect(description).not.toMatch(new RegExp(`\\b${staleAction}\\b`))
    }
  })

  it('advertises hex-axial q/r coordinates, not square-grid x/y', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'world_map' })
    const props = r.schema.inputSchema.properties
    expect(props.q).toBeDefined()
    expect(props.r).toBeDefined()
    expect(props.x).toBeUndefined()
    expect(props.y).toBeUndefined()
  })

  it('includes the real handler parameters (mapId, hexes array, POI/zone fields)', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'world_map' })
    const props = r.schema.inputSchema.properties
    expect(props.mapId).toBeDefined()
    expect(props.hexes).toBeDefined()
    expect(props.structureType).toBeDefined()
    expect(props.zoneType).toBeDefined()
    expect(props.renderWidth).toBeDefined()
  })

  it('the maps alias inherits the corrected world_map schema', async () => {
    const worldMap = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'world_map' })
    const maps = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'maps' })
    expect(maps.schema.inputSchema).toEqual(worldMap.schema.inputSchema)
    expect(maps.schema.description).toBe(worldMap.schema.description)
  })
})

async function assertSchemaActions(sub: string, realActions: string[], staleActions: string[]) {
  const r = await callTool('load_tool_schema', { toolName: 'rpg', sub })
  expect(r.success).toBe(true)
  const description: string = r.schema.description
  for (const action of realActions) {
    expect(description).toMatch(new RegExp(`\\b${action}\\b`))
  }
  for (const staleAction of staleActions) {
    expect(description).not.toMatch(new RegExp(`\\b${staleAction}\\b`))
  }
}

describe('drama schema accuracy (#462)', () => {
  it('advertises the real ability-check/conflict-resolution actions, not the stale narrative-tension ones', () =>
    assertSchemaActions(
      'drama',
      ['roll_ability', 'opposed_check', 'group_check', 'social_combat', 'dramatic_conflict'],
      ['inject_complication', 'resolve_tension', 'get_active_threads', 'escalate', 'introduce_twist', 'check_pacing']
    ))

  it('includes the real handler parameters (character_a/b, side_a/b, participants, sides)', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'drama' })
    const props = r.schema.inputSchema.properties
    expect(props.character_a).toBeDefined()
    expect(props.side_a).toBeDefined()
    expect(props.participants).toBeDefined()
    expect(props.sides).toBeDefined()
    expect(props.threadId).toBeUndefined()
    expect(props.tensionType).toBeUndefined()
  })
})

describe('theft schema accuracy (#462)', () => {
  it('advertises the real stolen-item-ledger actions, not the stale DC-check ones', () =>
    assertSchemaActions(
      'theft',
      ['steal', 'fence', 'get', 'list', 'recover', 'cool_heat', 'report'],
      ['attempt', 'check_dc', 'get_result', 'list_attempts']
    ))

  it('includes the real handler parameters (itemId, stolenFrom, fencedTo, filter)', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'theft' })
    const props = r.schema.inputSchema.properties
    expect(props.itemId).toBeDefined()
    expect(props.stolenFrom).toBeDefined()
    expect(props.fencedTo).toBeDefined()
    expect(props.filter).toBeDefined()
    expect(props.thiefId).toBeUndefined()
    expect(props.checkType).toBeUndefined()
  })
})

describe('improvisation schema accuracy (#463)', () => {
  it('advertises the real custom-effect-ledger actions, not the stale DC-check ones', () =>
    assertSchemaActions(
      'improvisation',
      ['apply', 'get', 'list', 'remove', 'tick', 'list_by_target'],
      ['attempt', 'check_dc', 'get_result', 'list_recipes']
    ))

  it('includes the real handler parameters (targetId, durationType, powerLevel)', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'improvisation' })
    const props = r.schema.inputSchema.properties
    expect(props.targetId).toBeDefined()
    expect(props.durationType).toBeDefined()
    expect(props.powerLevel).toBeDefined()
    expect(props.recipeName).toBeUndefined()
    expect(props.complexity).toBeUndefined()
  })
})

describe('session schema accuracy (#464)', () => {
  it('advertises the real initialize/get_context actions, not the stale CRUD ones', () =>
    assertSchemaActions(
      'session',
      ['initialize', 'get_context'],
      ['create', 'end', 'get_summary', 'save_checkpoint']
    ))

  it('includes the real handler parameters (createNew, includeParty, narrativeLimit)', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'session' })
    const props = r.schema.inputSchema.properties
    expect(props.createNew).toBeDefined()
    expect(props.includeParty).toBeDefined()
    expect(props.narrativeLimit).toBeDefined()
    expect(props.sessionId).toBeUndefined()
  })
})

describe('event schema accuracy (#465)', () => {
  it('advertises the real emit/poll/ack/list_types actions, not the stale CRUD ones', () =>
    assertSchemaActions(
      'event',
      ['emit', 'poll', 'ack', 'list_types'],
      ['resolve', 'trigger', 'get_active']
    ))

  it('includes the real handler parameters (eventType, payload, unconsumedOnly)', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'event' })
    const props = r.schema.inputSchema.properties
    expect(props.eventType).toBeDefined()
    expect(props.payload).toBeDefined()
    expect(props.unconsumedOnly).toBeDefined()
    expect(props.locationId).toBeUndefined()
    expect(props.participants).toBeUndefined()
  })
})

describe('combat_action schema accuracy (#466)', () => {
  it('advertises all 13 real actions, not the 3 phantom ones', () =>
    assertSchemaActions(
      'combat_action',
      ['attack', 'apply_damage', 'heal', 'apply_condition', 'remove_condition', 'use_ability', 'get_log', 'get_turn_summary', 'dash', 'dodge', 'disengage', 'help', 'ready'],
      ['cast', 'use_item', 'defend']
    ))

  it('includes the real handler parameters (targetIds, damageExpression, conditionName)', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'combat_action' })
    const props = r.schema.inputSchema.properties
    expect(props.targetIds).toBeDefined()
    expect(props.damageExpression).toBeDefined()
    expect(props.conditionName).toBeDefined()
    expect(props.targetId).toBeUndefined()
    expect(props.weaponName).toBeUndefined()
    expect(props.spellName).toBeUndefined()
  })
})

describe('spawn schema accuracy (#467)', () => {
  it('advertises place_character alongside the other five spawn actions', () =>
    assertSchemaActions(
      'spawn',
      ['spawn_character', 'spawn_encounter', 'spawn_location', 'add_to_encounter', 'list_spawned', 'place_character'],
      []
    ))

  it('includes the place_character parameters (characterId, q, r, mapId)', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'spawn' })
    const props = r.schema.inputSchema.properties
    expect(props.characterId).toBeDefined()
    expect(props.q).toBeDefined()
    expect(props.r).toBeDefined()
    expect(props.mapId).toBeDefined()
  })
})

describe('scene/timeline/encounter schema accuracy (discovered via #468 drift guard)', () => {
  it('scene advertises set_conflict_type/get_conflict_type alongside the CRUD actions', () =>
    assertSchemaActions('scene', ['set_conflict_type', 'get_conflict_type'], []))

  it('timeline advertises the real D1 event/branch actions, not the stale snapshot/paradox ones', () =>
    assertSchemaActions(
      'timeline',
      ['get_events', 'get_gap', 'get_perspectives', 'create_branch', 'switch_branch', 'compare_branches', 'merge_branch'],
      ['get_state', 'snapshot', 'restore', 'check_paradox', 'list_branches']
    ))

  it('encounter advertises the real threat-roll actions, not the stale table-CRUD ones', () =>
    assertSchemaActions(
      'encounter',
      ['resolve', 'check', 'list_types', 'add_type', 'check_infection'],
      ['create_table', 'get_table', 'list_tables', 'add_entry', 'remove_entry']
    ))

  it('batch advertises the real bulk-character/template actions, not the stale generic-CRUD ones', () =>
    assertSchemaActions(
      'batch',
      ['batch_create_characters', 'batch_create_npcs', 'batch_distribute_items', 'execute_workflow', 'list_templates', 'get_template'],
      ['create_many', 'update_many', 'delete_many', 'get_many']
    ))

  it('perception advertises the real assess/stealth_check/perception_contested actions, not the stale check ones', () =>
    assertSchemaActions(
      'perception',
      ['assess', 'get_history', 'get_latest', 'list_observers', 'stealth_check', 'perception_contested'],
      ['passive_perception', 'group_check', 'oppose_stealth']
    ))

  it('combat_map advertises the real battlefield actions, not the stale token/adjacency ones', () =>
    assertSchemaActions(
      'combat_map',
      ['create', 'get', 'update', 'move_token', 'render', 'delete', 'get_terrain', 'set_terrain', 'calculate_aoe'],
      ['place_token', 'remove_token', 'get_adjacent', 'measure_distance']
    ))

  it('turn advertises the real world-level turn-phase actions, not the stale encounter-initiative ones', () =>
    // Note: "start" is deliberately excluded from the stale list — it's a real
    // alias for "init" per turn-manage.ts's ALIASES, so it legitimately appears.
    assertSchemaActions(
      'turn',
      ['init', 'get_status', 'submit_actions', 'mark_ready', 'poll_results'],
      ['next', 'get_current', 'set_initiative', 'skip', 'reset']
    ))

  it('spatial advertises the real room-graph actions, not the stale coordinate-query ones', () =>
    assertSchemaActions(
      'spatial',
      ['look', 'generate', 'update', 'get_exits', 'move', 'list', 'network_create', 'network_get', 'network_list'],
      ['get_neighbors', 'get_in_radius', 'check_line_of_sight', 'get_distance', 'get_path']
    ))

  it('math advertises solve/simplify alongside the other four actions', () =>
    assertSchemaActions('math', ['roll', 'probability', 'projectile', 'get_history', 'solve', 'simplify'], []))

  it('character advertises move_to_location/move_to_tile alongside the CRUD actions', () =>
    assertSchemaActions('character', ['move_to_location', 'move_to_tile'], []))

  it('party advertises cohesion_check/group_break/cohesion_shift alongside the existing actions', () =>
    assertSchemaActions('party', ['cohesion_check', 'group_break', 'cohesion_shift'], []))

  it('npc advertises the real relationship/memory actions, not the stale generate/delete/react ones', () =>
    assertSchemaActions(
      'npc',
      ['create', 'get', 'list', 'update', 'get_full_context', 'get_relationship', 'update_relationship', 'record_memory', 'get_history', 'get_recent', 'get_context', 'interact', 'assign_to_location'],
      ['generate', 'delete', 'react', 'get_dialogue']
    ))
})

describe('rpg tool aliases map (#424)', () => {
  it('load_tool_schema({toolName:"rpg"}) with no sub includes an aliases map', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'rpg' })
    expect(r.success).toBe(true)
    expect(r.aliases).toBeDefined()
    expect(r.aliases.maps).toBe('world_map')
    expect(r.aliases.stealth).toBe('perception')
    expect(r.aliases.characters).toBe('character')
    expect(r.aliases.npc_dialogue).toBe('npc')
  })

  it('does not include an aliases key for non-rpg tools', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'entity_manage' })
    expect(r.success).toBe(true)
    expect(r.aliases).toBeUndefined()
  })

  it('sub-level lookups (with a sub param) do not carry the top-level aliases map', async () => {
    const r = await callTool('load_tool_schema', { toolName: 'rpg', sub: 'world_map' })
    expect(r.success).toBe(true)
    expect(r.aliases).toBeUndefined()
  })
})
