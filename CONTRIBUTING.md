# Contributing

## Which issue template do I use?

| Template | Use for |
|---|---|
| [Bug Report](.github/ISSUE_TEMPLATE/bug_report.yml) | CI failures, type errors, test regressions, runtime crashes |
| [Feature Request](.github/ISSUE_TEMPLATE/feature_request.yml) | New tool, handler, migration, or MCP capability |
| [Design Proposal](.github/ISSUE_TEMPLATE/design_proposal.yml) | Architectural design — no code, no implementation |
| [Agent Task](.github/ISSUE_TEMPLATE/agent_task.yml) | Dispatch work to `agent:archisector`, `agent:calder`, or `agent:engineering` |
| [D1 Migration](.github/ISSUE_TEMPLATE/migration.yml) | Database migration — new table, alter, backfill, or index |
| [Refactor](.github/ISSUE_TEMPLATE/refactor.yml) | Internal restructure — no new behavior, no API changes |
| [Meta / Process](.github/ISSUE_TEMPLATE/meta.yml) | CI workflows, repo config, templates, CODEOWNERS, tooling |
| [Security Vulnerability](.github/ISSUE_TEMPLATE/security_vuln.yml) | Medium/Low severity or already-public security issues — see [SECURITY.md](./SECURITY.md) for Critical/High |

If none of these fit, blank issues are still enabled.

## Looking for something to do?

Check the pinned [Coverage Gaps (auto-updated)](https://github.com/FrozenRegister/holmgard-lore-mcp/issues/504) issue — a standing backlog of the worst-covered files in `src/`, sorted worst-first, refreshed on every push to `main`. Good default pick-up work when you (human or agent) have downtime and no specific issue assigned.

## Before you open a PR

Read [CLAUDE.md](./CLAUDE.md) for storage selection (KV vs. D1), API surface conventions (MCP reads vs. `/admin/*` writes), branch naming, and the CI gates enforced on every PR. Use the [PR template](.github/PULL_REQUEST_TEMPLATE.md) — it lists every gate from `ci.yml` and `pr-quality.yml`.

**New or moved test files go under `tests/unit/`, `tests/worker/`, or `tests/live/` — never colocated beside source, and never a new top-level test directory.** See CLAUDE.md § Tests. This is enforced by `pnpm run check:test-layout`, which runs as its own CI job and as the first step of the local pre-commit gate (auto-enabled by `pnpm install` via the `prepare` script — no manual `git config` needed).

For the full autonomous-agent workflow, see [ISSUE_RESOLUTION_PROTOCOL.md](./ISSUE_RESOLUTION_PROTOCOL.md) and [PROTOCOL_INVOCATION.md](./PROTOCOL_INVOCATION.md).
