import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { AppBindings } from '../../src/types'
import {
  kvPut,
  kvDelete,
  kvGet,
  kvList,
  kvListMaps,
  getKV,
  loreDB,
  clearRequestCache,
} from '../../src/lib/kv'
import { parseKvEntry } from '../../src/lib/lore'
import { env as testEnv } from 'cloudflare:test'

describe('KV fallback (loreDB)', () => {
  beforeEach(() => {
    // Clear loreDB before each test
    Object.keys(loreDB).forEach((key) => {
      delete loreDB[key]
    })
  })

  it('kvPut writes to loreDB with full JSON payload when KV unavailable', async () => {
    // Create a context with no KV binding
    const c = { env: {} as AppBindings }

    const key = 'test:fallback'
    const payload = JSON.stringify({
      text: 'Test content',
      meta: { version: 1, updatedAt: '2024-01-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z' },
    })

    // Call kvPut (no KV available, should write to fallback)
    const result = await kvPut(c, key, payload)

    // Should return false since KV is unavailable
    expect(result).toBe(false)

    // loreDB should have the full JSON payload
    expect(loreDB[key]).toBe(payload)

    // Verify parseKvEntry can read it back with metadata intact
    const parsed = parseKvEntry(loreDB[key]!)
    expect(parsed.text).toBe('Test content')
    expect(parsed.meta.version).toBe(1)
    expect(parsed.meta.updatedAt).toBe('2024-01-01T00:00:00Z')
  })

  it('kvDelete removes from loreDB when KV unavailable', async () => {
    const c = { env: {} as AppBindings }
    const key = 'test:delete'

    // Pre-populate loreDB
    const payload = JSON.stringify({
      text: 'To be deleted',
      meta: { version: 1, updatedAt: '2024-01-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z' },
    })
    loreDB[key] = payload

    // Verify it's there
    expect(loreDB[key]).toBeDefined()

    // Call kvDelete (no KV available, should delete from fallback)
    const result = await kvDelete(c, key)

    // Should return false since KV is unavailable
    expect(result).toBe(false)

    // loreDB should no longer have the key
    expect(loreDB[key]).toBeUndefined()
  })

  it('kvGet reads from loreDB as fallback with full payload', async () => {
    const c = { env: {} as AppBindings }
    const key = 'test:get'

    // Pre-populate loreDB with full JSON payload
    const payload = JSON.stringify({
      text: 'Fallback read',
      meta: { version: 2, updatedAt: '2024-01-02T00:00:00Z', createdAt: '2024-01-01T00:00:00Z' },
    })
    loreDB[key] = payload

    // Call kvGet (no KV available, should read from fallback)
    const result = await kvGet(c, key)

    // Should return the full payload
    expect(result).toBe(payload)

    // Verify parseKvEntry works on the result
    const parsed = parseKvEntry(result!)
    expect(parsed.text).toBe('Fallback read')
    expect(parsed.meta.version).toBe(2)
  })

  it('kvGet returns null when key not found in fallback', async () => {
    const c = { env: {} as AppBindings }

    // Call kvGet on non-existent key
    const result = await kvGet(c, 'nonexistent:key')

    expect(result).toBeNull()
  })
})

