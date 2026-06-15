// Test for bulk migration endpoint — executes /admin/migrate-all-characters
import { describe, env, SELF } from './helpers'
import { it, expect, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'

const ADMIN_SECRET = 'test-secret-123'

describe('Admin Bulk Migration', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  it('migrates all characters from KV to D1 via /admin/migrate-all-characters', async () => {

    // Seed KV with multiple test characters
    const testCharacters = [
      {
        key: 'character:alice',
        text: '# Character:Alice\n**Age:** 30\n## Mechanical Scaffolding\n**Weight-1:** 0.5\n**Thread:** thread:alice',
      },
      {
        key: 'character:bob',
        text: '# Character:Bob\n**Age:** 40\n## Mechanical Scaffolding\n**Weight-1:** 0.6',
      },
      {
        key: 'character:carol',
        text: '# Character:Carol\n**Faction:** test-faction\n## Mechanical Scaffolding\n**Weight-1:** 0.7',
      },
    ]

    for (const { key, text } of testCharacters) {
      await env.LORE_DB.put(
        key,
        JSON.stringify({
          text,
          meta: { version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        }),
      )
    }

    // Call the admin endpoint via HTTP
    const response = await SELF.fetch('http://example.com/admin/migrate-all-characters', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': ADMIN_SECRET,
      },
      body: JSON.stringify({ secret: ADMIN_SECRET }),
    })

    const result = (await response.json()) as {
      ok: boolean
      total: number
      migrated: number
      skipped: number
      failed: number
    }

    // Verify migration results
    expect(result.ok).toBe(true)
    expect(result.total).toBe(3)
    expect(result.migrated).toBe(3)
    expect(result.skipped).toBe(0)
    expect(result.failed).toBe(0)

    // Verify all characters were migrated to D1
    for (const char of testCharacters) {
      const kvRaw = await env.LORE_DB.get(char.key)
      expect(kvRaw).toContain('## D1-Migrated: true')
      expect(kvRaw).toContain('## D1-Character-ID:')

      // Extract D1 ID and verify it exists in D1
      const idMatch = kvRaw?.match(/## D1-Character-ID:\s*([a-f0-9-]+)/)
      expect(idMatch?.[1]).toBeDefined()

      const d1Row = await env.RPG_DB
        .prepare('SELECT * FROM characters WHERE id = ?')
        .bind(idMatch?.[1])
        .first()
      expect(d1Row).toBeDefined()
      expect(d1Row?.name).toBeTruthy()
    }
  })
})
