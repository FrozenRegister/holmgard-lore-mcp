import { describe, callTool } from './helpers'
import { expect, it } from 'vitest'

function expectSchemaHintError(res: any) {
  expect(res.error).toBeDefined()
  expect(res.error.code).toBe(-32602)
  expect(res.error.data.example).toBeDefined()
  expect(res.error.data.schema_hint).toContain('load_tool_schema')
}

describe('lore_manage (system.ts handlers) invalid params include schema_hint and example', () => {
  it('get_map: missing map_id', async () => {
    const res = await callTool('lore_manage', { action: 'get_map' })
    expectSchemaHintError(res)
  })

  it('get: missing query', async () => {
    const res = await callTool('lore_manage', { action: 'get' })
    expectSchemaHintError(res)
  })

  it('get_batch: missing keys', async () => {
    const res = await callTool('lore_manage', { action: 'get_batch' })
    expectSchemaHintError(res)
  })

  it('get_section: missing sections', async () => {
    const res = await callTool('lore_manage', { action: 'get_section', key: 'character:a' })
    expectSchemaHintError(res)
  })

  it('validate: missing query_string', async () => {
    const res = await callTool('lore_manage', { action: 'validate' })
    expectSchemaHintError(res)
  })

  it('search: missing query', async () => {
    const res = await callTool('lore_manage', { action: 'search' })
    expectSchemaHintError(res)
  })
})
