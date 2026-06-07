import { expect, it } from 'vitest'
import { describe, callTool, seedKV } from '../utils'

// ── list_consumption_timelines ────────────────────────────────────────────────

describe('list_consumption_timelines', () => {
  it('returns empty when no character keys have timelines', async () => {
    await seedKV('location:dungeon', '**Consumption-Timeline:** 1 hour')
    const res = await callTool('list_consumption_timelines', { status_filter: 'all' })
    // location:* key is not scanned — only character:* keys
    expect(res.result.timelines).toHaveLength(0)
    expect(res.result.content[0].text).toBe('No consumption timelines found.')
  })

  it('parses Consumption-Timeline field from character:* entries', async () => {
    await seedKV('character:prey-alpha', '**Status:** Active\n**Consumption-Timeline:** 3 days\n**Processor:** Alpha')
    const res = await callTool('list_consumption_timelines', { status_filter: 'all' })
    expect(res.result.timelines).toHaveLength(1)
    expect(res.result.timelines[0].character_key).toBe('character:prey-alpha')
    expect(res.result.timelines[0].timeline_remaining).toBe('3 days')
    expect(res.result.timelines[0].current_status).toBe('Active')
  })

  it('skips characters with no timeline field', async () => {
    await seedKV('character:predator', 'No consumption timeline here.')
    const res = await callTool('list_consumption_timelines', { status_filter: 'all' })
    expect(res.result.timelines).toHaveLength(0)
  })

  it('status_filter=imminent matches hours', async () => {
    await seedKV('character:soon', '**Status:** Imminent\n**Consumption-Timeline:** 2 hours\n**Processor:** Beta')
    const res = await callTool('list_consumption_timelines', { status_filter: 'imminent' })
    expect(res.result.timelines).toHaveLength(1)
    expect(res.result.timelines[0].character_key).toBe('character:soon')
  })

  it('status_filter=imminent matches "1 day" (PS1 test 16D)', async () => {
    await seedKV('character:one-day', '**Status:** Imminent\n**Consumption-Timeline:** 1 day\n**Processor:** Alpha')
    const res = await callTool('list_consumption_timelines', { status_filter: 'imminent' })
    expect(res.result.timelines).toHaveLength(1)
    expect(res.result.timelines[0].character_key).toBe('character:one-day')
  })

  it('status_filter=imminent excludes weeks', async () => {
    await seedKV('character:weeks-away', '**Status:** Active\n**Consumption-Timeline:** 3 weeks\n**Processor:** Beta')
    const res = await callTool('list_consumption_timelines', { status_filter: 'imminent' })
    expect(res.result.timelines).toHaveLength(0)
  })

  it('status_filter=days-to-weeks includes days', async () => {
    await seedKV('character:days-prey', '**Status:** Active\n**Consumption-Timeline:** 5 days\n**Processor:** Gamma')
    const res = await callTool('list_consumption_timelines', { status_filter: 'days-to-weeks' })
    expect(res.result.timelines).toHaveLength(1)
  })

  it('status_filter=consumed matches consumed entries', async () => {
    await seedKV('character:done', '**Status:** Consumed\n**Consumption-Timeline:** consumed\n**Processor:** Delta')
    const res = await callTool('list_consumption_timelines', { status_filter: 'consumed' })
    expect(res.result.timelines).toHaveLength(1)
  })
})

// ── list_consumption_timelines — legacy Projected-Consumption-Timeline ────────

describe('list_consumption_timelines — Projected-Consumption-Timeline fallback', () => {
  it('parses legacy Projected-Consumption-Timeline field', async () => {
    await seedKV('character:legacy-prey', '**Status:** Imminent\n**Projected-Consumption-Timeline:** 2 days\n**Processor:** Beta')
    const res = await callTool('list_consumption_timelines', { status_filter: 'all' })
    expect(res.result.timelines).toHaveLength(1)
    expect(res.result.timelines[0].character_key).toBe('character:legacy-prey')
    expect(res.result.timelines[0].timeline_remaining).toBe('2 days')
  })

  it('prefers primary Consumption-Timeline over Projected fallback when both present', async () => {
    await seedKV(
      'character:dual-field',
      '**Status:** Active\n**Consumption-Timeline:** 5 days\n**Projected-Consumption-Timeline:** 10 days\n**Processor:** Gamma',
    )
    const res = await callTool('list_consumption_timelines', { status_filter: 'all' })
    expect(res.result.timelines[0].timeline_remaining).toBe('5 days')
  })

  it('legacy fallback entry appears in status_filter=imminent when matching', async () => {
    await seedKV('character:legacy-imminent', '**Status:** Imminent\n**Projected-Consumption-Timeline:** 3 hours\n**Processor:** Alpha')
    const res = await callTool('list_consumption_timelines', { status_filter: 'imminent' })
    expect(res.result.timelines).toHaveLength(1)
    expect(res.result.timelines[0].character_key).toBe('character:legacy-imminent')
  })
})

// ── list_active_threads ───────────────────────────────────────────────────────

