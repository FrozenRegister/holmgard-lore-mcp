import {
  describe,
  rpc,
  callTool,
  callToolWithApiKey,
  seedKV,
  ADMIN_SECRET,
  parseEncounterTable,
} from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('resolve_interaction', () => {
  it('returns error when entity_a not found', async () => {
    await seedKV('character:defender', '**Weight-2:** 5')
    const res = await callTool('entity_manage', {
      action: 'resolve_interaction',
      entity_a_id: 'nonexistent:attacker',
      entity_b_id: 'character:defender',
      action_type: 'test',
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.message).toContain('not found')
  })

  it('returns error when entity_b not found', async () => {
    await seedKV('character:attacker', '**Weight-1:** 5')
    const res = await callTool('entity_manage', {
      action: 'resolve_interaction',
      entity_a_id: 'character:attacker',
      entity_b_id: 'nonexistent:defender',
      action_type: 'test',
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('returns error when entity_a is missing Weight-1 field', async () => {
    await seedKV('character:no-weight', 'no numeric fields here')
    await seedKV('character:has-weight-2', '**Weight-2:** 3')
    const res = await callTool('entity_manage', {
      action: 'resolve_interaction',
      entity_a_id: 'character:no-weight',
      entity_b_id: 'character:has-weight-2',
      action_type: 'test',
    })
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('Weight-1')
  })

  it('succeeds with high probability when W1=1.0, W2=0', async () => {
    // Formula: (w1*0.7) - (w2*0.3) → (1.0*0.7) - 0 = 0.7
    // This test verifies probability is computed correctly; outcome is probabilistic
    await seedKV('character:strong', '**Weight-1:** 1.0\n**State-Level:** 0')
    await seedKV('character:weak', '**Weight-2:** 0')
    const res = await callTool('entity_manage', {
      action: 'resolve_interaction',
      entity_a_id: 'character:strong',
      entity_b_id: 'character:weak',
      action_type: 'consume',
    })
    expect(res.result.metadata.probability).toBeCloseTo(0.7, 5)
    // Outcome is random with P=0.7, so we only verify structure
    expect(typeof res.result.success).toBe('boolean')
    if (res.result.success) {
      expect(res.result.delta_value).toBeGreaterThan(0)
    } else {
      expect(res.result.delta_value).toBe(0)
    }
  })

  it('ensures weights are normalized correctly before formula', async () => {
    // Weight-1: 100 (integer > 1) → normalized to 100/100 = 1.0
    // Weight-2: 0 → normalized to 0
    // Formula: (1.0*0.7) - (0*0.3) = 0.7
    await seedKV('character:normalized-attacker', '**Weight-1:** 100\n**State-Level:** 0')
    await seedKV('character:normalized-target', '**Weight-2:** 0')
    const res = await callTool('entity_manage', {
      action: 'resolve_interaction',
      entity_a_id: 'character:normalized-attacker',
      entity_b_id: 'character:normalized-target',
      action_type: 'hunt',
    })
    expect(res.result.metadata.weight_1).toBe(1.0)
    expect(res.result.metadata.weight_2).toBe(0)
    expect(res.result.metadata.probability).toBeCloseTo(0.7, 5)
    // Outcome is probabilistic (70% success), so check structure only
    expect(typeof res.result.success).toBe('boolean')
    expect(typeof res.result.delta_value).toBe('number')
  })

  it('always fails when P=0 (W1=0, high W2)', async () => {
    // Formula: 0 - 1.0*0.3 = -0.3, clamped to 0 → roll always >= 0
    await seedKV('character:zero-attacker', '**Weight-1:** 0')
    await seedKV('character:strong-defender', '**Weight-2:** 1.0')
    const res = await callTool('entity_manage', {
      action: 'resolve_interaction',
      entity_a_id: 'character:zero-attacker',
      entity_b_id: 'character:strong-defender',
      action_type: 'consume',
    })
    expect(res.result.success).toBe(false)
    expect(res.result.delta_value).toBe(0)
    expect(res.result.metadata.probability).toBe(0)
  })

  it('increments State-Level in KV on success', async () => {
    // W1=1.0, W2=0 → P=0.7
    await seedKV('character:winner', '**Weight-1:** 1.0\n**State-Level:** 5')
    await seedKV('character:loser', '**Weight-2:** 0')
    const res = await callTool('entity_manage', {
      action: 'resolve_interaction',
      entity_a_id: 'character:winner',
      entity_b_id: 'character:loser',
      action_type: 'consume',
    })
    const get = await callTool('lore_manage', { action: 'get', query: 'character:winner' })
    const level = parseInt(get.result.text.match(/\*\*State-Level:\*\*\s*(\d+)/)?.[1] ?? '5')
    if (res.result.success) {
      expect(level).toBe(5 + res.result.delta_value)
    } else {
      expect(level).toBe(5)
    }
  })

  it('does not modify KV on failure', async () => {
    // W1=0, W2=1.0 → P=0 → guaranteed failure
    await seedKV('character:guaranteed-fail', '**Weight-1:** 0\n**State-Level:** 3')
    await seedKV('character:guaranteed-win', '**Weight-2:** 1.0')
    await callTool('entity_manage', {
      action: 'resolve_interaction',
      entity_a_id: 'character:guaranteed-fail',
      entity_b_id: 'character:guaranteed-win',
      action_type: 'consume',
    })
    const get = await callTool('lore_manage', { action: 'get', query: 'character:guaranteed-fail' })
    expect(get.result.text).toContain('**State-Level:** 3')
  })

  it('returns metadata with weight_1, weight_2, probability, and roll', async () => {
    // 0.6 and 0.2 are in [0,1] — no normalization applied
    await seedKV('character:meta-a', '**Weight-1:** 0.6')
    await seedKV('character:meta-b', '**Weight-2:** 0.2')
    const res = await callTool('entity_manage', {
      action: 'resolve_interaction',
      entity_a_id: 'character:meta-a',
      entity_b_id: 'character:meta-b',
      action_type: 'test-action',
    })
    expect(res.result.metadata.weight_1).toBe(0.6)
    expect(res.result.metadata.weight_2).toBe(0.2)
    // P = (0.6 * 0.7) - (0.2 * 0.3) = 0.42 - 0.06 = 0.36
    expect(res.result.metadata.probability).toBeCloseTo(0.36, 5)
    expect(typeof res.result.metadata.roll).toBe('number')
    expect(res.result.metadata.action_type).toBe('test-action')
  })

  it('normalizes integer-scale weights (>1) to [0,1] before computing probability', async () => {
    // Integer weights like "Weight-1: 30" mean 30/100 = 0.30 in float terms
    await seedKV('character:int-actor', '**Weight-1:** 30\n**State-Level:** 0')
    await seedKV('character:int-target', '**Weight-2:** 55')
    const res = await callTool('entity_manage', {
      action: 'resolve_interaction',
      entity_a_id: 'character:int-actor',
      entity_b_id: 'character:int-target',
      action_type: 'hunt',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1).toBeCloseTo(0.3, 5)
    expect(res.result.metadata.weight_2).toBeCloseTo(0.55, 5)
    expect(res.result.metadata.weight_1_raw).toBe(30)
    expect(res.result.metadata.weight_2_raw).toBe(55)
    // P = (0.30 * 0.7) - (0.55 * 0.3) = 0.21 - 0.165 = 0.045
    expect(res.result.metadata.probability).toBeCloseTo(0.045, 3)
  })

  it('reads weights from plain loose-format fields (no bold markers)', async () => {
    // AI-written lore may omit **bold:** syntax; loose Pass 3 should handle it
    // Weight-1: 10 → normalizes to 0.10
    await seedKV('character:loose-attacker', 'Weight-1: 10\nState-Level: 0')
    await seedKV('character:loose-defender', 'Weight-2: 0')
    const res = await callTool('entity_manage', {
      action: 'resolve_interaction',
      entity_a_id: 'character:loose-attacker',
      entity_b_id: 'character:loose-defender',
      action_type: 'hunt',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1).toBeCloseTo(0.1, 5)
    expect(res.result.metadata.weight_1_raw).toBe(10)
    expect(res.result.metadata.weight_2).toBe(0)
  })

  it('reads weights from markdown-header loose format (# Field: value)', async () => {
    await seedKV(
      'character:header-attacker',
      '# Entity: subject-alpha\nWeight-1: 0.9\nState-Level: 0',
    )
    await seedKV('character:header-defender', '# Entity: prey-beta\nWeight-2: 0.1')
    const res = await callTool('entity_manage', {
      action: 'resolve_interaction',
      entity_a_id: 'character:header-attacker',
      entity_b_id: 'character:header-defender',
      action_type: 'consume',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1).toBe(0.9)
    expect(res.result.metadata.weight_2).toBe(0.1)
  })

  it('reads float weights from bullet-style descriptor fields', async () => {
    // Format used in real character lore: - **Weight-1 (Aggression/Predator-Drive):** 0.9
    await seedKV(
      'character:bullet-attacker',
      '- **Weight-1 (Aggression/Predator-Drive):** 0.9\n**State-Level:** 0',
    )
    await seedKV('character:bullet-defender', '- **Weight-2 (Resilience):** 0.1')
    const res = await callTool('entity_manage', {
      action: 'resolve_interaction',
      entity_a_id: 'character:bullet-attacker',
      entity_b_id: 'character:bullet-defender',
      action_type: 'hunt',
    })
    // P = (0.9 * 0.7) - (0.1 * 0.3) = 0.60 — should not error
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1).toBe(0.9)
    expect(res.result.metadata.weight_2).toBe(0.1)
  })
})
