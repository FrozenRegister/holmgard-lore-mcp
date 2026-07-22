#!/usr/bin/env node
// Diff-aware coverage gate: fails if any line added or modified in this PR
// (relative to the base branch) has zero test coverage, per istanbul's
// coverage/coverage-final.json. This runs synchronously in the same CI job
// as the tests, unlike Codecov's codecov/patch check — which auto-merge.yml
// intentionally excludes from blocking merge, and which posts asynchronously
// on Codecov's own backend, often after auto-merge has already evaluated
// (see issue #480). vitest's own coverage.thresholds are whole-file/whole-repo
// and not diff-aware, so they can't express "100% of *changed* lines" without
// either breaking on pre-existing debt or missing a badly-covered new file.

import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const baseRef = process.env.PATCH_COVERAGE_BASE_REF || 'origin/main'
const coveragePath = process.env.PATCH_COVERAGE_JSON || 'coverage/coverage-final.json'

function getChangedLines(ref) {
  const diffOutput = execSync(`git diff --unified=0 --diff-filter=ACMR ${ref}...HEAD -- '*.ts'`, {
    maxBuffer: 1024 * 1024 * 64,
    encoding: 'utf8',
  })
  const changed = new Map()
  let currentFile = null
  let newLine = null
  for (const line of diffOutput.split('\n')) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice('+++ b/'.length).trim()
      continue
    }
    if (line.startsWith('@@')) {
      const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (match) newLine = Number(match[1])
      continue
    }
    if (currentFile === null) continue
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) {
      if (!changed.has(currentFile)) changed.set(currentFile, new Set())
      changed.get(currentFile).add(newLine)
      newLine++
    }
    // deletion lines ('-') don't consume a new-file line number
  }
  return changed
}

function findCoverageEntry(coverage, relPath) {
  for (const absPath of Object.keys(coverage)) {
    const normalized = absPath.replaceAll('\\', '/')
    if (normalized === relPath || normalized.endsWith('/' + relPath)) return coverage[absPath]
  }
  return null
}

function isExcludedFromCoverage(relPath) {
  // Mirrors vitest.config.ts coverage.include/exclude — files matching these
  // legitimately have no coverage data and shouldn't be flagged as gaps.
  if (!relPath.startsWith('src/')) return true
  if (relPath.startsWith('src/__tests__/')) return true
  if (/\/migrate-[^/]+\.ts$/.test('/' + relPath)) return true
  return false
}

function main() {
  const changed = getChangedLines(baseRef)
  if (changed.size === 0) {
    console.log(`check-patch-coverage: no changed .ts files vs ${baseRef} — nothing to check`)
    return
  }

  if (!existsSync(coveragePath)) {
    console.error(`check-patch-coverage: ${coveragePath} not found — did the coverage reporter include 'json'?`)
    process.exit(1)
  }
  const coverage = JSON.parse(readFileSync(coveragePath, 'utf8'))

  const failures = []
  for (const [relPath, lines] of changed) {
    if (isExcludedFromCoverage(relPath)) continue

    const entry = findCoverageEntry(coverage, relPath)
    if (!entry) {
      failures.push({ file: relPath, lines: [...lines].sort((a, b) => a - b), reason: 'no coverage data — file not tracked by any test' })
      continue
    }

    const uncoveredLines = new Set()
    for (const [id, loc] of Object.entries(entry.statementMap)) {
      if (entry.s[id] !== 0) continue
      for (let ln = loc.start.line; ln <= loc.end.line; ln++) {
        if (lines.has(ln)) uncoveredLines.add(ln)
      }
    }
    if (uncoveredLines.size > 0) {
      failures.push({ file: relPath, lines: [...uncoveredLines].sort((a, b) => a - b) })
    }
  }

  if (failures.length > 0) {
    console.error('\n✗ Patch coverage failed — the following changed lines are not covered by tests:\n')
    for (const f of failures) {
      const lineWord = f.lines.length > 1 ? 'lines' : 'line'
      console.error(`  ${f.file}: ${lineWord} ${f.lines.join(', ')}${f.reason ? ` (${f.reason})` : ''}`)
    }
    console.error(`\n${failures.length} file(s) with uncovered changed lines. This repo requires 100% patch coverage — see CLAUDE.md.\n`)
    process.exit(1)
  }

  console.log(`check-patch-coverage: all changed lines across ${changed.size} file(s) are covered.`)
}

main()
