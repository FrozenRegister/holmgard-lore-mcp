#!/usr/bin/env node
// Idempotent local D1 bootstrap for `holmgard-rpg`.
//
// schema/rpg-schema.sql is a consolidated snapshot that already bakes in the
// effect of some (not all) files under schema/migrations/ — e.g. biomes.base_threat
// lives in the base schema AND in migrations/0012_encounter_resolution.sql as an
// ALTER TABLE. On a truly fresh local D1, `wrangler d1 migrations apply` aborts
// the whole run on the first such duplicate-column/duplicate-table error (each
// migration file runs in its own transaction). Rather than hand-maintain which
// migration numbers are already covered, this detects that specific class of
// "already exists" error, marks just that one migration applied in d1_migrations
// (its effect demonstrably already exists), and retries — so unrelated real
// failures still abort loudly.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

const DB = 'holmgard-rpg'
const MAX_ATTEMPTS = 30 // generous upper bound on migration file count

// spawnSync's `shell: true` only concatenates args with spaces on Windows —
// it does not quote them — so any arg containing a space (e.g. a --command
// SQL string) must be quoted ourselves or it gets split into extra argv items.
function quoteArg(arg) {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg
}

function run(args) {
  const result = spawnSync(['wrangler', ...args].map(quoteArg).join(' '), {
    encoding: 'utf8',
    shell: true,
  })
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.status !== 0) {
    process.stdout.write(text)
    throw new Error(`wrangler ${args.join(' ')} failed (exit ${result.status})`)
  }
  return text
}

function runShowingOutput(args) {
  const out = run(args)
  process.stdout.write(out)
  return out
}

function applyMigrations() {
  const result = spawnSync(['wrangler', 'd1', 'migrations', 'apply', DB, '--local'].join(' '), {
    encoding: 'utf8',
    shell: true,
  })
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`
  process.stdout.write(text)
  return { ok: result.status === 0, text }
}

function appliedMigrationNames() {
  const out = run(['d1', 'execute', DB, '--local', '--json', '--command', 'SELECT name FROM d1_migrations'])
  const parsed = JSON.parse(out)
  return new Set(parsed[0].results.map((r) => r.name))
}

function markMigrationApplied(name) {
  run(['d1', 'execute', DB, '--local', '--command', `INSERT INTO d1_migrations (name) VALUES ('${name}')`])
}

function main() {
  console.log('[1/2] Applying consolidated base schema (schema/rpg-schema.sql)...')
  runShowingOutput(['d1', 'execute', DB, '--local', '--file', 'schema/rpg-schema.sql'])

  console.log('\n[2/2] Applying migrations (schema/migrations/*.sql)...')
  const allMigrations = readdirSync(new URL('../schema/migrations/', import.meta.url))
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const result = applyMigrations()
    if (result.ok) {
      console.log('\nAll migrations applied.')
      return
    }

    const isBenignConflict = /duplicate column name|table .* already exists|index .* already exists/i.test(
      result.text,
    )
    if (!isBenignConflict) {
      console.error('\nMigration apply failed with an unexpected error — not auto-skipping.')
      process.exit(1)
    }

    const applied = appliedMigrationNames()
    const nextPending = allMigrations.find((name) => !applied.has(name))
    if (!nextPending) {
      console.error('\nMigration apply failed but no pending migration was found — aborting.')
      process.exit(1)
    }

    console.log(
      `\n"${nextPending}" conflicts with the consolidated base schema (already applied) — marking it applied and retrying.`,
    )
    markMigrationApplied(nextPending)
  }

  console.error(`\nGave up after ${MAX_ATTEMPTS} attempts — check .wrangler/state/v3/d1 manually.`)
  process.exit(1)
}

main()