describe('KV with available binding', () => {
  beforeEach(async () => {
    // Clear loreDB before each test
    Object.keys(loreDB).forEach((key) => {
      delete loreDB[key]
    })
    // Reset KV
    const binding = testEnv.LORE_DB
    if (binding) {
      const keys = await binding.list()
      for (const key of keys.keys) {
        await binding.delete(key.name)
      }
    }
  })

  afterEach(async () => {
    const { reset } = await import('cloudflare:test')
    await reset()
  })

  it('getKV returns the KV binding when available', async () => {
    const c = { env: testEnv as AppBindings }

    const kv = getKV(c)

    expect(kv).toBeDefined()
    expect(kv).not.toBeNull()
  })

  it('getKV returns null when binding is not available', () => {
    const c = { env: {} as AppBindings }

    const kv = getKV(c)

    expect(kv).toBeNull()
  })

  it('kvGet reads from KV when available', async () => {
    const c = { env: testEnv as AppBindings }
    const key = 'test:kv-read'
    const payload = JSON.stringify({
      text: 'From KV',
      meta: { version: 1, updatedAt: '2024-01-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z' },
    })

    // Pre-populate KV
    await testEnv.LORE_DB.put(key, payload)

    // Read from KV
    const result = await kvGet(c, key)

    expect(result).toBe(payload)
  })

  it('kvGet prefers KV over loreDB fallback', async () => {
    const c = { env: testEnv as AppBindings }
    const key = 'test:kv-preference'
    const kvPayload = JSON.stringify({
      text: 'From KV',
      meta: { version: 1, updatedAt: '2024-01-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z' },
    })
    const fallbackPayload = JSON.stringify({
      text: 'From fallback',
      meta: { version: 0, updatedAt: '2024-01-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z' },
    })

    // Pre-populate both KV and loreDB
    await testEnv.LORE_DB.put(key, kvPayload)
    loreDB[key] = fallbackPayload

    // Should read from KV
    const result = await kvGet(c, key)

    expect(result).toBe(kvPayload)
  })

  it('kvGet falls back to loreDB when KV returns null', async () => {
    const c = { env: testEnv as AppBindings }
    const key = 'test:kv-fallback'
    const fallbackPayload = JSON.stringify({
      text: 'From fallback',
      meta: { version: 0, updatedAt: '2024-01-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z' },
    })

    // Pre-populate only loreDB (not KV)
    loreDB[key] = fallbackPayload

    // Should fall back to loreDB
    const result = await kvGet(c, key)

    expect(result).toBe(fallbackPayload)
  })

  it('kvGet returns null when key not in KV or loreDB', async () => {
    const c = { env: testEnv as AppBindings }

    const result = await kvGet(c, 'nonexistent:key')

    expect(result).toBeNull()
  })

  it('kvPut writes to KV and returns true', async () => {
    const c = { env: testEnv as AppBindings }
    const key = 'test:kv-put'
    const payload = JSON.stringify({
      text: 'Test content',
      meta: { version: 1, updatedAt: '2024-01-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z' },
    })

    const result = await kvPut(c, key, payload)

    expect(result).toBe(true)

    // Verify it was written to KV
    const stored = await testEnv.LORE_DB.get(key)
    expect(stored).toBe(payload)

    // Verify it was also written to loreDB fallback
    expect(loreDB[key]).toBe(payload)
  })

  it('kvDelete removes from KV and returns true', async () => {
    const c = { env: testEnv as AppBindings }
    const key = 'test:kv-delete'
    const payload = JSON.stringify({
      text: 'To be deleted',
      meta: { version: 1, updatedAt: '2024-01-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z' },
    })

    // Pre-populate KV
    await testEnv.LORE_DB.put(key, payload)
    loreDB[key] = payload

    const result = await kvDelete(c, key)

    expect(result).toBe(true)

    // Verify it was deleted from KV
    const stored = await testEnv.LORE_DB.get(key)
    expect(stored).toBeNull()

    // Verify it was deleted from loreDB
    expect(loreDB[key]).toBeUndefined()
  })

  it('kvList filters out system keys and returns user keys', async () => {
    const c = { env: testEnv as AppBindings }

    // Pre-populate with both user and system keys
    await testEnv.LORE_DB.put('character:alice', JSON.stringify({ text: 'Alice' }))
    await testEnv.LORE_DB.put('location:town', JSON.stringify({ text: 'Town' }))
    await testEnv.LORE_DB.put('_history:something', JSON.stringify({ text: 'History' }))
    await testEnv.LORE_DB.put('_idx:prefix:character', JSON.stringify(['character:alice']))
    await testEnv.LORE_DB.put('_changelog', JSON.stringify({ text: 'Changelog' }))
    await testEnv.LORE_DB.put('events:something', JSON.stringify({ text: 'Event' }))
    await testEnv.LORE_DB.put('_snapshot:state', JSON.stringify({ text: 'Snapshot' }))
    await testEnv.LORE_DB.put('_tags:something', JSON.stringify({ text: 'Tags' }))
    await testEnv.LORE_DB.put('map:world', JSON.stringify({ text: 'Map' }))
    await testEnv.LORE_DB.put('_csp_report:123', JSON.stringify({ text: 'CSP' }))

    const result = await kvList(c)

    // Should only include user keys
    expect(result).toContain('character:alice')
    expect(result).toContain('location:town')
    expect(result).not.toContain('_history:something')
    expect(result).not.toContain('_idx:prefix:character')
    expect(result).not.toContain('_changelog')
    expect(result).not.toContain('events:something')
    expect(result).not.toContain('_snapshot:state')
    expect(result).not.toContain('_tags:something')
    expect(result).not.toContain('map:world')
    expect(result).not.toContain('_csp_report:123')
  })

  it('kvList caches results', async () => {
    const c = { env: testEnv as AppBindings }

    // Pre-populate KV
    await testEnv.LORE_DB.put('character:alice', JSON.stringify({ text: 'Alice' }))

    // First call
    const result1 = await kvList(c)
    expect(result1).toContain('character:alice')

    // Add another key to KV
    await testEnv.LORE_DB.put('character:bob', JSON.stringify({ text: 'Bob' }))

    // Second call should return cached result (not the newly added key)
    const result2 = await kvList(c)
    expect(result2).toEqual(result1)

    // Clear cache
    clearRequestCache(c)

    // Third call should see the new key
    const result3 = await kvList(c)
    expect(result3).toContain('character:bob')
  })

  it('kvListMaps lists only map keys', async () => {
    const c = { env: testEnv as AppBindings }

    // Pre-populate with both map and non-map keys
    await testEnv.LORE_DB.put('map:world', JSON.stringify({ text: 'World' }))
    await testEnv.LORE_DB.put('map:dungeon', JSON.stringify({ text: 'Dungeon' }))
    await testEnv.LORE_DB.put('character:alice', JSON.stringify({ text: 'Alice' }))
    await testEnv.LORE_DB.put('_idx:prefix:character', JSON.stringify(['character:alice']))

    const result = await kvListMaps(c)

    // Should only include map keys
    expect(result).toContain('map:world')
    expect(result).toContain('map:dungeon')
    expect(result).not.toContain('character:alice')
    expect(result).not.toContain('_idx:prefix:character')
  })

  it('kvListMaps caches results', async () => {
    const c = { env: testEnv as AppBindings }

    // Pre-populate KV
    await testEnv.LORE_DB.put('map:world', JSON.stringify({ text: 'World' }))

    // First call
    const result1 = await kvListMaps(c)
    expect(result1).toContain('map:world')

    // Add another map key to KV
    await testEnv.LORE_DB.put('map:dungeon', JSON.stringify({ text: 'Dungeon' }))

    // Second call should return cached result (not the newly added key)
    const result2 = await kvListMaps(c)
    expect(result2).toEqual(result1)

    // Clear cache
    clearRequestCache(c)

    // Third call should see the new key
    const result3 = await kvListMaps(c)
    expect(result3).toContain('map:dungeon')
  })

  it('kvList with fallback when KV unavailable', async () => {
    const c = { env: {} as AppBindings }

    // Pre-populate loreDB with both user and system keys
    loreDB['character:alice'] = JSON.stringify({ text: 'Alice' })
    loreDB['_history:something'] = JSON.stringify({ text: 'History' })
    loreDB['_changelog'] = JSON.stringify({ text: 'Changelog' })

    const result = await kvList(c)

    // Should only include user keys
    expect(result).toContain('character:alice')
    expect(result).not.toContain('_history:something')
    expect(result).not.toContain('_changelog')
  })

  it('kvListMaps with fallback when KV unavailable', async () => {
    const c = { env: {} as AppBindings }

    // Pre-populate loreDB
    loreDB['map:world'] = JSON.stringify({ text: 'World' })
    loreDB['character:alice'] = JSON.stringify({ text: 'Alice' })

    const result = await kvListMaps(c)

    // Should only include map keys
    expect(result).toContain('map:world')
    expect(result).not.toContain('character:alice')
  })
})

