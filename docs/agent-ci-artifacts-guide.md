# CI Artifacts Guide (For Agents)

**Audience: AI agents working on this repo — not human contributors.** This document exists so that an agent fixing a PR to green reads what CI already computed instead of re-running `pnpm test`, `pnpm run lint`, `pnpm run type-check`, or `pnpm test:coverage` locally. Every one of those commands is already run by CI on every push, and the results are already sitting in small, structured, downloadable artifacts. Re-running them wastes the exact time this system exists to save.

**The rule: before running any test/lint/type-check/coverage command yourself to diagnose a *failing PR*, check whether the answer already exists in one of the artifacts below.** Re-running locally is appropriate when you're actively iterating on a fix (write code, run the one test file you touched, repeat) — it's redundant when you're just trying to find out *why* an already-completed CI run failed.

See #479 and #480 for the design history and rationale (including the fact that `get_job_logs` was tested directly and found to be an unreliable way to find a specific step's output — see "Why not just read the job log" below).

---

## What gets generated, on every push

| Artifact name | Job it comes from | Files inside | Answers |
|---|---|---|---|
| `coverage-report` | `coverage` | `lcov.info`, `coverage-final.json`, `coverage-summary.json`, `patch-coverage-report.json` | "Did patch coverage pass? Which exact lines are uncovered?" |
| `lint-report-{sha}` | `lint` | `eslint-report.json` | "Which lint rule fired, in which file, on which line?" |
| `typecheck-report-{sha}` | `type-check` | `tsc-diagnostics.txt` | "What are the exact compiler errors?" |
| `test-results-unit-{sha}` | `unit-tests` | `test-results-unit.json` | "Which pure-function unit test failed, and why?" |
| `test-results-shard-{1..4}-{sha}` | `test` (one per shard) | `test-results-shard-{N}.json` | "Which integration test failed, in which shard, and why?" |

`{sha}` is the commit SHA of the head commit CI ran against (`github.sha`). All artifacts have **7-day retention**. Every artifact-producing step in these jobs runs with `if: always()`, so a job *failing* still produces its artifact — that's the case you need it most.

---

## How to find and read an artifact (no new auth, no `gh` CLI)

This repo's GitHub MCP toolset already supports listing and downloading workflow artifacts — verified working directly against this repo. Don't reach for a `gh` CLI device-code flow or any other auth; you already have what you need in-session.

```
1. pull_request_read (get) → get the PR's head SHA and check run statuses
2. For each failed check, find its run_id (from the check run's details_url or actions_list)
3. actions_list(method: "list_workflow_run_artifacts", resource_id: <run_id>)
     → returns each artifact's id, name, size, expiry, AND workflow_run.head_sha
4. Before downloading: compare the returned head_sha against the PR's current head SHA.
     If they don't match, the artifact is stale (e.g. a force-push happened after
     this run) — don't trust it, look for a newer run instead. This check costs
     nothing — it's in the listing response, no download required.
5. actions_get(method: "download_workflow_run_artifact", resource_id: <artifact_id>)
     → returns a signed download_url (temporary — fetch it promptly)
6. Fetch the zip, extract, read the specific file for your failure mode (see table above)
```

**Match the failure to the artifact, don't download everything:**

| The failing check is called... | Download this artifact | Read this file |
|---|---|---|
| `Coverage` | `coverage-report` | `patch-coverage-report.json` |
| `Lint` | `lint-report-{sha}` | `eslint-report.json` |
| `Type Check` | `typecheck-report-{sha}` | `tsc-diagnostics.txt` |
| `Unit Tests (pure functions, no Workers runtime)` | `test-results-unit-{sha}` | `test-results-unit.json` |
| `Tests (Node 22, shard N/4)` | `test-results-shard-{N}-{sha}` | `test-results-shard-{N}.json` |

---

## File formats — what to expect when you open each one

### `patch-coverage-report.json`

Written unconditionally by `scripts/check-patch-coverage.mjs` (pass, fail, or nothing-to-check) — this is the single most useful file in the whole bundle, because it answers the repo's heaviest-weighted gate ("100% patch coverage") directly, with no computation on your part:

```json
{
  "passed": false,
  "baseRef": "origin/main",
  "checkedFiles": 2,
  "failures": [
    { "file": "src/tools/example.ts", "lines": [42, 43, 44], "reason": "no coverage data — file not tracked by any test" }
  ]
}
```

