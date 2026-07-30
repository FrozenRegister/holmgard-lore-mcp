import { describe, it, expect, beforeEach } from 'vitest'
import type { AppBindings } from '../../src/types'
import { kvPut, kvDelete, kvGet, loreDB } from '../../src/lib/kv'
import { parseKvEntry } from '../../src/lib/lore'

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
