import { describe, callTool } from './support/helpers'
import { expect, it } from 'vitest'

function expectSchemaHintError(res: any) {
  expect(res.error).toBeDefined()
  expect(res.error.code).toBe(-32602)
  expect(res.error.data.example).toBeDefined()
  expect(res.error.data.schema_hint).toContain('load_tool_schema')
}

describe('entity_manage invalid params include schema_hint and example', () => {
  it('resolve_interaction: missing action_type', async () => {
    const res = await callTool('entity_manage', { action: 'resolve_interaction', entity_a_id: 'character:a', entity_b_id: 'character:b' })
    expectSchemaHintError(res)
  })

  it('destroy: missing entity_key', async () => {
    const res = await callTool('entity_manage', { action: 'destroy' })
    expectSchemaHintError(res)
  })

  it('analyze_utility: missing utility_vector', async () => {
    const res = await callTool('entity_manage', { action: 'analyze_utility', entity_id: 'character:a' })
    expectSchemaHintError(res)
  })

  it('map_integration: missing integration_depth', async () => {
    const res = await callTool('entity_manage', { action: 'map_integration', source_id: 'character:a', target_id: 'character:b' })
    expectSchemaHintError(res)
  })

  it('generate: missing archetype_key', async () => {
    const res = await callTool('entity_manage', { action: 'generate' })
    expectSchemaHintError(res)
  })

  it('roll_encounter: missing location_key', async () => {
    const res = await callTool('entity_manage', { action: 'roll_encounter' })
    expectSchemaHintError(res)
  })

  it('advance_stage: missing entity_key', async () => {
    const res = await callTool('entity_manage', { action: 'advance_stage' })
    expectSchemaHintError(res)
  })

  it('batch_stage: missing location_key', async () => {
    const res = await callTool('entity_manage', { action: 'batch_stage' })
    expectSchemaHintError(res)
  })

  it('get_sensory_profile: missing entity_key', async () => {
    const res = await callTool('entity_manage', { action: 'get_sensory_profile' })
    expectSchemaHintError(res)
  })

  it('get_compatibility: missing interaction_type', async () => {
    const res = await callTool('entity_manage', { action: 'get_compatibility', entity_a: 'character:a', entity_b: 'character:b' })
    expectSchemaHintError(res)
  })

  it('get_inventory: missing entity_key', async () => {
    const res = await callTool('entity_manage', { action: 'get_inventory' })
    expectSchemaHintError(res)
  })

  it('transfer_item: missing item_key', async () => {
    const res = await callTool('entity_manage', { action: 'transfer_item', from_entity: 'character:a', to_entity: 'character:b' })
    expectSchemaHintError(res)
  })

  it('list_consumption_timelines: invalid status_filter', async () => {
    const res = await callTool('entity_manage', { action: 'list_consumption_timelines', status_filter: 'bogus' })
    expectSchemaHintError(res)
  })

  it('create_consumption_timeline: missing stages', async () => {
    const res = await callTool('entity_manage', {
      action: 'create_consumption_timeline', entity_key: 'character:a', predator_key: 'character:b', stage_timer: 5, terminal_state: 'consumed'
    })
    expectSchemaHintError(res)
  })

  it('set_consumption_timeline: missing entity_key', async () => {
    const res = await callTool('entity_manage', { action: 'set_consumption_timeline' })
    expectSchemaHintError(res)
  })
})
