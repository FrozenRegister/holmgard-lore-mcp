import { describe, callTool } from './helpers'
import { expect, it } from 'vitest'

function expectSchemaHintError(res: any) {
  expect(res.error).toBeDefined()
  expect(res.error.code).toBe(-32602)
  expect(res.error.data.example).toBeDefined()
  expect(res.error.data.schema_hint).toContain('load_tool_schema')
}

describe('lore_manage invalid params include schema_hint and example', () => {
  it('set: missing text', async () => {
    const res = await callTool('lore_manage', { action: 'set', key: 'character:a' })
    expectSchemaHintError(res)
  })

  it('delete: missing key', async () => {
    const res = await callTool('lore_manage', { action: 'delete' })
    expectSchemaHintError(res)
  })

  it('patch: missing operation', async () => {
    const res = await callTool('lore_manage', { action: 'patch', key: 'character:a' })
    expectSchemaHintError(res)
  })

  it('batch_set: missing entries', async () => {
    const res = await callTool('lore_manage', { action: 'batch_set' })
    expectSchemaHintError(res)
  })

  it('batch_mutate: missing mutations', async () => {
    const res = await callTool('lore_manage', { action: 'batch_mutate' })
    expectSchemaHintError(res)
  })

  it('restore: missing key', async () => {
    const res = await callTool('lore_manage', { action: 'restore' })
    expectSchemaHintError(res)
  })

  it('history: missing keys', async () => {
    const res = await callTool('lore_manage', { action: 'history' })
    expectSchemaHintError(res)
  })

  it('increment: missing field_path', async () => {
    const res = await callTool('lore_manage', { action: 'increment', key: 'character:a' })
    expectSchemaHintError(res)
  })

  it('append_section: missing section', async () => {
    const res = await callTool('lore_manage', { action: 'append_section', key: 'character:a', text: 'hello' })
    expectSchemaHintError(res)
  })

  it('move: missing new_location_key', async () => {
    const res = await callTool('entity_manage', { action: 'move', entity_key: 'character:a' })
    expectSchemaHintError(res)
  })
})
