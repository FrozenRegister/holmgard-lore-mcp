# `.patches/` — diff-based patch pipeline

This directory is the drop point for the asynchronous patch pipeline described in
[issue #554](https://github.com/FrozenRegister/holmgard-lore-mcp/issues/554). Remote AI
agents that need to make small, targeted edits to specific low-risk paths in this repo
can submit a unified diff here instead of rewriting a whole file.

## How it works

1. Open a PR whose only change is a single `.patches/<name>.patch` file (a standard
   unified diff, e.g. produced by `git diff`).
2. `.github/workflows/apply-patches.yml` runs on that PR and, in order:
   - Rejects the patch if it's larger than ~200KB.
   - Runs `git apply --check` as a dry run; fails the check if it doesn't apply cleanly.
   - Parses `git apply --numstat` to find the patch's real target paths and checks them
     against the allowlist/deny-list below. Any path outside the allowlist fails the check.
   - Applies the patch, deletes the `.patch` file, and commits the result back onto your
     PR branch (not the original `.patch` file — only the applied changes).
   - **If the patch touches `.ts` or `.mjs` files**, runs `pnpm install --frozen-lockfile`
     followed by `pnpm run type-check` as a CI gate. Type errors fail the check; the PR
     cannot merge until they're resolved.
3. Your PR then goes through normal review and CI like any other PR — nothing is
   auto-merged, and nothing ever lands on `main` without passing `CODEOWNERS` review.

## Allowed paths (Phase 2)

- `docs/**` (including `docs/issues/**`)
- `.changelog/fragments/**`
- `README.md`
- `CONTRIBUTING.md`
- `TODO.md`
- `src/**` — application source (subject to the type-check gate above)
- `tests/**` — test files (subject to the type-check gate above)

## Explicitly denied, always

- `.github/**` — prevents the pipeline from modifying its own workflow definition
- `CLAUDE.md`, `ISSUE_RESOLUTION_PROTOCOL.md`, `PROTOCOL_INVOCATION.md` — agent-instruction /
  autonomous-execution protocol documents
- `ARCHITECTURE.md` — the repo's authoritative design reference
- `SECURITY.md` — governance document
- `CHANGELOG.md` — generated from `.changelog/fragments/` at release time, not a hand-edit target

Any path not explicitly listed as allowed is denied by default. Widening this list beyond
`src/**` and `tests/**` requires a new issue referencing #554 and #567.

## If your patch fails `git apply --check`

The target file has drifted since you read it. Re-fetch the current file content, regenerate
your diff against it, and push a new commit to the same PR branch — no `--reject`/fuzzy-patch
fallback is supported in Phase 2.

## If your patch fails the type-check gate

The patch applied cleanly but introduced a TypeScript type error. The workflow logs the
exact `tsc` diagnostics. Fix the type error (either in the patched file or by adjusting the
patch) and push a new commit to the same PR branch.
