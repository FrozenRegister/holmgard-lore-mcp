import { describe, callTool, seedKV } from './support/helpers'
import { env } from 'cloudflare:test'
import { expect, it } from 'vitest'
import { loreDB } from '@/lib/kv'

describe('entity_manage.destroy', () => {
  it('destroys an existing entity and removes it from KV', async () => {
    await seedKV('entity:encounter-12345', '**Location:** location:dark-wood\n**Type:** goblin\n**Weight-1:** 0.4')
    const res = await callTool('entity_manage', { action: 'destroy', entity_key: 'entity:encounter-12345' })
    expect(res.result.metadata.destroyed).toBe(true)
    expect(res.result.metadata.entity_key).toBe('entity:encounter-12345')
    expect(res.result.content[0].text).toContain('destroyed')

    // Verify entity is gone from KV
    const after = await env.LORE_DB.get('entity:encounter-12345')
    expect(after).toBeNull()
  })

  it('archives history snapshot before deletion', async () => {
    await seedKV('entity:encounter-99999', '**Type:** skeleton\n**Weight-1:** 0.6')
    await callTool('entity_manage', { action: 'destroy', entity_key: 'entity:encounter-99999' })

    // History should have been archived under _history:entity:encounter-99999
    const historyRaw = await env.LORE_DB.get('_history:entity:encounter-99999')
    expect(historyRaw).not.toBeNull()
    const history = JSON.parse(historyRaw!)
    expect(Array.isArray(history)).toBe(true)
    expect(history.length).toBeGreaterThanOrEqual(1)
    expect(history[0]).toContain('skeleton')
  })

  it('removes entity from loreDB in-memory cache', async () => {
    loreDB['entity:encounter-cache-test'] = '**Type:** test'
    await seedKV('entity:encounter-cache-test', '**Type:** test')
    await callTool('entity_manage', { action: 'destroy', entity_key: 'entity:encounter-cache-test' })
    expect(loreDB['entity:encounter-cache-test']).toBeUndefined()
  })

  it('appends changelog entry with op=destroy', async () => {
    await seedKV('entity:encounter-cl-77', '**Type:** wolf')
    await callTool('entity_manage', { action: 'destroy', entity_key: 'entity:encounter-cl-77' })

    // Read changelog from KV
    const changelogRaw = await env.LORE_DB.get('_changelog')
    expect(changelogRaw).not.toBeNull()
    const entries = JSON.parse(changelogRaw!)
    const destroyEntry = entries.find((e: { key: string; op: string }) => e.key === 'entity:encounter-cl-77')
    expect(destroyEntry).toBeDefined()
    expect(destroyEntry.op).toBe('destroy')
    expect(destroyEntry.version).toBe(0)
  })

  it('cleans up location index when entity has a Location field', async () => {
    await seedKV('entity:enc-loc-cleanup', '**Location:** location:ruins\n**Type:** undead')
    // Pre-populate the location index
    await env.LORE_DB.put('_idx:location:location:ruins', JSON.stringify(['entity:enc-loc-cleanup']))

    await callTool('entity_manage', { action: 'destroy', entity_key: 'entity:enc-loc-cleanup' })

    // Index should no longer contain the destroyed entity
    const indexRaw = await env.LORE_DB.get('_idx:location:location:ruins')
    if (indexRaw) {
      const keys = JSON.parse(indexRaw)
      expect(keys).not.toContain('entity:enc-loc-cleanup')
    }
  })

  it('normalizes entity_key to lowercase', async () => {
    // Seed with lowercased key — handler lowercases before lookup
    await seedKV('entity:enc-upper-123', '**Type:** test')
    // Pass uppercase — handler should lowercase it and find the entity
    const res = await callTool('entity_manage', { action: 'destroy', entity_key: 'ENTITY:ENC-UPPER-123' })
    expect(res.result.metadata.destroyed).toBe(true)
    expect(res.result.metadata.entity_key).toBe('entity:enc-upper-123')
  })

  it('trims whitespace from entity_key', async () => {
    await seedKV('entity:enc-trimmed', '**Type:** test')
    const res = await callTool('entity_manage', { action: 'destroy', entity_key: '  entity:enc-trimmed  ' })
    expect(res.result.metadata.destroyed).toBe(true)
    expect(res.result.metadata.entity_key).toBe('entity:enc-trimmed')
  })

  it('returns error when entity does not exist', async () => {
    const res = await callTool('entity_manage', { action: 'destroy', entity_key: 'entity:nonexistent-ghost' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.message).toContain('not found')
  })

  it('returns error when entity_key is missing', async () => {
    const res = await callTool('entity_manage', { action: 'destroy' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('returns error when entity_key is empty string', async () => {
    const res = await callTool('entity_manage', { action: 'destroy', entity_key: '' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})