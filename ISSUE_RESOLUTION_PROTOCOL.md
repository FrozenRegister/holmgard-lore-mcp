# Issue Resolution Protocol

This protocol governs how AI agents (Archisector, Calder, engineering) resolve GitHub Issues in the holmgard-lore-mcp repository. It is referenced by `PROTOCOL_INVOCATION.md` and the Agent Trigger workflow.

## Overview

Every issue resolution follows seven phases, each with a defined output. The protocol is designed to be followed autonomously by an AI agent after receiving a work order.

## Phase 1: Triage

**Goal:** Understand the issue before touching code.

1. Read the issue body and all comments
2. Read `ARCHITECTURE.md`'s "Scale and constraints" section before evaluating any
   proposed solution — this repo is one Cloudflare Worker, not a distributed system,
   and proposals that don't fit that scale (container tooling, clock-drift detection,
   schema-registry frameworks, etc.) should be flagged or scaled down in Phase 1, not
   carried forward into the plan
3. If the issue is an **Agent Task** (has `agent-task` label), extract:
   - **Context** — what design issues, PRs, or threads this task operates within
   - **Task description** — what exactly needs to be done
   - **Expected output type** — code PR, design comment, investigation, narration, or issue filing
   - **Acceptance criteria** — the checkboxes the human will verify against
   - **CI relevance** — which gates apply
4. If the issue is a **Bug Report**, reproduce the problem first
5. If the issue is a **Design Proposal**, read the full proposal before analyzing implementation —
   check every proposed addition against the scale constraints from step 2 before writing it down
6. If the issue is a **Migration**, verify forward SQL, rollback SQL, and data integrity queries
7. If the issue is a **Refactor**, identify the behavior preservation guarantee
8. If the issue is a **Meta** change, understand the rollout and rollback plan
9. Summarize in 3-5 bullet points
10. **Wait for human confirmation** (unless the issue is trivial — single-file, no ambiguity)

## Phase 2: Plan

**Goal:** Identify files and outline the approach.

1. Locate relevant files in the codebase (`src/`, `docs/`, `.github/`)
2. Consult `CLAUDE.md` for:
   - Storage selection (D1 vs KV vs both)
   - API surface conventions (reads → `/mcp` routes, writes → `/admin/*`)
   - Branch naming (`feat/<slug>`, `fix/<slug>`, `chore/<slug>`)
3. Outline step-by-step implementation plan
4. Consider architectural consistency with existing patterns
5. For D1 migrations: verify FK compliance (D1 auto-applies FK in CREATE TABLE)
6. For refactors: verify all call sites are accounted for
7. **Present the plan to the human** before writing code (unless trivial)

## Phase 3: Implement

**Goal:** Write the code.

1. Create branch from `main`: `issue/<N>-<kebab-slug>` or `feat/<slug>` / `fix/<slug>` / `chore/<slug>`
2. Modify existing code or create new files
3. Maintain architectural consistency with existing patterns
4. Remove obsolete code; avoid over-engineering
5. For migrations: write forward SQL, rollback SQL, and data integrity verification queries
6. For refactors: do NOT change behavior — only structure
7. For meta changes: do NOT touch product code

## Phase 4: Test

**Goal:** Prove the code works and doesn't regress.

1. Add or update tests (unit + integration)
2. Run full test suite: `pnpm test`
3. Check coverage: `pnpm test:coverage` — aim for 100% patch coverage
4. Fix failures; don't proceed with broken tests
5. For migrations: run data integrity verification queries
6. For refactors: run regression tests (existing tests must pass without modification)

## Phase 5: Quality (CI Gates)

**Goal:** Pass every CI gate before opening a PR.

1. `pnpm lint` — no warnings
2. `pnpm type-check` — no errors
3. `pnpm build` — clean build
4. For refactors with no behavior change: changelog is optional (document in PR body)
5. For all other changes: add changelog fragment (see Phase 6)

## Phase 6: Document

**Goal:** Leave the codebase better documented than you found it.

1. Update relevant documentation:
   - README sections if applicable
   - API/interface docs
   - Architecture notes
   - Diagrams if affected
2. Add changelog fragment in `.changelog/fragments/<slug>.md`:
   - Use the format from existing fragments
   - Include the issue number
   - Brief summary of the change
   - Do NOT edit `CHANGELOG.md` directly — fragments are compiled at release
3. Update the GitHub Issue:
   - Post a detailed comment with changes made
   - Include links to relevant commits
   - Note tests added/updated
   - Document architectural considerations

## Phase 7: Pull Request

**Goal:** Open a review-ready PR.

1. Create clean commit history (logical commits, clear messages, no noise)
2. Open Pull Request using the PR template (`.github/PULL_REQUEST_TEMPLATE.md`):
   - Fill in **Summary** — one to three sentences
   - Check every applicable CI gate in the **CI checklist**
   - Fill in **What changed** — file table with one-line descriptions
   - Fill in **Migration** — forward SQL or "None"
   - Fill in **Test plan** — what you tested
   - Fill in **Documentation** — files updated or justification for skipping
3. Reference the issue: `Closes #N` or `Part of #N`
4. Mark Ready for Review

## Issue Type Reference

| Template | Labels | CI Gates | Changelog Required |
|---|---|---|---|
| Bug Report | `bug`, `triage` | All | Yes |
| Feature Request | `enhancement` | All | Yes |
| Design Proposal | `design`, `architecture` | None (design only) | No |
| Agent Task | `agent-task` | Varies (see issue body) | Per CI relevance |
| D1 Migration | `migration`, `D1` | All | Yes |
| Refactor | `refactor` | All (heavy test bar) | No (if behavior unchanged) |
| Meta / Process | `meta`, `ci-cd` | Lint only (no code changes) | Recommended |

## See Also

- [PROTOCOL_INVOCATION.md](./PROTOCOL_INVOCATION.md) — How to invoke this protocol
- [CLAUDE.md](./CLAUDE.md) — Project architecture, commands, and conventions
- [Issue Templates](.github/ISSUE_TEMPLATE/) — Structured issue forms
- [PR Template](.github/PULL_REQUEST_TEMPLATE.md) — CI-gate-aware PR template
