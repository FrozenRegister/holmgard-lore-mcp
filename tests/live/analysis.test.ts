import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MCP_API_KEY, tool, uid, setLore, deleteLore } from './helpers'

describe.skipIf(!MCP_API_KEY)('Analyze Utility', () => {
  let key: string

  beforeEach(async () => {
    key = `test:utility-subject-${uid()}`
    await setLore(key, [
      '**Tenderness-Index:** 0.80',
      '**Fat-Marbling-Index:** 0.75',
      '**Sensory-Receptivity:** 0.70',
      '**Weight-2 (Prey Vulnerability):** 0.65',
      '**Compliance-Potential:** 0.85',
      '**Cortisol-Level:** 0.20',
      '**Caloric-Yield-Estimate:** 0.72',
    ].join('\n'))
  })

  afterEach(async () => { await deleteLore(key) })

  it('analyze_utility GASTRIC vector', async () => {
    const res = await tool('analyze_utility', { entity_id: key, utility_vector: 'GASTRIC' })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/Grade/)
  })

  it('analyze_utility THRALL vector', async () => {
    const res = await tool('analyze_utility', { entity_id: key, utility_vector: 'THRALL' })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/Grade/)
  })

  it('analyze_utility DISTRIBUTED vector', async () => {
    const res = await tool('analyze_utility', { entity_id: key, utility_vector: 'DISTRIBUTED' })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/\/100/)
  })

  it('analyze_utility returns error for missing entity', async () => {
    const res = await tool('analyze_utility', { entity_id: 'nonexistent:entity-xyz', utility_vector: 'GASTRIC' })
    expect(res.error).toBeTruthy()
    expect(res.error.message).toMatch(/not found/)
  })

  it('analyze_utility live character returns Grade A', async () => {
    const res = await tool('analyze_utility', {
      entity_id: 'character:seraphine-herbalist',
      utility_vector: 'GASTRIC',
      entity_role: 'subject',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/Grade A/)
  })
})

describe.skipIf(!MCP_API_KEY)('Map Integration', () => {
  let sourceKey: string, targetKey: string

  beforeEach(async () => {
    sourceKey = `test:integration-source-${uid()}`
    targetKey = `test:integration-target-${uid()}`
    await Promise.all([
      setLore(sourceKey, [
        'Base traits of the source entity.',
        'Trait Alpha [Transferable]',
        'Trait Beta [Transferable]',
        '**Transferable-Skill:** combat mastery',
        'Non-transferable secret.',
      ].join('\n')),
      setLore(targetKey, 'Target entity base lore.'),
    ])
  })

  afterEach(async () => { await deleteLore(sourceKey, targetKey) })

  it('map_integration transfers traits at full depth', async () => {
    const res = await tool('map_integration', {
      source_id: sourceKey, target_id: targetKey, integration_depth: 1.0,
    })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/Integrated/)
  })

  it('map_integration written traits are retrievable', async () => {
    await tool('map_integration', {
      source_id: sourceKey, target_id: targetKey, integration_depth: 1.0,
    })
    const res = await tool('get_lore', { query: targetKey })
    expect(res.result.content[0].text).toMatch(/Integrated-From/)
  })

  it('map_integration with no transferable traits returns message', async () => {
    const plain = `test:integration-plain-${uid()}`
    await setLore(plain, 'No transferable traits here.')
    try {
      const res = await tool('map_integration', {
        source_id: plain, target_id: targetKey, integration_depth: 1.0,
      })
      expect(res.result.content[0].text).toMatch(/traits found in/)
    } finally {
      await deleteLore(plain)
    }
  })
})
