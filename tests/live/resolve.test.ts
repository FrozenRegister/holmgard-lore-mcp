import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { MCP_API_KEY, tool, uid, setLore, deleteLore } from './helpers'

describe.skipIf(!MCP_API_KEY)('Resolve Interaction', () => {
  let keyA: string, keyB: string, keyZeroA: string, keyHighB: string

  beforeAll(async () => {
    keyA = `test:resolver-a-${uid()}`
    keyB = `test:resolver-b-${uid()}`
    keyZeroA = `test:resolver-zero-a-${uid()}`
    keyHighB = `test:resolver-high-b-${uid()}`
    await Promise.all([
      setLore(keyA, '**Weight-1:** 1.0'),
      setLore(keyB, '**Weight-2:** 0'),
      setLore(keyZeroA, '**Weight-1:** 0'),
      setLore(keyHighB, '**Weight-2:** 1.0'),
    ])
  })

  afterAll(async () => { await deleteLore(keyA, keyB, keyZeroA, keyHighB) })

  it('resolve_interaction returns max probability when W1=1.0, W2=0 (P=0.700)', async () => {
    const res = await tool('resolve_interaction', {
      entity_a_id: keyA, entity_b_id: keyB, action_type: 'consume',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/P=0\.700/)
  })

  it('resolve_interaction fails with low probability (P=0)', async () => {
    const res = await tool('resolve_interaction', {
      entity_a_id: keyZeroA, entity_b_id: keyHighB, action_type: 'consume',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/FAILURE/)
  })

  it('resolve_interaction returns error for missing entity', async () => {
    const res = await tool('resolve_interaction', {
      entity_a_id: 'nonexistent:entity-xyz', entity_b_id: keyB, action_type: 'test',
    })
    expect(res.error).toBeTruthy()
    expect(res.error.message).toMatch(/not found/)
  })
})

describe.skipIf(!MCP_API_KEY)('Resolve Interaction - Bullet Format Weights', () => {
  let attackerKey: string, defenderKey: string

  beforeAll(async () => {
    attackerKey = `test:bullet-attacker-${uid()}`
    defenderKey = `test:bullet-defender-${uid()}`
    await Promise.all([
      setLore(attackerKey, '- **Weight-1 (Aggression/Predator-Drive):** 0.9\n**State-Level:** 0'),
      setLore(defenderKey, '- **Weight-2 (Resilience):** 0.1'),
    ])
  })

  afterAll(async () => { await deleteLore(attackerKey, defenderKey) })

  it('resolve_interaction computes P=0.600 for W1=0.9, W2=0.1 in bullet format', async () => {
    const res = await tool('resolve_interaction', {
      entity_a_id: attackerKey, entity_b_id: defenderKey, action_type: 'hunt',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/P=0\.600/)
  })
})
