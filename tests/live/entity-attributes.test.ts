// Live smoke coverage for #410 — entity_manage.set_attributes/get_attributes
// write/read D1-backed interaction attributes, and resolve_interaction treats
// them as the primary source of truth over KV markdown parsing.
import { describe, it, expect } from 'vitest'
import { MCP_API_KEY, tool, setLore, deleteLore, uid } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(res: any) {
  if (res.error) return { error: true, message: res.error.message }
  return JSON.parse(res.result.content[0].text)
}

describe.skipIf(!MCP_API_KEY)('entity_manage get_attributes / set_attributes (#410)', () => {
  it('set_attributes writes a D1 row that resolve_interaction reads over KV', async () => {
    const keyA = `entity:attrs-live-a-${uid()}`
    const keyB = `entity:attrs-live-b-${uid()}`
    await setLore(keyA, '**Weight-1:** 0.1')
    await setLore(keyB, '**Weight-2:** 0.9')

    const setA = await tool('entity_manage', {
      action: 'set_attributes',
      entity_key: keyA,
      attributes: { 'weight-1': 1.0 },
    })
    expect(setA.result.attributes['weight-1']).toBe(1.0)
    const setB = await tool('entity_manage', {
      action: 'set_attributes',
      entity_key: keyB,
      attributes: { 'weight-2': 0.0 },
    })
    expect(setB.result.attributes['weight-2']).toBe(0.0)

    const got = await tool('entity_manage', { action: 'get_attributes', entity_key: keyA })
    expect(got.result.source).toBe('d1')
    expect(got.result.attributes['weight-1']).toBe(1.0)

    const resolved = await tool('entity_manage', {
      action: 'resolve_interaction',
      entity_a_id: keyA,
      entity_b_id: keyB,
      action_type: 'test',
    })
    expect(resolved.result.metadata.weight_1).toBe(1.0)
    expect(resolved.result.metadata.weight_2).toBe(0.0)
    expect(resolved.result.metadata.weight_1_source).toBe('d1')
    expect(resolved.result.metadata.weight_2_source).toBe('d1')

    await deleteLore(keyA, keyB)
  })

  it('returns an error for an unknown entity', async () => {
    const res = parseResult(
      await tool('entity_manage', { action: 'get_attributes', entity_key: `nonexistent:${uid()}` }),
    )
    expect(res.error).toBe(true)
  })
})
