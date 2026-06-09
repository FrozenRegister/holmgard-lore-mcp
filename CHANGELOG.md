# Changelog

## [Unreleased]

### Added

- **GitHub Actions Automation Pipeline** — Implemented 8 new workflows for AI-driven issue triage, agent assignment, and PR quality enforcement. (Issue #33)
  - **Issue Tagger** (`issue-tagger.yml`) — Automatically labels issues by surface area (API, state, utils, build, docs, tests, admin) and complexity depth (0–4) using keyword heuristics.
  - **Parallelization** (`parallelize-issues.yml`) — Groups open issues into parallelizable batches on manual dispatch; issues in the same batch share surface areas and must run sequentially.
  - **Agent Assignment** (`agent-assignment.yml`) — Assigns AI agents to each batch (even batches → claude, odd → cline) when a batch label is applied.
  - **Agent Trigger** (`agent-trigger.yml`) — Posts standardized work-order prompts with full implementation workflow when an agent label is applied.
  - **PR Quality Enforcement** (`pr-quality.yml`) — Requires CHANGELOG.md and docs changes in every PR; includes `skip-quality-checks` escape hatch for hotfixes.
  - **Auto-Merge** (`auto-merge.yml`) — Queues PRs for auto-merge when `auto-merge` label is applied (after CI passes).
  - **Label Bootstrap** (`setup-labels.yml`) — Manual workflow to create all 24 required labels (surface, depth, batch, agent, quality).
  - **Enhanced CI** — Upgraded `ci.yml` to include `type-check` and `lint` jobs alongside tests; removed `continue-on-error: true` so CI failures block merges.
  - **Pipeline Documentation** (`docs/ai-automation-pipeline.md`) — Complete guide to the automation system, label meanings, workflow triggers, and troubleshooting.

### Fixed

- **CI workflow (`.github/workflows/ci.yml`)** — Fixed `actions/setup-node` cache setup failures by installing pnpm *before* calling `setup-node` (moved `pnpm/action-setup@v2` before `actions/setup-node@v4` in all three jobs). Also downgraded pnpm from 11.5.1 to 10.15.0 to support Node 20 testing; pnpm 11.5.1 requires Node 22.13+. (Issue #37)

- **admin/routes.ts** — `POST /set-lore` now properly rejects empty, null, whitespace-only, and non-string keys (e.g. numbers, arrays) with a 400 response. Previously, non-string values slipped through to KV, potentially creating garbage entries with empty keys. The validation now uses `typeof` checks and a shared `extractKey()` helper used by all admin routes. (Issues #1, #7)

- **admin/routes.ts** — `extractText()` now trims whitespace, so whitespace-only text values are rejected with 400 instead of being stored.

### Changed

- **admin/routes.ts** — Extracted shared `extractKey()`, `extractText()`, `extractSecret()`, and `checkSecret()` helpers to eliminate copy-paste drift across `set-lore`, `delete-lore`, and `gc` routes. Auth checks now flow through a single `checkSecret()` function. (Issue #1)