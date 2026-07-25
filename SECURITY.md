# Security Policy

## Reporting a Vulnerability

**Critical or High severity vulnerabilities (RCE, auth bypass, data exfiltration, significant privilege escalation) — do not open a public GitHub issue.** This repository's issue tracker is public; posting exploit details or reproduction steps there before a fix ships is full public disclosure and puts production data at risk.

Instead, use GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab → **Report a vulnerability** (or open `.../security/advisories/new` directly).
2. Describe the vulnerability, affected component, and reproduction steps privately.
3. A maintainer will acknowledge the report and coordinate a fix and disclosure timeline with you.

**Medium or Low severity issues**, or vulnerabilities that are already public/patched, can be filed using the [Security Vulnerability issue template](.github/ISSUE_TEMPLATE/security_vuln.yml).

## Scope

This applies to the `holmgard-lore-mcp` Cloudflare Worker (MCP server, `/mcp` and `/admin/*` routes) and its D1/KV-backed storage.

## Patch Pipeline Security

The repo includes an async patch pipeline (`.github/workflows/apply-patches.yml`) for remote AI agents to submit targeted unified diffs against a narrow allowlist of low-risk paths. See [`docs/patch-pipeline-agent-guide.md`](docs/patch-pipeline-agent-guide.md) and [issue #554](https://github.com/FrozenRegister/holmgard-lore-mcp/issues/554) for full details.

The pipeline was red-team reviewed (findings at [#554](https://github.com/FrozenRegister/holmgard-lore-mcp/issues/554#issuecomment-5078978145)) and the following mitigations are in place:

- **Path allowlist/deny-list:** Only `docs/**`, `.changelog/fragments/**`, `README.md`, `CONTRIBUTING.md`, and `TODO.md` can be modified via patches. `.github/**` (workflow definitions), `CLAUDE.md`, protocol documents (`ISSUE_RESOLUTION_PROTOCOL.md`, `PROTOCOL_INVOCATION.md`), `ARCHITECTURE.md`, `SECURITY.md` (this file), and `CHANGELOG.md` are explicitly denied — enforced by parsing `git apply --numstat` output before applying, not by the workflow trigger filter alone.
- **Pre-apply validation:** Every patch goes through `git apply --check`; any patch that doesn't apply cleanly is rejected without side effects.
- **Size cap:** ~200KB maximum patch size.
- **No auto-merge:** Applied changes land on a normal PR branch and go through the same CI and CODEOWNERS review as any human-authored PR. The pipeline never auto-merges to `main`.
- **One-shot format:** `.patches/*.patch` files are deleted after application — they're a submit format, not persistent.

The pipeline's attack surface is limited to the paths above, and any attempt to widen it must go through a follow-up issue referencing #554, not through a patch submission.

## Disclosure

We prefer coordinated disclosure: details are made public only after a fix has merged, unless the reporter and maintainers agree otherwise.
