// vitest.global-setup.ts
// Runs in Node.js before any test files. Reads D1 migrations and provides them
// to test workers via inject(), so applyD1Migrations() can seed the schema.
import path from 'path'
import { readD1Migrations } from '@cloudflare/vitest-pool-workers'

export async function setup(project: { provide: (key: string, value: unknown) => void }) {
  const migrationsPath = path.join(__dirname, 'schema', 'migrations')
  const migrations = await readD1Migrations(migrationsPath)
  project.provide('d1Migrations', migrations)
}
