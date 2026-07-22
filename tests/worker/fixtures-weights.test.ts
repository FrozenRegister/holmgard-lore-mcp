import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('canonical fixture — integer weight boundary values (5 min, 95 max)', () => {
  it('Weight-1:5 (minimum drive) normalizes to 0.05', async () => {
    await seedKV('entity:min-drive', 'Weight-1 (Drive): 5\nState-Level: 0')
    await seedKV('entity:passive', 'Weight-2: 0')
    const res = await callTool('entity_manage', {
      action: 'resolve_interaction',
      entity_a_id: 'entity:min-drive',
      entity_b_id: 'entity:passive',
      action_type: 'test',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1_raw).toBe(5)
    expect(res.result.metadata.weight_1).toBeCloseTo(0.05, 5)
  })

  it('Weight-1:95 (maximum drive) normalizes to 0.95', async () => {
    await seedKV('entity:max-drive', 'Weight-1 (Drive): 95\nState-Level: 0')
    await seedKV('entity:strong-resist', 'Weight-2 (Vulnerability): 95')
    const res = await callTool('entity_manage', {
      action: 'resolve_interaction',
      entity_a_id: 'entity:max-drive',
      entity_b_id: 'entity:strong-resist',
      action_type: 'test',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1_raw).toBe(95)
    expect(res.result.metadata.weight_1).toBeCloseTo(0.95, 5)
    expect(res.result.metadata.weight_2_raw).toBe(95)
    expect(res.result.metadata.weight_2).toBeCloseTo(0.95, 5)
    // P = (0.95 * 0.7) - (0.95 * 0.3) = 0.665 - 0.285 = 0.38
    expect(res.result.metadata.probability).toBeCloseTo(0.38, 3)
  })

  it('skill values (0.0–1.0 range) in Skills section are not further normalized', async () => {
    await seedKV('entity:skill-range-a', 'Weight-1: 0.5\nState-Level: 0')
    await seedKV('entity:skill-range-b', 'Weight-2: 0.3')
    const res = await callTool('entity_manage', {
      action: 'resolve_interaction',
      entity_a_id: 'entity:skill-range-a',
      entity_b_id: 'entity:skill-range-b',
      action_type: 'test',
    })
    expect(res.error).toBeUndefined()
    // 0.5 is already in [0,1] — no normalization
    expect(res.result.metadata.weight_1).toBe(0.5)
    expect(res.result.metadata.weight_2).toBe(0.3)
  })
})
