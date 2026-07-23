// tests/worker/support/setup-d1.ts
// Call setupRpgDb(env.RPG_DB) in a beforeEach block in any test that needs D1.
// Migrations are injected by vitest.global-setup.ts (reads schema/migrations/).
import { applyD1Migrations } from 'cloudflare:test'
import { inject } from 'vitest'
import type { D1Migration } from '@cloudflare/vitest-pool-workers'

export async function setupRpgDb(db: D1Database): Promise<void> {
  const migrations = inject('d1Migrations') as D1Migration[]
  await applyD1Migrations(db, migrations)
}
