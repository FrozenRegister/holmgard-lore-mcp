import { describe, callTool } from './support/helpers'
import { expect, it } from 'vitest'

function expectSchemaHintError(res: any) {
  expect(res.error).toBeDefined()
  expect(res.error.code).toBe(-32602)
  expect(res.error.data.example).toBeDefined()
  expect(res.error.data.schema_hint).toContain('load_tool_schema')
}

describe('scene_manage invalid params include schema_hint and example', () => {
  it('activate: missing scene_key', async () => {
    const res = await callTool('scene_manage', { action: 'activate' })
    expectSchemaHintError(res)
  })

  it('present_choices: missing entity_key', async () => {
    const res = await callTool('scene_manage', { action: 'present_choices', scene_key: 'scene:a' })
    expectSchemaHintError(res)
  })

  it('commit_choice: missing entity_key', async () => {
    const res = await callTool('scene_manage', { action: 'commit_choice', choice_id: 'negotiate' })
    expectSchemaHintError(res)
  })

  it('get_history: missing entity_key', async () => {
    const res = await callTool('scene_manage', { action: 'get_history' })
    expectSchemaHintError(res)
  })

  it('brief: wrong type for include', async () => {
    const res = await callTool('scene_manage', { action: 'brief', location_key: 'location:a', include: 'not-an-object' })
    expectSchemaHintError(res)
  })

  it('render_pov: missing pov_entity_key', async () => {
    const res = await callTool('scene_manage', { action: 'render_pov' })
    expectSchemaHintError(res)
  })
})
