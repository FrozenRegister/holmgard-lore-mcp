# Patch pipeline for remote agents (#554)

## What this is

A way for remote AI agents (Copilot MCP endpoints, Composio, or any remote GitHub API
client) to make small, targeted edits to a narrow set of low-risk paths in this repo by
submitting a unified diff instead of rewriting an entire file. See
[`.patches/README.md`](../.patches/README.md) for the step-by-step mechanics and
[issue #554](https://github.com/FrozenRegister/holmgard-lore-mcp/issues/554) for the
full design writeup, including the red-team review that shaped the security model below.

## When to use this

**Default: use a normal file push (`create_or_update_file` / `PUT`).** For the majority
of changes — small files, new files, files under ~500 lines, or any edit where you're
modifying more than a few lines — just rewrite the file and push it. It's simpler,
faster, and avoids the overhead of the patch pipeline.

**Use a patch only as a last resort, when:**

- The file is large (e.g. `src/index.ts` at ~2200 lines, a long guide under `docs/`, or
  `README.md`) and you only need to add, remove, or change 1–2 lines. This only helps
  *within* the allowlist below — a file outside it (e.g. `pnpm-lock.yaml`, or anything
  under `.github/`) can't be patched through this pipeline regardless of size; use a normal
  push for those, or split the change into a PR a human can review directly.
- A full rewrite risks truncation due to the file's size.
- A full rewrite would clobber concurrent edits from other agents or humans.
- The token cost of sending the full file is prohibitive for the size of the change.

In short: if you can push the whole file cleanly, do that. Patches exist for the cases
where you can't.

## Why a diff instead of a full-file rewrite

Full-file rewrites via `create_or_update_file` / `PUT /repos/{owner}/{repo}/contents/{path}`
cost a lot of tokens for a small change, bloat git history, and risk truncation or
clobbering concurrent edits on large files. A small unified diff avoids all three.

## Security model

This pipeline can only ever touch a fixed, narrow allowlist of paths — `docs/**`,
`.changelog/fragments/**`, `README.md`, `CONTRIBUTING.md`, `TODO.md`, `src/**`, and
`tests/**` — enforced by parsing each patch's actual target paths (`git apply --numstat`)
before applying it, not just by the workflow's trigger filter. `.github/**` (workflow
definitions), `CLAUDE.md`, `ISSUE_RESOLUTION_PROTOCOL.md`, `PROTOCOL_INVOCATION.md`
(agent-instruction / protocol documents), `ARCHITECTURE.md` (the repo's authoritative
design reference), `SECURITY.md`, and the generated `CHANGELOG.md` are explicitly denied,
regardless of what a patch claims to target. Every patch also goes through `git apply --check`
(reject anything that doesn't apply cleanly) and a ~200KB size cap before being applied.
Patches that touch `.ts` or `.mjs` files are additionally gated on `pnpm run type-check`
passing — type errors fail the check and the PR cannot merge until resolved. Applied changes
land on a normal PR branch and go through the same `CODEOWNERS` review and CI as any
human-authored PR — nothing is auto-merged and nothing reaches `main` without review.

## How to submit a patch

1. Generate a unified diff (`git diff`) touching only paths in the allowlist above.
2. Push a branch containing a single new file at `.patches/<descriptive-name>.patch` with
   that diff's content.
3. Open a PR. `.github/workflows/apply-patches.yml` validates and applies the patch,
   committing the result back onto your PR branch, then normal review/CI takes over.
4. If the check fails (size, `apply --check`, path allowlist, or type-check), read the
   failure message in the PR's CI run, regenerate the patch against the current file
   content, and push again — see `docs/agent-ci-artifacts-guide.md` for how to read CI
   failures without re-running everything locally.

## Widening the allowlist

Any path outside the current allowlist — including the excluded agent-instruction/protocol
documents above — is explicitly out of scope for Phase 2. Track requests to widen it as a
follow-up issue referencing #554 and #567, not as a patch attempt (which will simply be
rejected).
