# Changelog

## [Unreleased]

### Added

- **Claude Code Protocol: Pre-Commit Validation Required** — Updated CLAUDE.md to explicitly state that pre-commit validation via `./scripts/pre-commit-validate.ps1` is REQUIRED before creating any commit. Formalizes that Claude Code acts as a team member and validates locally before committing, not waiting for GitHub Actions. Protocol documented in project memory system for consistency across sessions.

- **Pre-Commit Validation Scripts** — Added local validation to catch common issues without waiting for GitHub Actions. Includes PowerShell script for Windows developers (`scripts/pre-commit-validate.ps1`) and Bash hook for Unix users (`.git/hooks/pre-commit`). Validates markdown linting, CHANGELOG.md requirements, and test suite. Documented in CLAUDE.md with usage examples. (Issue #6)

- **Testing & Linting Documentation** — Created comprehensive `docs/testing-and-linting-guide.md` documenting test suite status (384 passing tests), type-check status, known linting issues (284 pre-existing problems), and step-by-step process for fixing lint errors. Referenced from CLAUDE.md for easy access during development.

- **Handoff Packet for Editor Automation Setup** — Created `docs/HANDOFF-editor-automation-setup.md` providing complete instructions for replicating the AI automation pipeline in holmgard-lore-editor repository. Includes phase-by-phase implementation plan, files to copy/adapt, architecture differences, key configuration notes, and success criteria.

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

- **wrangler.jsonc & CLAUDE.md** — Documented KV namespace isolation to prevent production data corruption. Production (`id`: `67b47914eb094043ab777f4f34da8bfc`) and preview (`preview_id`: `d99c543e9ccf46dca6900cc28d93362a`) namespaces are intentionally separate so `wrangler dev` uses isolated preview storage while `wrangler deploy` uses production. Added deployment notes warning against allowing these IDs to be identical, which would cause local development to corrupt production data. (Issue #6)

- **PROTOCOL_INVOCATION.md** — Fixed markdown linting errors where emphasis was incorrectly used instead of headings (MD036/no-emphasis-as-heading). Changed bold text error descriptions to proper heading levels.

- **CI workflow (`.github/workflows/ci.yml`)** — Fixed `actions/setup-node` cache setup failures by installing pnpm *before* calling `setup-node` (moved `pnpm/action-setup@v2` before `actions/setup-node@v4` in all three jobs). Also downgraded pnpm from 11.5.1 to 10.15.0 to support Node 20 testing; pnpm 11.5.1 requires Node 22.13+. (Issue #37)

- **admin/routes.ts** — `POST /set-lore` now properly rejects empty, null, whitespace-only, and non-string keys (e.g. numbers, arrays) with a 400 response. Previously, non-string values slipped through to KV, potentially creating garbage entries with empty keys. The validation now uses `typeof` checks and a shared `extractKey()` helper used by all admin routes. (Issues #1, #7)

- **admin/routes.ts** — `extractText()` now trims whitespace, so whitespace-only text values are rejected with 400 instead of being stored.

### Changed

- **admin/routes.ts** — Extracted shared `extractKey()`, `extractText()`, `extractSecret()`, and `checkSecret()` helpers to eliminate copy-paste drift across `set-lore`, `delete-lore`, and `gc` routes. Auth checks now flow through a single `checkSecret()` function. (Issue #1)