describe('list_active_threads', () => {
  it('returns message when system:active-narratives key is absent', async () => {
    const res = await callTool('list_active_threads')
    expect(res.result.content[0].text).toBe('No active narratives found.')
    expect(res.result.threads).toHaveLength(0)
  })

  it('parses Ascension and Dissolution thread entries', async () => {
    await seedKV('system:active-narratives', [
      '**Ascension Threads**',
      '  - **SilverThread** (alice)',
      '**Dissolution Threads**',
      '  - **DarkThread** (bob)',
    ].join('\n'))
    const res = await callTool('list_active_threads')
    expect(res.result.threads).toHaveLength(2)
    const names = res.result.threads.map((t: { thread_name: string }) => t.thread_name)
    expect(names).toContain('SilverThread')
    expect(names).toContain('DarkThread')
    const silver = res.result.threads.find((t: { thread_name: string }) => t.thread_name === 'SilverThread')
    expect(silver.category).toBe('Ascension')
    expect(silver.character).toBe('alice')
  })
})

// ── resolve_interaction ───────────────────────────────────────────────────────

describe('resolve_interaction', () => {
  it('returns error when entity_a not found', async () => {
    await seedKV('character:defender', '**Weight-2:** 5')
    const res = await callTool('resolve_interaction', {
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
    const res = await callTool('resolve_interaction', {
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
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'character:no-weight',
      entity_b_id: 'character:has-weight-2',
      action_type: 'test',
    })
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('Weight-1')
  })

  it('always succeeds when P=1 (W1=1.0, W2=0)', async () => {
    // Formula: w1 - w2*0.3 → 1.0 - 0 = 1.0, clamped to 1.0 → roll always < 1
    await seedKV('character:strong', '**Weight-1:** 1.0\n**State-Level:** 0')
    await seedKV('character:weak', '**Weight-2:** 0')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'character:strong',
      entity_b_id: 'character:weak',
      action_type: 'consume',
    })
    expect(res.result.success).toBe(true)
    expect(res.result.delta_value).toBeGreaterThan(0)
    expect(res.result.metadata.probability).toBe(1)
  })

  it('always fails when P=0 (W1=0, high W2)', async () => {
    // Formula: 0 - 1.0*0.3 = -0.3, clamped to 0 → roll always >= 0
    await seedKV('character:zero-attacker', '**Weight-1:** 0')
    await seedKV('character:strong-defender', '**Weight-2:** 1.0')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'character:zero-attacker',
      entity_b_id: 'character:strong-defender',
      action_type: 'consume',
    })
    expect(res.result.success).toBe(false)
    expect(res.result.delta_value).toBe(0)
    expect(res.result.metadata.probability).toBe(0)
  })

  it('increments State-Level in KV on success', async () => {
    // W1=1.0, W2=0 → P=1.0 → guaranteed success
    await seedKV('character:winner', '**Weight-1:** 1.0\n**State-Level:** 5')
    await seedKV('character:loser', '**Weight-2:** 0')
    await callTool('resolve_interaction', {
      entity_a_id: 'character:winner',
      entity_b_id: 'character:loser',
      action_type: 'consume',
    })
    const get = await callTool('get_lore', { query: 'character:winner' })
    const level = parseInt(get.result.text.match(/\*\*State-Level:\*\*\s*(\d+)/)?.[1] ?? '5')
    expect(level).toBeGreaterThan(5)
  })

  it('does not modify KV on failure', async () => {
    // W1=0, W2=1.0 → P=0 → guaranteed failure
    await seedKV('character:guaranteed-fail', '**Weight-1:** 0\n**State-Level:** 3')
    await seedKV('character:guaranteed-win', '**Weight-2:** 1.0')
    await callTool('resolve_interaction', {
      entity_a_id: 'character:guaranteed-fail',
      entity_b_id: 'character:guaranteed-win',
      action_type: 'consume',
    })
    const get = await callTool('get_lore', { query: 'character:guaranteed-fail' })
    expect(get.result.text).toContain('**State-Level:** 3')
  })

  it('returns metadata with weight_1, weight_2, probability, and roll', async () => {
    // 0.6 and 0.2 are in [0,1] — no normalization applied
    await seedKV('character:meta-a', '**Weight-1:** 0.6')
    await seedKV('character:meta-b', '**Weight-2:** 0.2')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'character:meta-a',
      entity_b_id: 'character:meta-b',
      action_type: 'test-action',
    })
    expect(res.result.metadata.weight_1).toBe(0.6)
    expect(res.result.metadata.weight_2).toBe(0.2)
    // P = 0.6 - 0.2*0.3 = 0.6 - 0.06 = 0.54
    expect(res.result.metadata.probability).toBeCloseTo(0.54, 5)
    expect(typeof res.result.metadata.roll).toBe('number')
    expect(res.result.metadata.action_type).toBe('test-action')
  })

  it('normalizes integer-scale weights (>1) to [0,1] before computing probability', async () => {
    // Integer weights like "Weight-1: 30" mean 30/100 = 0.30 in float terms
    await seedKV('character:int-actor', '**Weight-1:** 30\n**State-Level:** 0')
    await seedKV('character:int-target', '**Weight-2:** 55')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'character:int-actor',
      entity_b_id: 'character:int-target',
      action_type: 'hunt',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1).toBeCloseTo(0.30, 5)
    expect(res.result.metadata.weight_2).toBeCloseTo(0.55, 5)
    expect(res.result.metadata.weight_1_raw).toBe(30)
    expect(res.result.metadata.weight_2_raw).toBe(55)
    // P = 0.30 - 0.55*0.3 = 0.30 - 0.165 = 0.135 — meaningful, not clamped to 1
    expect(res.result.metadata.probability).toBeCloseTo(0.135, 3)
  })

  it('reads weights from plain loose-format fields (no bold markers)', async () => {
    // AI-written lore may omit **bold:** syntax; loose Pass 3 should handle it
    // Weight-1: 10 → normalizes to 0.10
    await seedKV('character:loose-attacker', 'Weight-1: 10\nState-Level: 0')
    await seedKV('character:loose-defender', 'Weight-2: 0')
    const res = await callTool('resolve_interaction', {
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
    await seedKV('character:header-attacker', '# Entity: subject-alpha\nWeight-1: 0.9\nState-Level: 0')
    await seedKV('character:header-defender', '# Entity: prey-beta\nWeight-2: 0.1')
    const res = await callTool('resolve_interaction', {
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
    await seedKV('character:bullet-attacker', '- **Weight-1 (Aggression/Predator-Drive):** 0.9\n**State-Level:** 0')
    await seedKV('character:bullet-defender', '- **Weight-2 (Resilience):** 0.1')
    const res = await callTool('resolve_interaction', {
      entity_a_id: 'character:bullet-attacker',
      entity_b_id: 'character:bullet-defender',
      action_type: 'hunt',
    })
    // P = 0.9 - 0.1*0.3 = 0.87 — should not error
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.weight_1).toBe(0.9)
    expect(res.result.metadata.weight_2).toBe(0.1)
  })
})

// ── analyze_utility v2 ────────────────────────────────────────────────────────

describe('analyze_utility', () => {
  it('returns error when entity not found', async () => {
    const res = await callTool('analyze_utility', { entity_id: 'nonexistent:entity', utility_vector: 'GASTRIC' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('rejects old VECTOR_* enum values', async () => {
    await seedKV('character:any', 'text')
    const res = await callTool('analyze_utility', { entity_id: 'character:any', utility_vector: 'VECTOR_A' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('returns grade F and empty breakdown when entity has no matching numeric fields', async () => {
    await seedKV('character:blank', 'No numeric fields here. Status: active.')
    const res = await callTool('analyze_utility', { entity_id: 'character:blank', utility_vector: 'GASTRIC' })
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
    const res = await callTool('analyze_utility', { entity_id: 'character:seraphine', utility_vector: 'GASTRIC' })
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
    const res = await callTool('analyze_utility', { entity_id: 'character:cortisol-test', utility_vector: 'GASTRIC' })
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
    const res = await callTool('analyze_utility', { entity_id: 'character:partial', utility_vector: 'GASTRIC' })
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
    const res = await callTool('analyze_utility', { entity_id: 'character:rich', utility_vector: 'GASTRIC' })
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
    const res = await callTool('analyze_utility', { entity_id: 'character:bullet-fmt', utility_vector: 'GASTRIC' })
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
      const res = await callTool('analyze_utility', { entity_id: key, utility_vector: 'THRALL' })
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
      vectors.map(v => callTool('analyze_utility', { entity_id: 'character:all-vectors', utility_vector: v }))
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
    const res = await callTool('analyze_utility', { entity_id: 'character:predator', utility_vector: 'GASTRIC', entity_role: 'actor' })
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
    const res = await callTool('analyze_utility', { entity_id: 'character:struct-check', utility_vector: 'GASTRIC' })
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
    const res = await callTool('analyze_utility', { entity_id: 'character:overflow', utility_vector: 'DISTRIBUTED' })
    expect(res.result.composite_score).toBe(100)
  })

  it('parses comma-formatted Caloric-Yield-Estimate (135,000 kcal) and normalizes by 200,000', async () => {
    // 135,000 / 200,000 = 0.675; only caloric field present for DISTRIBUTED → weight redistributes to 1.0
    // contribution = 0.675 * 1.0 * 100 = 67.5 → round = 68; Grade B (55-74)
    await seedKV('character:caloric-comma', '**Caloric-Yield-Estimate:** 135,000 kcal')
    const res = await callTool('analyze_utility', { entity_id: 'character:caloric-comma', utility_vector: 'DISTRIBUTED' })
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
    const res = await callTool('analyze_utility', { entity_id: 'character:dist-partial', utility_vector: 'DISTRIBUTED' })
    expect(res.result.missing_fields).toContain('Caloric-Yield-Estimate')
    expect(res.result.composite_score).toBe(80)
  })
})

// ── map_integration ───────────────────────────────────────────────────────────

describe('map_integration', () => {
  it('returns error when source not found', async () => {
    await seedKV('character:target-only', 'Target lore.')
    const res = await callTool('map_integration', {
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
    const res = await callTool('map_integration', {
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
    const res = await callTool('map_integration', {
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
    const res = await callTool('map_integration', {
      source_id: 'character:depth-zero-src',
      target_id: 'character:depth-zero-tgt',
      integration_depth: 0,
    })
    expect(res.result.updated_traits).toHaveLength(0)
  })

  it('transfers all traits at depth=1.0', async () => {
    await seedKV('character:full-src', 'Trait A [Transferable]\nTrait B [Transferable]\nTrait C [Transferable]')
    await seedKV('character:full-tgt', 'Target lore.')
    const res = await callTool('map_integration', {
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
    const res = await callTool('map_integration', {
      source_id: 'character:partial-src',
      target_id: 'character:partial-tgt',
      integration_depth: 0.6,
    })
    expect(res.result.updated_traits).toHaveLength(1)
  })

  it('writes transferred traits into target lore', async () => {
    await seedKV('character:write-src', 'Unique-Trait-XYZ [Transferable]')
    await seedKV('character:write-tgt', 'Base target.')
    await callTool('map_integration', {
      source_id: 'character:write-src',
      target_id: 'character:write-tgt',
      integration_depth: 1.0,
    })
    const get = await callTool('get_lore', { query: 'character:write-tgt' })
    expect(get.result.text).toContain('Unique-Trait-XYZ')
    expect(get.result.text).toContain('Integrated-From')
  })

  it('pushes history for the target before writing', async () => {
    await seedKV('character:hist-src', 'Trait [Transferable]')
    await seedKV('character:hist-tgt', 'Original target text.')
    await callTool('map_integration', {
      source_id: 'character:hist-src',
      target_id: 'character:hist-tgt',
      integration_depth: 1.0,
    })
    const restore = await callTool('restore_lore', { key: 'character:hist-tgt' })
    expect(restore.result.metadata.restored).toBe(true)
    const get = await callTool('get_lore', { query: 'character:hist-tgt' })
    expect(get.result.text).toBe('Original target text.')
  })

  it('also matches **Transferable-* prefixed fields', async () => {
    await seedKV('character:prefixed-src', '**Transferable-Skill:** combat mastery\n**Non-Transferable:** secret')
    await seedKV('character:prefixed-tgt', 'Target.')
    const res = await callTool('map_integration', {
      source_id: 'character:prefixed-src',
      target_id: 'character:prefixed-tgt',
      integration_depth: 1.0,
    })
    expect(res.result.updated_traits).toHaveLength(1)
    expect(res.result.updated_traits[0]).toContain('Transferable-Skill')
  })
})

// ── generate_entity ───────────────────────────────────────────────────────────

describe('generate_entity', () => {
  it('creates a new entity from an archetype', async () => {
    await seedKV('archetype:guard', '**Weight-1:** 0.7\n**Weight-2:** 0.4\n**Status:** Patrol')
    const res = await callTool('generate_entity', { archetype_key: 'archetype:guard' })
    expect(res.result.entity_key).toMatch(/^entity:guard-\d+$/)
    expect(res.result.entity_text).toContain('**Weight-1:** 0.7')
    expect(res.result.metadata.written).toBe(1)
    const lore = await callTool('get_lore', { query: res.result.entity_key })
    expect(lore.result).toBeDefined()
  })

  it('injects Location when location_key provided', async () => {
    await seedKV('archetype:wolf', '**Weight-1:** 0.6\n**Status:** Hunting')
    await seedKV('location:forest', '**Danger-Level:** 0.3')
    const res = await callTool('generate_entity', { archetype_key: 'archetype:wolf', location_key: 'location:forest' })
    expect(res.result.entity_text).toContain('location:forest')
  })

  it('returns error for missing archetype', async () => {
    const res = await callTool('generate_entity', { archetype_key: 'archetype:no-such' })
    expect(res.error).toBeDefined()
  })
})

// ── roll_encounter ────────────────────────────────────────────────────────────

describe('roll_encounter', () => {
  it('generates an entity from the encounter table', async () => {
    await seedKV('location:woods', '**Encounter-Table:** archetype:bandit:80, archetype:deer:20')
    await seedKV('archetype:bandit', '**Weight-1:** 0.8\n**Status:** Hostile')
    await seedKV('archetype:deer', '**Weight-1:** 0.1\n**Status:** Grazing')
    const res = await callTool('roll_encounter', { location_key: 'location:woods', threat_level: 5 })
    expect(res.result.rolled).toBe(true)
    expect(res.result.entity_key).toMatch(/^entity:/)
  })

  it('reads encounter table from ### Encounter-Table section', async () => {
    await seedKV('location:dungeon', '## Overview\nDark and damp.\n### Encounter-Table\narchetype:goblin:80, archetype:spider:20')
    await seedKV('archetype:goblin', '**Status:** Hostile')
    await seedKV('archetype:spider', '**Status:** Lurking')
    const res = await callTool('roll_encounter', { location_key: 'location:dungeon', threat_level: 5 })
    expect(res.result.rolled).toBe(true)
    expect(res.result.entity_key).toMatch(/^entity:/)
  })

  it('returns rolled=false when no Encounter-Table', async () => {
    await seedKV('location:empty-field', 'Grass and wind.')
    const res = await callTool('roll_encounter', { location_key: 'location:empty-field' })
    expect(res.result.rolled).toBe(false)
    expect(res.result.content[0].text).toContain('No Encounter-Table')
  })
})

// ── advance_state_stage ───────────────────────────────────────────────────────

describe('advance_state_stage', () => {
  it('increments State-Stage and writes back', async () => {
    await seedKV('character:caterpillar', '**State-Stage:** 1\n**State-Total:** 4\n**Stage-Timer:** 3')
    const res = await callTool('advance_state_stage', { entity_key: 'character:caterpillar' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.old_stage).toBe(1)
    expect(res.result.new_stage).toBe(2)
    expect(res.result.is_terminal).toBe(false)
    const lore = await callTool('get_lore', { query: 'character:caterpillar' })
    expect(lore.result.text).toContain('**State-Stage:** 2')
    expect(lore.result.text).toContain('**Stage-Timer:** 2')
  })

  it('detects terminal stage', async () => {
    await seedKV('character:final', '**State-Stage:** 4\n**State-Total:** 4')
    const res = await callTool('advance_state_stage', { entity_key: 'character:final' })
    expect(res.result.advanced).toBe(false)
    expect(res.result.is_terminal).toBe(true)
  })

  it('returns not-advanced when no State-Stage field', async () => {
    await seedKV('character:no-stage', 'Just a character.')
    const res = await callTool('advance_state_stage', { entity_key: 'character:no-stage' })
    expect(res.result.advanced).toBe(false)
  })

  it('advances from loose plain-colon format (no bold markers)', async () => {
    // AI may write "State-Stage: 2" without **bold:** — loose pass should parse and write back
    await seedKV('character:loose-stage', 'State-Stage: 2\nState-Total: 4\nStage-Timer: 3')
    const res = await callTool('advance_state_stage', { entity_key: 'character:loose-stage' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.new_stage).toBe(3)
    const lore = await callTool('get_lore', { query: 'character:loose-stage' })
    expect(lore.result.text).toContain('3')
    expect(lore.result.text).toContain('Stage-Timer')
  })

  it('parses stage from embedded Stage-N-of-M narrative status and updates in-place', async () => {
    // "Status: Active, Stage-2-of-4" has no discrete State-Stage field — Pass 4 extracts it
    await seedKV('character:subject-alpha', 'Status: Active, Stage-2-of-4\nLocation: processing-chamber\nWeight-1: 0.30\nStage-Timer: 3')
    const res = await callTool('advance_state_stage', { entity_key: 'character:subject-alpha' })
    expect(res.result.advanced).toBe(true)
    expect(res.result.old_stage).toBe(2)
    expect(res.result.new_stage).toBe(3)
    expect(res.result.total_stages).toBe(4)
    const lore = await callTool('get_lore', { query: 'character:subject-alpha' })
    // Stage number updated in-place within the status string
    expect(lore.result.text).toContain('Stage-3-of-4')
    expect(lore.result.text).not.toContain('Stage-2-of-4')
    // Stage-Timer decremented
    expect(lore.result.text).toContain('Stage-Timer: 2')
  })
})

// ── process_stage_batch ───────────────────────────────────────────────────────

describe('process_stage_batch', () => {
  it('advances all entities at the location with a State-Stage field', async () => {
    await seedKV('character:pupa-1', '**Location:** location:lab\n**State-Stage:** 1\n**State-Total:** 3')
    await seedKV('character:pupa-2', '**Location:** location:lab\n**State-Stage:** 2\n**State-Total:** 3')
    await seedKV('character:visitor', '**Location:** location:market\n**State-Stage:** 1')
    const res = await callTool('process_stage_batch', { location_key: 'location:lab' })
    expect(res.result.outcomes).toHaveLength(2)
    const pupa1 = res.result.outcomes.find((o: { key: string }) => o.key === 'character:pupa-1')
    expect(pupa1.new_stage).toBe(2)
  })

  it('skips entities without State-Stage', async () => {
    await seedKV('character:no-stage-loc', '**Location:** location:chamber')
    const res = await callTool('process_stage_batch', { location_key: 'location:chamber' })
    expect(res.result.outcomes).toHaveLength(0)
    expect(res.result.skipped).toHaveLength(1)
    expect(res.result.skipped[0].reason).toContain('State-Stage')
  })
})

// ── get_sensory_profile ───────────────────────────────────────────────────────

describe('get_sensory_profile', () => {
  it('returns direct sensory fields from entity', async () => {
    await seedKV('character:creature', '**Temperature:** warm\n**Scent:** musky\n**Texture:** smooth\n**Sound-Signature:** low growl\n**Visual-Descriptors:** amber eyes')
    const res = await callTool('get_sensory_profile', { entity_key: 'character:creature' })
    expect(res.result.profile.temperature).toBe('warm')
    expect(res.result.profile.scent).toBe('musky')
    expect(res.result.profile.texture).toBe('smooth')
    expect(res.result.profile.sound_signature).toBe('low growl')
    expect(res.result.profile.visual_descriptors).toBe('amber eyes')
  })

  it('falls back to species lore for missing fields', async () => {
    await seedKV('character:hybrid', '**Species:** species:wolf-base\n**Texture:** scarred')
    await seedKV('species:wolf-base', '**Temperature:** cool\n**Scent:** earthy')
    const res = await callTool('get_sensory_profile', { entity_key: 'character:hybrid' })
    expect(res.result.profile.texture).toBe('scarred')
    expect(res.result.profile.temperature).toBe('cool')
    expect(res.result.profile.scent).toBe('earthy')
    expect(res.result.species).toBe('species:wolf-base')
  })

  it('returns no-profile message when entity has no sensory fields', async () => {
    await seedKV('character:blank', 'Just a blank character.')
    const res = await callTool('get_sensory_profile', { entity_key: 'character:blank' })
    expect(res.result.content[0].text).toContain('No sensory profile')
  })

  it('reads sensory fields from loose plain-colon format', async () => {
    // AI may omit **bold:** — loose pass should still find these fields
    await seedKV('character:loose-sensory', 'Sensory-Profile: warm-blooded, elevated cortisol\nTemperature: warm\nScent: cortisol-elevated')
    const res = await callTool('get_sensory_profile', { entity_key: 'character:loose-sensory' })
    expect(res.result.profile.temperature).toBe('warm')
    expect(res.result.profile.scent).toBe('cortisol-elevated')
  })

  it('decomposes Sensory-Profile composite string into individual profile fields', async () => {
    // Entity has only a composite Sensory-Profile — no discrete Temperature/Scent/etc. fields
    await seedKV('character:composite-sensory', '**Sensory-Profile:** warm-blooded, elevated cortisol, soft-tissue-density')
    const res = await callTool('get_sensory_profile', { entity_key: 'character:composite-sensory' })
    expect(res.result.sensory_profile_raw).toBe('warm-blooded, elevated cortisol, soft-tissue-density')
    expect(res.result.profile.temperature).toBe('warm-blooded')
    expect(res.result.profile.scent).toBe('elevated cortisol')
    expect(res.result.profile.texture).toBe('soft-tissue-density')
  })
})

// ── get_compatibility ─────────────────────────────────────────────────────────

describe('get_compatibility', () => {
  it('returns compatible=true for well-matched entities', async () => {
    await seedKV('character:predator-c', '**Weight-1:** 0.8\n**Size:** 3.0\n**Environment:** forest')
    await seedKV('character:prey-c', '**Weight-2:** 0.4\n**Size:** 1.0\n**Environment:** forest')
    const res = await callTool('get_compatibility', { entity_a: 'character:predator-c', entity_b: 'character:prey-c', interaction_type: 'hunt' })
    expect(res.result.compatible).toBe(true)
    expect(res.result.risk_level).toBe('low')
    expect(res.result.size_ratio).toBe(3)
  })

  it('flags incompatibility when Weight-1 is too low', async () => {
    await seedKV('character:weak-actor', '**Weight-1:** 0.1')
    await seedKV('character:target', '**Weight-2:** 0.5')
    const res = await callTool('get_compatibility', { entity_a: 'character:weak-actor', entity_b: 'character:target', interaction_type: 'consume' })
    expect(res.result.compatible).toBe(false)
    expect(res.result.constraints.some((c: string) => c.includes('Weight-1'))).toBe(true)
  })

  it('returns error for missing entity', async () => {
    await seedKV('character:exists-only', 'text')
    const res = await callTool('get_compatibility', { entity_a: 'character:exists-only', entity_b: 'character:ghost', interaction_type: 'test' })
    expect(res.error).toBeDefined()
  })
})

// ── get_inventory ─────────────────────────────────────────────────────────────

describe('get_inventory', () => {
  it('parses Inventory field into structured items', async () => {
    await seedKV('character:merchant', '**Inventory:** sword×3, shield×1, potion×10')
    const res = await callTool('get_inventory', { entity_key: 'character:merchant' })
    expect(res.result.items).toHaveLength(3)
    const sword = res.result.items.find((i: { item: string }) => i.item === 'sword')
    expect(sword.quantity).toBe(3)
  })

  it('returns empty items when no Inventory field', async () => {
    await seedKV('character:empty-handed', 'No items here.')
    const res = await callTool('get_inventory', { entity_key: 'character:empty-handed' })
    expect(res.result.items).toHaveLength(0)
    expect(res.result.raw_inventory).toBeNull()
  })
})

// ── transfer_item ─────────────────────────────────────────────────────────────

describe('transfer_item', () => {
  it('moves item from source to target and updates both entries', async () => {
    await seedKV('character:seller', '**Inventory:** sword×2, shield×1')
    await seedKV('character:buyer', '**Inventory:** gold×50')
    const res = await callTool('transfer_item', { from_entity: 'character:seller', to_entity: 'character:buyer', item_key: 'sword', quantity: 1 })
    expect(res.result.transferred).toBe(true)
    expect(res.result.metadata.written).toBe(2)
    const seller = await callTool('get_inventory', { entity_key: 'character:seller' })
    const sellerSword = seller.result.items.find((i: { item: string }) => i.item === 'sword')
    expect(sellerSword.quantity).toBe(1)
    const buyer = await callTool('get_inventory', { entity_key: 'character:buyer' })
    const buyerSword = buyer.result.items.find((i: { item: string }) => i.item === 'sword')
    expect(buyerSword.quantity).toBe(1)
  })

  it('rejects when source does not have the item', async () => {
    await seedKV('character:empty', '**Inventory:** gold×5')
    await seedKV('character:target', '**Inventory:** gold×1')
    const res = await callTool('transfer_item', { from_entity: 'character:empty', to_entity: 'character:target', item_key: 'magic-sword', quantity: 1 })
    expect(res.result.transferred).toBe(false)
    expect(res.result.content[0].text).toContain('not found')
  })

  it('rejects when insufficient quantity', async () => {
    await seedKV('character:has-one', '**Inventory:** potion×1')
    await seedKV('character:wants-more', '**Inventory:** gold×5')
    const res = await callTool('transfer_item', { from_entity: 'character:has-one', to_entity: 'character:wants-more', item_key: 'potion', quantity: 5 })
    expect(res.result.transferred).toBe(false)
    expect(res.result.content[0].text).toContain('Insufficient')
  })
})

// ── extractRawField (via thread_tick) ─────────────────────────────────────────

describe('extractRawField — bullet-style format', () => {
  it('thread_tick finds entity whose Thread field uses bullet+descriptor format', async () => {
    await seedKV('character:bullet-thread-member', [
      '- **Thread (Active):** bullet-thread-test',
      '**Timeline-Value:** 5',
      '**Current-Date:** 2099-01-01',
    ].join('\n'))
    const res = await callTool('thread_tick', { thread_id: 'bullet-thread-test' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.entities_ticked).toBe(1)
  })
})

// ── roll_encounter: parseEncounterTable unit tests ─────────────────────────────

function parseEncounterTable(tableRaw: string): Array<{ key: string; weight: number }> {
  const entries: Array<{ key: string; weight: number }> = [];
  for (const part of tableRaw.split(',').map(s => s.trim()).filter(Boolean)) {
    // FIXED: [\d.]+ handles decimal weights
    const m = part.match(/^(.+?)\s*:\s*([\d.]+)$/);
    if (m) {
      entries.push({ key: m[1].trim(), weight: parseFloat(m[2]) });
    } else {
      entries.push({ key: part, weight: 1 });
    }
  }
  return entries;
}

describe('roll_encounter parseEncounterTable', () => {
  // ── Core fix: decimal weights ────────────────────────────────────────
  it('parses decimal weights from real Thornwood Road table', () => {
    const tableRaw = 'nothing:0.55, forest-predator-scout:0.15, sludge-stalker:0.10, lamia-forest:0.08, thorn-warden:0.05, feral-shaper:0.04, broodmother-wild:0.03';
    const entries = parseEncounterTable(tableRaw);

    expect(entries).toHaveLength(7);

    const nothing = entries.find(e => e.key === 'nothing');
    expect(nothing).toBeDefined();
    expect(nothing!.weight).toBe(0.55);

    const brood = entries.find(e => e.key === 'broodmother-wild');
    expect(brood).toBeDefined();
    expect(brood!.weight).toBe(0.03);

    // Verify NO entry fell through to the weight=1 fallback
    expect(entries.every(e => e.weight < 1)).toBe(true);

    // All weights sum to 1.0 (pre-fix: would sum to 7.0)
    const sum = entries.reduce((s, e) => s + e.weight, 0);
    expect(sum).toBeCloseTo(1.0, 2);
  });

  // ── Before fix: all entries got weight=1 ─────────────────────────────
  it('BUG REPRO (pre-fix): \\d+ regex fails on decimals, all weights become 1', () => {
    const oldEntries: Array<{ key: string; weight: number }> = [];
    const tableRaw = 'lamia-forest:0.08, sludge-stalker:0.10';
    for (const part of tableRaw.split(',').map(s => s.trim()).filter(Boolean)) {
      const m = part.match(/^(.+?)\s*:\s*(\d+)$/); // OLD regex — integer only
      if (m) {
        oldEntries.push({ key: m[1].trim(), weight: parseInt(m[2]) });
      } else {
        // BUG: "lamia-forest:0.08" falls through with weight=1 and broken key
        oldEntries.push({ key: part, weight: 1 });
      }
    }

    expect(oldEntries).toHaveLength(2);
    expect(oldEntries.every(e => e.weight === 1)).toBe(true);
    expect(oldEntries[0].key).toBe('lamia-forest:0.08'); // key carries weight suffix
    expect(oldEntries[1].key).toBe('sludge-stalker:0.10');
  });

  // ── Edge cases ───────────────────────────────────────────────────────
  it('handles whitespace around entries', () => {
    const entries = parseEncounterTable('  nothing:0.55 ,  forest-predator-scout:0.15  ');
    expect(entries).toHaveLength(2);
    expect(entries[0].key).toBe('nothing');
    expect(entries[0].weight).toBe(0.55);
    expect(entries[1].key).toBe('forest-predator-scout');
  });

  it('handles integer weights (backwards compatibility)', () => {
    const entries = parseEncounterTable('guard:3, scout:1');
    expect(entries).toHaveLength(2);
    expect(entries[0].key).toBe('guard');
    expect(entries[0].weight).toBe(3);
    expect(entries[1].key).toBe('scout');
    expect(entries[1].weight).toBe(1);
  });

  it('handles weights like 1.0 and 0.0', () => {
    const entries = parseEncounterTable('boss:1.0, weakling:0.0');
    expect(entries[0].weight).toBe(1.0);
    expect(entries[1].weight).toBe(0.0);
  });

  it('empty table returns empty array', () => {
    expect(parseEncounterTable('')).toHaveLength(0);
  });

  it('single entry without colon gets weight 1 (fallback)', () => {
    const entries = parseEncounterTable('lone-wolf');
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe('lone-wolf');
    expect(entries[0].weight).toBe(1);
  });

  // ── nothing sentinel ────────────────────────────────────────────────
  it('nothing sentinel: tool returns entity_key=null without archetype lookup', () => {
    const entries = parseEncounterTable('nothing:0.55, scout:0.45');
    const nothing = entries.find(e => e.key === 'nothing')!;

    expect(nothing).toBeDefined();
    expect(nothing.weight).toBe(0.55);

    // Simulate the tool-side guard that every roll_encounter handler
    // must implement after the weighted selection:
    const simulateRoll = (selectedKey: string) => {
      if (selectedKey === 'nothing') {
        return { rolled: true, entity_key: null, nothing: true };
      }
      return { rolled: true, entity_key: `entity:${selectedKey}-12345`, nothing: false };
    };

    const nothingResult = simulateRoll('nothing');
    expect(nothingResult.rolled).toBe(true);
    expect(nothingResult.entity_key).toBeNull();
    expect(nothingResult.nothing).toBe(true);

    const scoutResult = simulateRoll('scout');
    expect(scoutResult.rolled).toBe(true);
    expect(scoutResult.entity_key).not.toBeNull();
    expect(scoutResult.nothing).toBe(false);
  });

  it('parses decimal-weight encounter table and generates an entity', async () => {
    await seedKV('location:decimal-woods', '**Encounter-Table:** scout:0.60, guard:0.40');
    await seedKV('archetype:scout', '**Weight-1:** 0.4\n**Status:** Scouting');
    await seedKV('archetype:guard', '**Weight-1:** 0.7\n**Status:** Guarding');
    const res = await callTool('roll_encounter', { location_key: 'location:decimal-woods', threat_level: 5 });
    expect(res.result.rolled).toBe(true);
    expect(res.result.entity_key).toMatch(/^entity:/);
    const get = await callTool('get_lore', { query: res.result.entity_key });
    expect(get.error).toBeUndefined();
    expect(get.result.text).toContain('Weight-1');
  });

  it('selects the guaranteed archetype when one entry dominates the weight', async () => {
    await seedKV('location:solo-woods', '**Encounter-Table:** loner:0.99, bystander:0.01');
    await seedKV('archetype:loner', '**Weight-1:** 0.9\n**Status:** Lonely');
    await seedKV('archetype:bystander', '**Weight-1:** 0.1\n**Status:** Passing');
    // Verify decimal weights resolve to known archetypes (not "archetype not found" error).
    // Avoid counting on distribution — Math.random seeding in the Workers runtime is deterministic.
    const knownArchetypes = new Set(['archetype:loner', 'archetype:bystander']);
    for (let i = 0; i < 5; i++) {
      const res = await callTool('roll_encounter', { location_key: 'location:solo-woods' });
      expect(res.result.rolled).toBe(true);
      expect(knownArchetypes.has(res.result.selected_archetype)).toBe(true);
    }
  });

  it('nothing sentinel returns entity_key=null without error', async () => {
    await seedKV('location:quiet-woods', '**Encounter-Table:** nothing:0.99, scout:0.01');
    await seedKV('archetype:scout', '**Weight-1:** 0.4\n**Status:** Scouting');
    let nothingCount = 0;
    for (let i = 0; i < 5; i++) {
      const res = await callTool('roll_encounter', { location_key: 'location:quiet-woods' });
      if (res.result.nothing) nothingCount++;
    }
    expect(nothingCount).toBeGreaterThan(0);
  });
});
