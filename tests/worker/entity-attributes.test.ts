// #410 — D1-backed entity interaction attributes: get_attributes/set_attributes
// CRUD, plus resolve_interaction/analyze_utility/get_compatibility reading D1
// as the primary source of truth and falling back to KV markdown parsing.
import { describe, callTool, seedKV } from './support/helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'

async function seedCharacter(name: string): Promise<string> {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await env.RPG_DB.prepare(
    'INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, name, '{}', 10, 10, 10, 1, now, now).run()
  return id
}

describe('entity_manage get_attributes / set_attributes', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  it('get_attributes: returns error when entity not found', async () => {
    const res = await callTool('entity_manage', { action: 'get_attributes', entity_key: 'nonexistent:entity' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('get_attributes: returns source none and empty attributes when no D1 row exists', async () => {
    await seedKV('character:no-attrs', 'Plain lore text.')
    const res = await callTool('entity_manage', { action: 'get_attributes', entity_key: 'character:no-attrs' })
    expect(res.result.source).toBe('none')
    expect(res.result.attributes).toEqual({})
    expect(res.result.character_id).toBeNull()
  })

  it('set_attributes: returns error when entity not found', async () => {
    const res = await callTool('entity_manage', { action: 'set_attributes', entity_key: 'nonexistent:entity', attributes: { 'weight-1': 0.5 } })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('set_attributes: creates a new row and get_attributes reads it back', async () => {
    await seedKV('character:fresh-attrs', 'Plain lore text.')
    const setRes = await callTool('entity_manage', {
      action: 'set_attributes', entity_key: 'character:fresh-attrs', attributes: { 'weight-1': 0.3, 'tenderness-index': 0.7 },
    })
    expect(setRes.error).toBeUndefined()
    expect(setRes.result.attributes).toEqual({ 'weight-1': 0.3, 'tenderness-index': 0.7 })
    expect(setRes.result.merged).toBe(false)
    expect(setRes.result.character_id).toBeNull()

    const getRes = await callTool('entity_manage', { action: 'get_attributes', entity_key: 'character:fresh-attrs' })
    expect(getRes.result.source).toBe('d1')
    expect(getRes.result.attributes).toEqual({ 'weight-1': 0.3, 'tenderness-index': 0.7 })
  })

  it('set_attributes: resolves and stores character_id via name match', async () => {
    await seedCharacter('Linked Attrs Subject')
    await seedKV('character:linked-attrs-subject', 'Plain lore text.')
    const res = await callTool('entity_manage', {
      action: 'set_attributes', entity_key: 'character:linked-attrs-subject', attributes: { 'weight-2': 0.15 },
    })
    expect(res.result.character_id).not.toBeNull()
  })

  it('set_attributes: merge:true (default) folds new attributes into existing row', async () => {
    await seedKV('character:merge-attrs', 'Plain lore text.')
    await callTool('entity_manage', { action: 'set_attributes', entity_key: 'character:merge-attrs', attributes: { 'weight-1': 0.2, 'weight-2': 0.4 } })
    const res = await callTool('entity_manage', { action: 'set_attributes', entity_key: 'character:merge-attrs', attributes: { 'weight-2': 0.9, 'cortisol-level': 0.1 } })
    expect(res.result.merged).toBe(true)
    expect(res.result.attributes).toEqual({ 'weight-1': 0.2, 'weight-2': 0.9, 'cortisol-level': 0.1 })
  })

  it('set_attributes: merge:false replaces the stored attribute set wholesale', async () => {
    await seedKV('character:replace-attrs', 'Plain lore text.')
    await callTool('entity_manage', { action: 'set_attributes', entity_key: 'character:replace-attrs', attributes: { 'weight-1': 0.2, 'weight-2': 0.4 } })
    const res = await callTool('entity_manage', { action: 'set_attributes', entity_key: 'character:replace-attrs', attributes: { 'weight-2': 0.9 }, merge: false })
    expect(res.result.attributes).toEqual({ 'weight-2': 0.9 })
  })

  it('set_attributes: falls through to overwrite when existing stored JSON is corrupt', async () => {
    await seedKV('character:corrupt-attrs', 'Plain lore text.')
    const now = new Date().toISOString()
    await env.RPG_DB.prepare('INSERT INTO entity_attributes (id, lore_key, character_id, attributes, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)')
      .bind(crypto.randomUUID(), 'character:corrupt-attrs', 'not valid json{{', now, now).run()
    const res = await callTool('entity_manage', { action: 'set_attributes', entity_key: 'character:corrupt-attrs', attributes: { 'weight-1': 0.5 }, merge: true })
    expect(res.result.attributes).toEqual({ 'weight-1': 0.5 })
  })

  it('set_attributes: rejects an empty attributes object', async () => {
    await seedKV('character:empty-attrs', 'Plain lore text.')
    const res = await callTool('entity_manage', { action: 'set_attributes', entity_key: 'character:empty-attrs', attributes: {} })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('get_attributes: returns source none when the stored attributes JSON is not an object', async () => {
    await seedKV('character:non-object-attrs', 'Plain lore text.')
    const now = new Date().toISOString()
    await env.RPG_DB.prepare('INSERT INTO entity_attributes (id, lore_key, character_id, attributes, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)')
      .bind(crypto.randomUUID(), 'character:non-object-attrs', '[1,2,3]', now, now).run()
    const res = await callTool('entity_manage', { action: 'get_attributes', entity_key: 'character:non-object-attrs' })
    expect(res.result.source).toBe('none')
    expect(res.result.attributes).toEqual({})
  })
})

describe('resolve_interaction — D1 attribute priority (#410)', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  it('uses D1 weight-1/weight-2 over conflicting KV markdown values', async () => {
    await seedKV('character:d1-attacker', '**Weight-1:** 0.1\n**State-Level:** 0')
    await seedKV('character:d1-defender', '**Weight-2:** 0.9')
    await callTool('entity_manage', { action: 'set_attributes', entity_key: 'character:d1-attacker', attributes: { 'weight-1': 1.0 } })
    await callTool('entity_manage', { action: 'set_attributes', entity_key: 'character:d1-defender', attributes: { 'weight-2': 0.0 } })

    const res = await callTool('entity_manage', {
      action: 'resolve_interaction', entity_a_id: 'character:d1-attacker', entity_b_id: 'character:d1-defender', action_type: 'consume',
    })
    expect(res.result.metadata.weight_1).toBe(1.0)
    expect(res.result.metadata.weight_2).toBe(0.0)
    expect(res.result.metadata.weight_1_source).toBe('d1')
    expect(res.result.metadata.weight_2_source).toBe('d1')
    expect(res.result.metadata.probability).toBeCloseTo(0.7, 5)
  })

  it('falls back to kv source when no D1 attributes exist', async () => {
    await seedKV('character:kv-only-a', '**Weight-1:** 0.5')
    await seedKV('character:kv-only-b', '**Weight-2:** 0.5')
    const res = await callTool('entity_manage', {
      action: 'resolve_interaction', entity_a_id: 'character:kv-only-a', entity_b_id: 'character:kv-only-b', action_type: 'test',
    })
    expect(res.result.metadata.weight_1_source).toBe('kv')
    expect(res.result.metadata.weight_2_source).toBe('kv')
  })
})

describe('analyze_utility — D1 attribute priority (#410)', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  it('D1 attributes override matching KV fields and mark breakdown source', async () => {
    await seedKV('character:d1-utility', [
      '**Tenderness-Index:** 0.10',
      '**Fat-Marbling-Index:** 0.80',
    ].join('\n'))
    await callTool('entity_manage', { action: 'set_attributes', entity_key: 'character:d1-utility', attributes: { 'tenderness-index': 0.95 } })

    const res = await callTool('entity_manage', { action: 'analyze_utility', entity_id: 'character:d1-utility', utility_vector: 'GASTRIC' })
    expect(res.result.d1_attributes_used).toBe(true)
    const tenderness = res.result.breakdown.find((b: any) => b.field === 'Tenderness-Index')
    expect(tenderness.raw_value).toBe(0.95)
    expect(tenderness.source).toBe('d1')
    const marbling = res.result.breakdown.find((b: any) => b.field === 'Fat-Marbling-Index')
    expect(marbling.source).toBe('kv')
  })

  it('D1 attributes can add a field absent from KV markdown', async () => {
    await seedKV('character:d1-only-field', 'No numeric fields here.')
    await callTool('entity_manage', { action: 'set_attributes', entity_key: 'character:d1-only-field', attributes: { 'compliance-potential': 0.6 } })
    const res = await callTool('entity_manage', { action: 'analyze_utility', entity_id: 'character:d1-only-field', utility_vector: 'GASTRIC' })
    const compliance = res.result.breakdown.find((b: any) => b.field === 'Compliance-Potential')
    expect(compliance).toBeDefined()
    expect(compliance.source).toBe('d1')
  })

  it('d1_attributes_used is false when no D1 attributes exist', async () => {
    await seedKV('character:kv-only-utility', '**Tenderness-Index:** 0.5')
    const res = await callTool('entity_manage', { action: 'analyze_utility', entity_id: 'character:kv-only-utility', utility_vector: 'GASTRIC' })
    expect(res.result.d1_attributes_used).toBe(false)
  })

  it('d1_attributes_used is false on the grade-F empty-breakdown path', async () => {
    await seedKV('character:blank-utility', 'No numeric fields here. Status: active.')
    const res = await callTool('entity_manage', { action: 'analyze_utility', entity_id: 'character:blank-utility', utility_vector: 'GASTRIC' })
    expect(res.result.grade).toBe('F')
    expect(res.result.d1_attributes_used).toBe(false)
  })
})

describe('get_compatibility — D1 attribute priority (#410)', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  it('uses D1 weight-1/weight-2 over KV and reports source', async () => {
    await seedKV('character:compat-a', '**Weight-1:** 0.9')
    await seedKV('character:compat-b', '**Weight-2:** 0.1')
    await callTool('entity_manage', { action: 'set_attributes', entity_key: 'character:compat-a', attributes: { 'weight-1': 0.05 } })
    await callTool('entity_manage', { action: 'set_attributes', entity_key: 'character:compat-b', attributes: { 'weight-2': 0.95 } })

    const res = await callTool('entity_manage', { action: 'get_compatibility', entity_a: 'character:compat-a', entity_b: 'character:compat-b', interaction_type: 'hunt' })
    expect(res.result.weight_1_source).toBe('d1')
    expect(res.result.weight_2_source).toBe('d1')
    expect(res.result.compatible).toBe(false)
  })

  it('falls back to kv source when no D1 attributes exist', async () => {
    await seedKV('character:compat-kv-a', '**Weight-1:** 0.5')
    await seedKV('character:compat-kv-b', '**Weight-2:** 0.5')
    const res = await callTool('entity_manage', { action: 'get_compatibility', entity_a: 'character:compat-kv-a', entity_b: 'character:compat-kv-b', interaction_type: 'hunt' })
    expect(res.result.weight_1_source).toBe('kv')
    expect(res.result.weight_2_source).toBe('kv')
  })
})
