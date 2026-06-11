import { describe, callTool, seedKV } from './helpers'
import { expect, it } from 'vitest'

describe('analyze_utility', () => {
  it('returns error when entity not found', async () => {
    const res = await callTool('entity_manage', { action: 'analyze_utility', entity_id: 'nonexistent:entity', utility_vector: 'GASTRIC' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('rejects old VECTOR_* enum values', async () => {
    await seedKV('character:any', 'text')
    const res = await callTool('entity_manage', { action: 'analyze_utility', entity_id: 'character:any', utility_vector: 'VECTOR_A' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('returns grade F and empty breakdown when entity has no matching numeric fields', async () => {
    await seedKV('character:blank', 'No numeric fields here. Status: active.')
    const res = await callTool('entity_manage', { action: 'analyze_utility', entity_id: 'character:blank', utility_vector: 'GASTRIC' })
    expect(res.result.grade).toBe('F')
    expect(res.result.composite_score).toBe(0)
    expect(res.result.breakdown).toEqual([])
    expect(res.result.fields_analyzed).toEqual([])
    expect(res.result.projected_yield).toContain('No quantifiable metrics')
    expect(res.result.missing_fields.length).toBeGreaterThan(0)
  })

  it('GASTRIC: computes correct score from spec example values', async () => {
    // All 6 fields present — no redistribution needed (weights stay as-is)
    // Expected sum: 0.88*0.25 + 0.82*0.20 + 0.84*0.20 + 0.75*0.15 + 0.91*0.10 + (1-0.18)*0.10
    // = 0.22 + 0.164 + 0.168 + 0.1125 + 0.091 + 0.082 = 0.8375 → *100 = 83.75 → round = 84
    await seedKV('character:seraphine', [
      '**Tenderness-Index:** 0.88',
      '**Fat-Marbling-Index:** 0.82',
      '**Sensory-Receptivity:** 0.84',
      '**Weight-2 (Prey Vulnerability):** 0.75',
      '**Compliance-Potential:** 0.91',
      '**Cortisol-Level:** 0.18',
    ].join('\n'))
    const res = await callTool('entity_manage', { action: 'analyze_utility', entity_id: 'character:seraphine', utility_vector: 'GASTRIC' })
    expect(res.result.grade).toBe('A')
    expect(res.result.composite_score).toBe(84)
    expect(res.result.entity_role).toBe('subject')
    expect(res.result.fields_analyzed).toHaveLength(6)
  })

  it('GASTRIC: cortisol inversion is applied and noted in breakdown', async () => {
    await seedKV('character:cortisol-test', [
      '**Tenderness-Index:** 0.80',
      '**Fat-Marbling-Index:** 0.80',
      '**Sensory-Receptivity:** 0.80',
      '**Weight-2:** 0.80',
      '**Compliance-Potential:** 0.80',
      '**Cortisol-Level:** 0.80',
    ].join('\n'))
    const res = await callTool('entity_manage', { action: 'analyze_utility', entity_id: 'character:cortisol-test', utility_vector: 'GASTRIC' })
    const cortisolEntry = res.result.breakdown.find((b: any) => b.field === 'Cortisol-Level')
    expect(cortisolEntry).toBeDefined()
    expect(cortisolEntry.raw_value).toBe(0.8)
    expect(cortisolEntry.effective_value).toBeCloseTo(0.2, 2)
    expect(cortisolEntry.note).toMatch(/INVERTED/)
  })

  it('GASTRIC: missing fields reduce pool and redistribute weights', async () => {
    // Only 2 of 6 fields present — weights for present fields are scaled up
    await seedKV('character:partial', [
      '**Tenderness-Index:** 1.0',
      '**Compliance-Potential:** 1.0',
    ].join('\n'))
    const res = await callTool('entity_manage', { action: 'analyze_utility', entity_id: 'character:partial', utility_vector: 'GASTRIC' })
    // missing 4 fields — Tenderness (0.25) + Compliance (0.10) = 0.35 total present weight
    // redistributed: Tenderness = 0.25/0.35 ≈ 0.714, Compliance = 0.10/0.35 ≈ 0.286
    // score = 1.0*0.714*100 + 1.0*0.286*100 = 100 → clamped 100 → Grade S
    expect(res.result.grade).toBe('S')
    expect(res.result.composite_score).toBe(100)
    expect(res.result.missing_fields).toContain('Fat-Marbling-Index')
    expect(res.result.missing_fields).toContain('Sensory-Receptivity')
    expect(res.result.missing_fields).toContain('Cortisol-Level')
    // redistributed weights on the two present fields must sum to ~1.0
    const weightSum = res.result.breakdown.reduce((s: number, b: any) => s + b.weight, 0)
    expect(weightSum).toBeCloseTo(1.0, 1)
  })

  it('scans more than 4 numeric fields (regression for truncation bug)', async () => {
    // Previously capped at 4 — verify all 8 fields are picked up
    await seedKV('character:rich', [
      '**Tenderness-Index:** 0.90',
      '**Fat-Marbling-Index:** 0.85',
      '**Sensory-Receptivity:** 0.80',
      '**Weight-2:** 0.75',
      '**Compliance-Potential:** 0.70',
      '**Cortisol-Level:** 0.10',
      '**Resilience:** 0.60',
      '**Acceptance:** 0.65',
    ].join('\n'))
    const res = await callTool('entity_manage', { action: 'analyze_utility', entity_id: 'character:rich', utility_vector: 'GASTRIC' })
    // All 6 GASTRIC fields present — no missing, no redistribution
    expect(res.result.missing_fields).toEqual([])
    expect(res.result.fields_analyzed).toHaveLength(6)
  })

  it('parses bulleted parenthetical format: - **Weight-2 (Prey Vulnerability):** 0.75', async () => {
    await seedKV('character:bullet-fmt', [
      '- **Tenderness-Index:** 0.80',
      '- **Fat-Marbling-Index:** 0.80',
      '- **Sensory-Receptivity:** 0.80',
      '- **Weight-2 (Prey Vulnerability):** 0.80',
      '- **Compliance-Potential:** 0.80',
      '- **Cortisol-Level:** 0.20',
    ].join('\n'))
    const res = await callTool('entity_manage', { action: 'analyze_utility', entity_id: 'character:bullet-fmt', utility_vector: 'GASTRIC' })
    expect(res.result.missing_fields).toEqual([])
    expect(res.result.fields_analyzed).toHaveLength(6)
  })

  it('grade boundaries: S=90+, A=75-89, B=55-74, C=35-54, D=15-34, F=0-14', async () => {
    // Force exact scores by using THRALL with only compliance-potential present (weight=1.0 after redistribution)
    const cases: Array<[number, string]> = [
      [0.95, 'S'],  // 95 → S
      [0.80, 'A'],  // 80 → A
      [0.65, 'B'],  // 65 → B
      [0.45, 'C'],  // 45 → C
      [0.25, 'D'],  // 25 → D
      [0.05, 'F'],  // 5 → F
    ]
    for (const [val, expected] of cases) {
      const key = `character:grade-${expected.toLowerCase()}`
      await seedKV(key, `**Compliance-Potential:** ${val}`)
      const res = await callTool('entity_manage', { action: 'analyze_utility', entity_id: key, utility_vector: 'THRALL' })
      expect(res.result.grade).toBe(expected)
    }
  })

  it('all 7 vectors are accepted and produce distinct projected_yield narratives', async () => {
    await seedKV('character:all-vectors', [
      '**Tenderness-Index:** 0.70',
      '**Fat-Marbling-Index:** 0.70',
      '**Sensory-Receptivity:** 0.70',
      '**Weight-2:** 0.70',
      '**Compliance-Potential:** 0.70',
      '**Cortisol-Level:** 0.30',
      '**Caloric-Yield-Estimate:** 0.70',
    ].join('\n'))
    const vectors = ['GASTRIC', 'BUTCHERY', 'INCUBATION', 'SCULPTURE', 'PARASITISM', 'THRALL', 'DISTRIBUTED'] as const
    const results = await Promise.all(
      vectors.map(v => callTool('entity_manage', { action: 'analyze_utility', entity_id: 'character:all-vectors', utility_vector: v }))
    )
    for (const r of results) expect(r.error).toBeUndefined()
    const yields = results.map(r => r.result.projected_yield)
    const unique = new Set(yields)
    expect(unique.size).toBe(7)
  })

  it('entity_role actor uses actor field table (Weight-1, Aggression, Hunger)', async () => {
    await seedKV('character:predator', [
      '**Weight-1 (Predator Drive):** 0.90',
      '**Aggression:** 0.85',
      '**Hunger:** 0.80',
      '**Patience:** 0.70',
    ].join('\n'))
    const res = await callTool('entity_manage', { action: 'analyze_utility', entity_id: 'character:predator', utility_vector: 'GASTRIC', entity_role: 'actor' })
    expect(res.result.entity_role).toBe('actor')
    expect(res.result.fields_analyzed.some((f: string) => /Weight-1/i.test(f))).toBe(true)
    // subject fields like Tenderness-Index should not appear in actor breakdown
    expect(res.result.fields_analyzed.some((f: string) => /Tenderness/i.test(f))).toBe(false)
    expect(res.result.projected_yield).toContain('Actor capability')
  })

  it('breakdown entries have required structure', async () => {
    await seedKV('character:struct-check', [
      '**Tenderness-Index:** 0.70',
      '**Fat-Marbling-Index:** 0.65',
    ].join('\n'))
    const res = await callTool('entity_manage', { action: 'analyze_utility', entity_id: 'character:struct-check', utility_vector: 'GASTRIC' })
    expect(res.result.breakdown.length).toBeGreaterThan(0)
    for (const entry of res.result.breakdown) {
      expect(entry).toHaveProperty('field')
      expect(entry).toHaveProperty('raw_value')
      expect(entry).toHaveProperty('weight')
      expect(entry).toHaveProperty('effective_value')
      expect(entry).toHaveProperty('contribution')
      expect(typeof entry.contribution).toBe('number')
    }
  })

  it('composite_score is clamped to [0, 100] even when normalized caloric value exceeds 200,000', async () => {
    // 400,000 kcal / 200,000 = 2.0, clamped to 1.0 → contribution = 100 → score = 100
    await seedKV('character:overflow', '**Caloric-Yield-Estimate:** 400000')
    const res = await callTool('entity_manage', { action: 'analyze_utility', entity_id: 'character:overflow', utility_vector: 'DISTRIBUTED' })
    expect(res.result.composite_score).toBe(100)
  })

  it('parses comma-formatted Caloric-Yield-Estimate (135,000 kcal) and normalizes by 200,000', async () => {
    // 135,000 / 200,000 = 0.675; only caloric field present for DISTRIBUTED → weight redistributes to 1.0
    // contribution = 0.675 * 1.0 * 100 = 67.5 → round = 68; Grade B (55-74)
    await seedKV('character:caloric-comma', '**Caloric-Yield-Estimate:** 135,000 kcal')
    const res = await callTool('entity_manage', { action: 'analyze_utility', entity_id: 'character:caloric-comma', utility_vector: 'DISTRIBUTED' })
    expect(res.result.composite_score).toBe(68)
    expect(res.result.grade).toBe('B')
    const caloricEntry = res.result.breakdown.find((b: any) => /caloric/i.test(b.field))
    expect(caloricEntry.raw_value).toBe(135000)
    expect(caloricEntry.effective_value).toBeCloseTo(0.675, 2)
  })

  it('DISTRIBUTED: missing caloric-yield-estimate redistributes weight to remaining fields', async () => {
    // caloric-yield-estimate absent (weight 0.40) — remaining 4 fields present
    // present weights: 0.25 + 0.15 + 0.10 + 0.10 = 0.60
    // with all values at 0.80 and cortisol at 0.20 (inverted → 0.80), score redistributes to 100*0.60 ≈ 80
    await seedKV('character:dist-partial', [
      '**Fat-Marbling-Index:** 0.80',
      '**Tenderness-Index:** 0.80',
      '**Cortisol-Level:** 0.20',
      '**Weight-2:** 0.80',
    ].join('\n'))
    const res = await callTool('entity_manage', { action: 'analyze_utility', entity_id: 'character:dist-partial', utility_vector: 'DISTRIBUTED' })
    expect(res.result.missing_fields).toContain('Caloric-Yield-Estimate')
    expect(res.result.composite_score).toBe(80)
  })
})

describe('map_integration', () => {
  it('returns error when source not found', async () => {
    await seedKV('character:target-only', 'Target lore.')
    const res = await callTool('entity_manage', {
      action: 'map_integration',
      source_id: 'nonexistent:source',
      target_id: 'character:target-only',
      integration_depth: 0.5,
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.message).toContain('nonexistent:source')
  })

  it('returns error when target not found', async () => {
    await seedKV('character:source-only', 'Source lore. [Transferable]')
    const res = await callTool('entity_manage', {
      action: 'map_integration',
      source_id: 'character:source-only',
      target_id: 'nonexistent:target',
      integration_depth: 0.5,
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('returns empty updated_traits when source has no [Transferable] lines', async () => {
    await seedKV('character:plain-source', 'No transferable traits here.')
    await seedKV('character:plain-target', 'Target entry.')
    const res = await callTool('entity_manage', {
      action: 'map_integration',
      source_id: 'character:plain-source',
      target_id: 'character:plain-target',
      integration_depth: 1.0,
    })
    expect(res.result.updated_traits).toHaveLength(0)
    expect(res.result.content[0].text).toContain('No [Transferable]')
  })

  it('returns 0 traits when integration_depth is 0', async () => {
    await seedKV('character:depth-zero-src', 'Trait A [Transferable]\nTrait B [Transferable]')
    await seedKV('character:depth-zero-tgt', 'Target.')
    const res = await callTool('entity_manage', {
      action: 'map_integration',
      source_id: 'character:depth-zero-src',
      target_id: 'character:depth-zero-tgt',
      integration_depth: 0,
    })
    expect(res.result.updated_traits).toHaveLength(0)
  })

  it('transfers all traits at depth=1.0', async () => {
    await seedKV('character:full-src', 'Trait A [Transferable]\nTrait B [Transferable]\nTrait C [Transferable]')
    await seedKV('character:full-tgt', 'Target lore.')
    const res = await callTool('entity_manage', {
      action: 'map_integration',
      source_id: 'character:full-src',
      target_id: 'character:full-tgt',
      integration_depth: 1.0,
    })
    expect(res.result.updated_traits).toHaveLength(3)
    expect(res.result.metadata.transferred_count).toBe(3)
    expect(res.result.metadata.total_transferable).toBe(3)
  })

  it('floors the trait count at partial depth', async () => {
    // 3 traits × depth 0.6 = floor(1.8) = 1
    await seedKV('character:partial-src', 'Trait A [Transferable]\nTrait B [Transferable]\nTrait C [Transferable]')
    await seedKV('character:partial-tgt', 'Target.')
    const res = await callTool('entity_manage', {
      action: 'map_integration',
      source_id: 'character:partial-src',
      target_id: 'character:partial-tgt',
      integration_depth: 0.6,
    })
    expect(res.result.updated_traits).toHaveLength(1)
  })

  it('writes transferred traits into target lore', async () => {
    await seedKV('character:write-src', 'Unique-Trait-XYZ [Transferable]')
    await seedKV('character:write-tgt', 'Base target.')
    await callTool('entity_manage', {
      action: 'map_integration',
      source_id: 'character:write-src',
      target_id: 'character:write-tgt',
      integration_depth: 1.0,
    })
    const get = await callTool('lore_manage', { action: 'get', query: 'character:write-tgt' })
    expect(get.result.text).toContain('Unique-Trait-XYZ')
    expect(get.result.text).toContain('Integrated-From')
  })

  it('pushes history for the target before writing', async () => {
    await seedKV('character:hist-src', 'Trait [Transferable]')
    await seedKV('character:hist-tgt', 'Original target text.')
    await callTool('entity_manage', {
      action: 'map_integration',
      source_id: 'character:hist-src',
      target_id: 'character:hist-tgt',
      integration_depth: 1.0,
    })
    const restore = await callTool('lore_manage', { action: 'restore', key: 'character:hist-tgt' })
    expect(restore.result.metadata.restored).toBe(true)
    const get = await callTool('lore_manage', { action: 'get', query: 'character:hist-tgt' })
    expect(get.result.text).toBe('Original target text.')
  })

  it('also matches **Transferable-* prefixed fields', async () => {
    await seedKV('character:prefixed-src', '**Transferable-Skill:** combat mastery\n**Non-Transferable:** secret')
    await seedKV('character:prefixed-tgt', 'Target.')
    const res = await callTool('entity_manage', {
      action: 'map_integration',
      source_id: 'character:prefixed-src',
      target_id: 'character:prefixed-tgt',
      integration_depth: 1.0,
    })
    expect(res.result.updated_traits).toHaveLength(1)
    expect(res.result.updated_traits[0]).toContain('Transferable-Skill')
  })
})
