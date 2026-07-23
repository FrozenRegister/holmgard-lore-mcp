#!/usr/bin/env node
// Guards the tests/{unit,worker,live}/ layout established by #488/#489: fails
// if any tracked *.test.ts file lives outside one of the three approved test
// directories. Without this, a stray src/foo/bar.test.ts (or a new top-level
// tests/whatever/ directory) would silently never run — none of the three
// Vitest configs' explicit `include` globs would ever reach it — and nothing
// would flag it before merge. See #490.

import { execSync } from 'node:child_process'

const APPROVED_PREFIXES = ['tests/unit/', 'tests/worker/', 'tests/live/']

function main() {
  const trackedFiles = execSync('git ls-files', { encoding: 'utf8', maxBuffer: 1024 * 1024 * 16 })
    .split('\n')
    .filter(Boolean)

  const testFiles = trackedFiles.filter((f) => f.endsWith('.test.ts'))
  const violations = testFiles.filter(
    (f) => !APPROVED_PREFIXES.some((prefix) => f.startsWith(prefix)),
  )

  if (violations.length > 0) {
    console.error('\n✗ Test file(s) found outside tests/{unit,worker,live}/:\n')
    for (const v of violations) {
      console.error(`  ${v}`)
    }
    console.error(
      `\n${violations.length} file(s) violate the test layout. Move ${violations.length === 1 ? 'it' : 'them'} into ` +
        'tests/unit/ (pure functions, no Workers runtime), tests/worker/ (Workers/miniflare runtime), or ' +
        'tests/live/ (production smoke tests) — see CLAUDE.md and docs/testing-and-linting-guide.md.\n',
    )
    process.exit(1)
  }

  console.log(
    `check-test-layout: all ${testFiles.length} tracked *.test.ts file(s) are under tests/{unit,worker,live}/.`,
  )
}

main()
