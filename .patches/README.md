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
3. Your PR then goes through normal review and CI like any other PR — nothing is
   auto-merged, and nothing ever lands on `main` without passing `CODEOWNERS` review.

## Allowed paths (Phase 1)

- `docs/**` (including `docs/issues/**`)
- `.changelog/fragments/**`
- `README.md`
- `CONTRIBUTING.md`
- `TODO.md`

## Explicitly denied, always

- `.github/**` — prevents the pipeline from modifying its own workflow definition
- `CLAUDE.md`, `ISSUE_RESOLUTION_PROTOCOL.md`, `PROTOCOL_INVOCATION.md` — agent-instruction /
  autonomous-execution protocol documents
- `ARCHITECTURE.md` — the repo's authoritative design reference
- `SECURITY.md` — governance document
- `CHANGELOG.md` — generated from `.changelog/fragments/` at release time, not a hand-edit target

Any path not explicitly listed as allowed is denied by default. Widening this list is
tracked as a follow-up to #554, not something to request via a patch itself.

## If your patch fails `git apply --check`

The target file has drifted since you read it. Re-fetch the current file content, regenerate
your diff against it, and push a new commit to the same PR branch — no `--reject`/fuzzy-patch
fallback is supported in Phase 1.