describe('KV error handling', () => {
  beforeEach(async () => {
    Object.keys(loreDB).forEach((key) => {
      delete loreDB[key]
    })
    const binding = testEnv.LORE_DB
    if (binding) {
      const keys = await binding.list()
      for (const key of keys.keys) {
        await binding.delete(key.name)
      }
    }
  })

  afterEach(async () => {
    const { reset } = await import('cloudflare:test')
    await reset()
  })

  it('kvGet returns fallback when KV.get throws', async () => {
    const c = {
      env: {
        LORE_DB: {
          get: async () => {
            throw new Error('KV error')
          },
        },
      } as unknown as AppBindings,
    }
    const fallbackPayload = JSON.stringify({
      text: 'From fallback',
      meta: { version: 0, updatedAt: '2024-01-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z' },
    })

    loreDB['test:key'] = fallbackPayload

    const result = await kvGet(c, 'test:key')

    // Should return fallback value when KV throws
    expect(result).toBe(fallbackPayload)
  })

  it('kvPut returns false when KV.put throws', async () => {
    const c = {
      env: {
        LORE_DB: {
          put: async () => {
            throw new Error('KV error')
          },
        },
      } as unknown as AppBindings,
    }
    const payload = JSON.stringify({
      text: 'Test',
      meta: { version: 1, updatedAt: '2024-01-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z' },
    })

    const result = await kvPut(c, 'test:key', payload)

    expect(result).toBe(false)

    // Should still be in loreDB fallback
    expect(loreDB['test:key']).toBe(payload)
  })

  it('kvDelete returns false when KV.delete throws', async () => {
    const c = {
      env: {
        LORE_DB: {
          delete: async () => {
            throw new Error('KV error')
          },
        },
      } as unknown as AppBindings,
    }

    loreDB['test:key'] = JSON.stringify({ text: 'Test' })

    const result = await kvDelete(c, 'test:key')

    expect(result).toBe(false)

    // Should still be deleted from loreDB
    expect(loreDB['test:key']).toBeUndefined()
  })

  it('kvList returns fallback when KV.list throws', async () => {
    const c = {
      env: {
        LORE_DB: {
          list: async () => {
            throw new Error('KV error')
          },
        },
      } as unknown as AppBindings,
    }

    loreDB['character:alice'] = JSON.stringify({ text: 'Alice' })
    loreDB['_history:something'] = JSON.stringify({ text: 'History' })

    const result = await kvList(c)

    // Should return fallback list (filtered)
    expect(result).toContain('character:alice')
    expect(result).not.toContain('_history:something')
  })

  it('kvListMaps returns fallback when KV.list throws', async () => {
    const c = {
      env: {
        LORE_DB: {
          list: async () => {
            throw new Error('KV error')
          },
        },
      } as unknown as AppBindings,
    }

    loreDB['map:world'] = JSON.stringify({ text: 'World' })
    loreDB['character:alice'] = JSON.stringify({ text: 'Alice' })

    const result = await kvListMaps(c)

    // Should return fallback list (map-only)
    expect(result).toContain('map:world')
    expect(result).not.toContain('character:alice')
  })

  it('kvList follows the cursor across multiple pages', async () => {
    const calls: Array<{ cursor?: string } | undefined> = []
    const c = {
      env: {
        LORE_DB: {
          list: async (opts?: { cursor?: string }) => {
            calls.push(opts)
            if (!opts?.cursor) {
              return { keys: [{ name: 'character:page1' }], list_complete: false, cursor: 'page2' }
            }
            return { keys: [{ name: 'character:page2' }], list_complete: true }
          },
        },
      } as unknown as AppBindings,
    }

    const result = await kvList(c)

    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual({ cursor: 'page2' })
    expect(result).toContain('character:page1')
    expect(result).toContain('character:page2')
  })

  it('kvListMaps follows the cursor across multiple pages', async () => {
    const calls: Array<{ cursor?: string } | undefined> = []
    const c = {
      env: {
        LORE_DB: {
          list: async (opts?: { cursor?: string }) => {
            calls.push(opts)
            if (!opts?.cursor) {
              return { keys: [{ name: 'map:page1' }], list_complete: false, cursor: 'page2' }
            }
            return { keys: [{ name: 'map:page2' }], list_complete: true }
          },
        },
      } as unknown as AppBindings,
    }

    const result = await kvListMaps(c)

    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual({ cursor: 'page2' })
    expect(result).toContain('map:page1')
    expect(result).toContain('map:page2')
  })
})