- `passed: false` means the `coverage` job failed the patch-coverage gate — `failures` is the exhaustive list of what to fix. Write tests covering exactly those lines in that file.
- `failures[].reason` is only present when the file has *no* coverage data at all (a genuinely untested new file), as opposed to a partially-covered file where some changed lines have zero hits.
- `checkedFiles: 0` with `passed: true` means no `.ts` files under `src/` changed relative to the base branch — nothing to check, not a false pass.
- If `coverage/coverage-final.json` didn't exist when the script ran (a reporter misconfiguration), you'll see `passed: false` with an `error` field instead of `failures` — that's an infrastructure problem, not a "write more tests" problem.

### `coverage-final.json` / `coverage-summary.json`

Standard istanbul output (via `@vitest/coverage-istanbul`). `coverage-final.json` has per-file `statementMap`/`s` (statement id → hit count), `branchMap`/`b`, `fnMap`/`f` — use this only if you need something `patch-coverage-report.json` doesn't already tell you (e.g. overall file coverage %, not just the patch). `coverage-summary.json` has aggregate percentages per file (`lines.pct`, `statements.pct`, `functions.pct`, `branches.pct`) plus a `total` entry.

### `eslint-report.json`

ESLint's native `--format json` output: an array, one entry per file, each with a `messages` array of `{ ruleId, severity, message, line, column, endLine, endColumn }`. `severity: 2` is an error, `1` is a warning. Go straight to the file and line named — no need to run eslint yourself to get this level of detail.

### `tsc-diagnostics.txt`

Plain text, `tsc --noEmit --pretty false` output, capped at 5000 lines. An **empty file means zero compiler errors** — that's a valid, correct signal, not a missing-data problem. Format is standard `file(line,col): error TSxxxx: message`.

### `test-results-unit.json` / `test-results-shard-{N}.json`

Vitest's built-in JSON reporter (`--reporter=json`), verified locally to produce: `numTotalTestSuites`, `numPassedTestSuites`, `numFailedTestSuites`, `numTotalTests`, `numPassedTests`, `numFailedTests`, `success` (boolean), and a `testResults` array with per-suite `assertionResults` — each including `status` (`passed`/`failed`), `title`, `fullName`, and `failureMessages` (the actual assertion error / stack trace) when failed. This is the exact same information the job's console log has, just parseable without regex.

---

## Why not just read the job log?

Tested directly against this repo, not assumed: `get_job_logs` on the `coverage` job (default settings) never reached the `check-patch-coverage` step's own output. It cut off inside the *Codecov upload* step's CLI, which alone emits 150+ debug lines translating file-exclusion glob patterns (`*.py` → regex, `*.rb` → regex, ...) before anything actionable — and the `Run tests with coverage` step before that runs several minutes and produces far more volume than a default-sized log fetch reaches. Reliably finding one step's output in a raw job log means either a very large tail fetch or a full-log grep — real digging. The artifacts above exist specifically so that digging is never necessary: each one is small, purpose-built, and answers exactly one question.

If something genuinely isn't covered by any artifact here (an infra/install failure, something the `Set up job` step reported, etc.), `get_job_logs` is still the right fallback — just don't reach for it first for coverage, lint, type-check, or test failures.

---

## Staleness and force-pushes

Every artifact is named with the commit SHA it was generated from (`{sha}` in the table above, or embedded via `workflow_run.head_sha` in the artifact listing for `coverage-report`, which isn't SHA-suffixed by name). Before trusting any downloaded artifact against a PR you're actively fixing, confirm the SHA in the listing matches the PR's *current* head SHA (from `pull_request_read`). If a force-push happened after the run that produced the artifact you're looking at, it's describing a commit that no longer exists on the branch — find the newer run instead.

---

## Related

- [`CLAUDE.md`](../CLAUDE.md) — see "CI Artifacts for Agents" for the short version of this document
- [Testing and Linting Guide](./testing-and-linting-guide.md) — human-facing local dev workflow (running tests yourself while writing code, not diagnosing a completed CI run)
- Issue #479 — full design history and rationale
- Issue #480 / PR #481 — the patch-coverage gate itself (`scripts/check-patch-coverage.mjs`)
