#!/usr/bin/env node
// Runs automatically via the "prepare" npm lifecycle script (pnpm install /
// npm install), so the local pre-commit gate (type-check, lint, markdown,
// changelog fragment, test layout — see scripts/pre-commit-validate.sh/.ps1)
// self-activates for every clone instead of requiring a contributor (or
// agent) to remember `git config core.hooksPath scripts` by hand. See #492:
// an agent working from a fresh clone had no local gate and only found out
// about a misplaced test file from CI, after already pushing.
//
// Best-effort only — never fails `pnpm install` (no .git directory, e.g. an
// extracted tarball rather than a clone, or no git binary on PATH, are both
// silently skipped).

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'

function main() {
  if (!existsSync('.git')) {
    console.log('setup-git-hooks: no .git directory found, skipping (not a git checkout)')
    return
  }

  try {
    execSync('git config core.hooksPath scripts', { stdio: 'ignore' })
    console.log('setup-git-hooks: core.hooksPath set to scripts/ — local pre-commit gate is active')
  } catch (err) {
    console.log(`setup-git-hooks: could not configure git hooks (${err.message}) — continuing anyway`)
  }
}

main()
