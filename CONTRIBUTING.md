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

## Before you open a PR

Read [CLAUDE.md](./CLAUDE.md) for storage selection (KV vs. D1), API surface conventions (MCP reads vs. `/admin/*` writes), branch naming, and the CI gates enforced on every PR. Use the [PR template](.github/PULL_REQUEST_TEMPLATE.md) — it lists every gate from `ci.yml` and `pr-quality.yml`.

For the full autonomous-agent workflow, see [ISSUE_RESOLUTION_PROTOCOL.md](./ISSUE_RESOLUTION_PROTOCOL.md) and [PROTOCOL_INVOCATION.md](./PROTOCOL_INVOCATION.md).
