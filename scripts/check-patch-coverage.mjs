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
import { readFileSync, existsSync, writeFileSync } from 'node:fs'

const baseRef = process.env.PATCH_COVERAGE_BASE_REF || 'origin/main'
const coveragePath = process.env.PATCH_COVERAGE_JSON || 'coverage/coverage-final.json'
const reportPath = process.env.PATCH_COVERAGE_REPORT || 'coverage/patch-coverage-report.json'

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
  // All test files now live under tests/, outside src/, so the leading
  // `!relPath.startsWith('src/')` check already excludes them.
  if (!relPath.startsWith('src/')) return true
  if (/\/migrate-[^/]+\.ts$/.test('/' + relPath)) return true
  return false
}

const IGNORE_REVS_PATH = '.git-blame-ignore-revs'
const hasIgnoreRevs = existsSync(IGNORE_REVS_PATH)
const ignoreRevsWarnings = []

// A rebase, or this repo's standard squash-merge (every PR becomes exactly
// one new commit on main — verified: main is a straight line of "<title>
// (#N)" commits, no individual PR commits survive), rewrites commit SHAs
// and silently orphans any entry in .git-blame-ignore-revs still pointing at
// the old one. This has now happened twice for two different reasons (a
// rebase during this mechanism's own introduction, then squash-merge on the
// very next merge). An earlier version of this check hard process.exit(1)'d
// on a bad SHA — which sounds safer but is actually worse: it silently broke
// patch-coverage-report.json's "written unconditionally" guarantee (the
// artifact just didn't exist) and hard-failed the Coverage job on every PR
// afterward, regardless of that PR's own content. Degrade instead: drop only
// the bad SHA (isPreExistingLine simply won't match it — patch-coverage gets
// stricter for reformatted regions specifically, not for every PR), and warn
// loudly in both console output and the JSON report so a human notices and
// fixes the file, without blocking unrelated work over it.
const ignoredRevSet = hasIgnoreRevs
  ? new Set(
      readFileSync(IGNORE_REVS_PATH, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .filter((sha) => {
          try {
            execSync(`git cat-file -e ${sha}^{commit}`, { stdio: 'ignore' })
            return true
          } catch {
            const warning =
              `${IGNORE_REVS_PATH} lists ${sha}, which doesn't resolve to a commit in this checkout ` +
              `— a rebase/squash-merge likely rewrote it. Update the file with the new SHA ` +
              `(git log --format=%H --grep=<commit message>).`
            console.error(`check-patch-coverage: WARNING: ${warning}`)
            ignoreRevsWarnings.push(warning)
            return false
          }
        }),
    )
  : new Set()

// A mass mechanical reformat (e.g. introducing Prettier for the first time)
// touches the *text* of thousands of pre-existing lines without changing
// their logic. A raw git diff can't tell "reformatted" apart from "new", so
// it flags long-untested pre-existing branches as if this PR just added
// them — a false positive this diff-based gate has no other way to avoid.
// Reuses .git-blame-ignore-revs (already required for `git blame` to skip
// pure-reformat commits) as the single source of truth: for every line this
// script is about to flag, ask blame (with reformat commits ignored) who
// really wrote it.
//
// `git blame --ignore-revs-file` is itself best-effort: for a small reflow
// (a line moved, a trailing comma added) it successfully re-attributes to
// the true original commit. For a bigger reshape (one long line wrapped
// into nine), its matching heuristic can give up and fall back to blaming
// the ignored commit anyway — verified this happens in practice (e.g.
// src/tools/entity.ts's `if (...) return c.json(...)` one-liner, wrapped
// across 9 lines by Prettier, still blames to the reformat commit despite
// --ignore-revs-file). So two independent signals both count as
// "pre-existing, not a real gap":
//   1. blame resolves to some earlier real commit that's already an
//      ancestor of the base branch, or
//   2. blame still resolves to a commit that .git-blame-ignore-revs itself
//      lists — that file is a human assertion that the commit changed no
//      logic, so falling back to it is proof of "no logic change" on its
//      own, regardless of whether it's merged to the base branch yet.
function isPreExistingLine(relPath, line, ref) {
  if (!hasIgnoreRevs) return false
  try {
    const ignoreArg = `--ignore-revs-file ${IGNORE_REVS_PATH}`
    const blameOut = execSync(
      `git blame ${ignoreArg} --porcelain -L ${line},${line} -- "${relPath}" HEAD`,
      {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 8,
      },
    )
    const sha = blameOut.split('\n', 1)[0].split(' ')[0]
    if (!/^[0-9a-f]{40}$/.test(sha)) return false
    if (ignoredRevSet.has(sha)) return true
    execSync(`git merge-base --is-ancestor ${sha} ${ref}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function writeReport(report) {
  // Written unconditionally (pass, fail, or nothing-to-check) so an agent
  // reading the coverage-report artifact never needs to parse console output
  // or a job log to learn the answer — see issue #479.
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
}

function main() {
  const changed = getChangedLines(baseRef)
  if (changed.size === 0) {
    console.log(`check-patch-coverage: no changed .ts files vs ${baseRef} — nothing to check`)
    writeReport({
      passed: true,
      baseRef,
      checkedFiles: 0,
      failures: [],
      warnings: ignoreRevsWarnings,
    })
    return
  }

  if (!existsSync(coveragePath)) {
    const message = `${coveragePath} not found — did the coverage reporter include 'json'?`
    console.error(`check-patch-coverage: ${message}`)
    writeReport({
      passed: false,
      baseRef,
      checkedFiles: 0,
      failures: [],
      error: message,
      warnings: ignoreRevsWarnings,
    })
    process.exit(1)
  }
  const coverage = JSON.parse(readFileSync(coveragePath, 'utf8'))

  const failures = []
  let excludedAsPreExisting = 0
  for (const [relPath, lines] of changed) {
    if (isExcludedFromCoverage(relPath)) continue

    const entry = findCoverageEntry(coverage, relPath)
    if (!entry) {
      const allLines = [...lines]
      const newLines = allLines.filter((ln) => !isPreExistingLine(relPath, ln, baseRef))
      excludedAsPreExisting += allLines.length - newLines.length
      if (newLines.length > 0) {
        failures.push({
          file: relPath,
          lines: newLines.sort((a, b) => a - b),
          reason: 'no coverage data — file not tracked by any test',
        })
      }
      continue
    }

    const uncoveredLines = new Set()
    for (const [id, loc] of Object.entries(entry.statementMap)) {
      if (entry.s[id] !== 0) continue
      for (let ln = loc.start.line; ln <= loc.end.line; ln++) {
        if (lines.has(ln)) uncoveredLines.add(ln)
      }
    }
    const allUncovered = [...uncoveredLines]
    const newUncoveredLines = allUncovered.filter((ln) => !isPreExistingLine(relPath, ln, baseRef))
    excludedAsPreExisting += allUncovered.length - newUncoveredLines.length
    if (newUncoveredLines.length > 0) {
      failures.push({ file: relPath, lines: newUncoveredLines.sort((a, b) => a - b) })
    }
  }

  if (excludedAsPreExisting > 0) {
    console.log(
      `check-patch-coverage: excluded ${excludedAsPreExisting} line(s) already on ${baseRef} before this PR (attributed via git blame with ${IGNORE_REVS_PATH} applied) — a reformat commit touched their text but not their logic.`,
    )
  }

  if (failures.length > 0) {
    console.error(
      '\n✗ Patch coverage failed — the following changed lines are not covered by tests:\n',
    )
    for (const f of failures) {
      const lineWord = f.lines.length > 1 ? 'lines' : 'line'
      console.error(
        `  ${f.file}: ${lineWord} ${f.lines.join(', ')}${f.reason ? ` (${f.reason})` : ''}`,
      )
    }
    console.error(
      `\n${failures.length} file(s) with uncovered changed lines. This repo requires 100% patch coverage — see CLAUDE.md.\n`,
    )
    writeReport({
      passed: false,
      baseRef,
      checkedFiles: changed.size,
      failures,
      excludedAsPreExisting,
      warnings: ignoreRevsWarnings,
    })
    process.exit(1)
  }

  console.log(`check-patch-coverage: all changed lines across ${changed.size} file(s) are covered.`)
  writeReport({
    passed: true,
    baseRef,
    checkedFiles: changed.size,
    failures: [],
    excludedAsPreExisting,
    warnings: ignoreRevsWarnings,
  })
}

main()
