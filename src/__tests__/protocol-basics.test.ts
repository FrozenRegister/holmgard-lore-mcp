import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('JSON-RPC protocol', () => {
  it('initialize returns server info and capabilities', async () => {
    const res = await rpc('initialize')
    expect(res.jsonrpc).toBe('2.0')
    expect(res.result.protocolVersion).toBe('2024-11-05')
    expect(res.result.serverInfo.name).toBe('holmgard-lore-mcp')
    expect(res.result.capabilities.tools.list).toBe(true)
    expect(res.result.capabilities.tools.call).toBe(true)
  })

  it('ping returns empty result', async () => {
    const res = await rpc('ping')
    expect(res.result).toEqual({})
  })

  it('tools/list returns exactly 89 tools', async () => {
    const res = await rpc('tools/list')
    const tools = res.result.tools as Array<{ name: string }>
    expect(tools).toHaveLength(89)
    const names = tools.map((t) => t.name)
    expect(names).toContain('ping_tool')
    expect(names).toContain('check_authentication')
    expect(names).toContain('list_topics')
    expect(names).toContain('list_maps')
    expect(names).toContain('get_lore')
    expect(names).toContain('set_lore')
    expect(names).toContain('delete_lore')
    expect(names).toContain('get_lore_batch')
    expect(names).toContain('get_lore_section')
    expect(names).toContain('list_consumption_timelines')
    expect(names).toContain('list_active_threads')
    expect(names).toContain('increment_topic_field')
    expect(names).toContain('validate_topic_exists')
    expect(names).toContain('search_lore')
    expect(names).toContain('patch_lore')
    expect(names).toContain('restore_lore')
    expect(names).toContain('resolve_interaction')
    expect(names).toContain('analyze_utility')
    expect(names).toContain('map_integration')
    expect(names).toContain('thread_tick')
    expect(names).toContain('batch_set_lore')
    expect(names).toContain('batch_mutate')
    expect(names).toContain('get_relationship')
    expect(names).toContain('get_faction_standing')
    expect(names).toContain('get_entity_knowledge')
    expect(names).toContain('get_location_occupants')
    expect(names).toContain('get_reachable_locations')
    expect(names).toContain('sense_environment')
    expect(names).toContain('get_inventory')
    expect(names).toContain('transfer_item')
    expect(names).toContain('activate_scene')
    expect(names).toContain('present_choices')
    expect(names).toContain('commit_choice')
    expect(names).toContain('get_choice_history')
    expect(names).toContain('advance_state_stage')
    expect(names).toContain('process_stage_batch')
    expect(names).toContain('generate_entity')
    expect(names).toContain('roll_encounter')
    expect(names).toContain('get_thread_comparison')
    expect(names).toContain('check_convergence')
    expect(names).toContain('get_sensory_profile')
    expect(names).toContain('get_compatibility')
    expect(names).toContain('append_event')
    expect(names).toContain('get_event_log')
    expect(names).toContain('recent_changes')
    expect(names).toContain('tag_topic')
    expect(names).toContain('find_by_tag')
    expect(names).toContain('bookmark_state')
    expect(names).toContain('world_diff')
    expect(names).toContain('plant_setup')
    expect(names).toContain('pay_off_setup')
    expect(names).toContain('list_unpaid_setups')
    expect(names).toContain('set_goal')
    expect(names).toContain('check_continuity')
    expect(names).toContain('scene_brief')
    expect(names).toContain('render_pov')
    expect(names).toContain('append_to_section')
    expect(names).toContain('get_topic_histories')
    expect(names).toContain('move_entity')
    // RPG engine tools (Phase 3)
    expect(names).toContain('math_manage')
    expect(names).toContain('world_manage')
    expect(names).toContain('character_manage')
    expect(names).toContain('party_manage')
    expect(names).toContain('quest_manage')
    expect(names).toContain('item_manage')
    expect(names).toContain('inventory_manage')
    expect(names).toContain('corpse_manage')
    expect(names).toContain('narrative_manage')
    expect(names).toContain('secret_manage')
    expect(names).toContain('theft_manage')
    expect(names).toContain('aura_manage')
    expect(names).toContain('improvisation_manage')
    expect(names).toContain('npc_manage')
    expect(names).toContain('session_manage')
    expect(names).toContain('combat_manage')
    expect(names).toContain('combat_action')
    expect(names).toContain('combat_map')
    expect(names).toContain('spawn_manage')
    expect(names).toContain('strategy_manage')
    expect(names).toContain('turn_manage')
    expect(names).toContain('spatial_manage')
    expect(names).toContain('world_map')
    expect(names).toContain('batch_manage')
    expect(names).toContain('travel_manage')
    expect(names).toContain('perception_manage')
    expect(names).toContain('scene_manage')
    // Meta-tools
    expect(names).toContain('search_tools')
    expect(names).toContain('load_tool_schema')
  })

  it('rejects requests with wrong jsonrpc version', async () => {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'ping' }),
    }).then((r) => r.json() as Promise<Record<string, any>>)
    expect(res.error.code).toBe(-32600)
  })

  it('rejects batch requests', async () => {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }]),
    }).then((r) => r.json() as Promise<Record<string, any>>)
    expect(res.error.code).toBe(-32600)
    expect(res.error.message).toContain('Batch requests are not supported')
  })

  it('returns parse error on invalid JSON', async () => {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json {{',
    }).then((r) => r.json() as Promise<Record<string, any>>)
    expect(res.error.code).toBe(-32700)
  })

  it('returns method-not-found for unknown method', async () => {
    const res = await rpc('unknown_method_xyz')
    expect(res.error.code).toBe(-32601)
  })

  it('GET /mcp returns error directing caller to POST', async () => {
    const res = await SELF.fetch('http://example.com/mcp', { method: 'GET' })
    const body = await res.json() as Record<string, any>
    expect(body.error).toBeDefined()
  })
})

describe('ping_tool', () => {
  it('returns pong', async () => {
    const res = await callTool('ping_tool')
    expect(res.result.content[0].text).toBe('pong')
    expect(res.result.metadata.source).toBe('internal')
  })
})

describe('check_authentication', () => {
  it('returns authenticated when correct X-Api-Key header is sent', async () => {
    const res = await callToolWithApiKey('check_authentication', 'test-api-key-xyz')
    expect(res.result.content[0].text).toBe('Authenticated.')
    expect(res.result.metadata.authenticated).toBe(true)
  })

  it('returns not authenticated when no X-Api-Key header is sent', async () => {
    const res = await rpc('tools/call', { name: 'check_authentication', arguments: {} })
    expect(res.result.content[0].text).toBe('Not authenticated — request was made without a valid API key.')
    expect(res.result.metadata.authenticated).toBe(false)
  })

  it('returns not authenticated when wrong X-Api-Key header is sent', async () => {
    const res = await callToolWithApiKey('check_authentication', 'wrong-key')
    expect(res.result.content[0].text).toBe('Not authenticated — request was made without a valid API key.')
    expect(res.result.metadata.authenticated).toBe(false)
  })
})

