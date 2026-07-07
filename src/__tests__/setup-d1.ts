// src/__tests__/setup-d1.ts
// Call setupRpgDb(env.RPG_DB) in a beforeEach block in any test that needs D1.
// Migrations are injected by vitest.global-setup.ts (reads schema/migrations/).
import { applyD1Migrations } from 'cloudflare:test'
import { inject } from 'vitest'
import type { D1Migration } from '@cloudflare/vitest-pool-workers'

export async function setupRpgDb(db: D1Database): Promise<void> {
  const migrations = inject('d1Migrations') as D1Migration[]
  try {
    await applyD1Migrations(db, migrations)
  } catch (err) {
    const msg = String(err)
    // Migrations 0003 and 0005 use ALTER TABLE ... ADD COLUMN IF NOT EXISTS to be idempotent.
    // This syntax requires SQLite 3.35.0+, but miniflare uses an older version.
    // Retry by applying migrations one at a time, skipping ones that fail due to:
    // - "duplicate column" (column already exists in canonical schema)
    // - "syntax error" with "EXISTS" (old SQLite rejecting IF NOT EXISTS syntax)
    if ((msg.includes('duplicate column') || (msg.includes('syntax error') && msg.includes('EXISTS'))) && migrations.length > 1) {
      for (const migration of migrations) {
        try {
          await applyD1Migrations(db, [migration])
        } catch (e) {
          const migErr = String(e)
          if (!(migErr.includes('duplicate column') || (migErr.includes('syntax error') && migErr.includes('EXISTS')))) {
            throw e
          }
        }
      }
      return
    }
    throw err
  }
}
