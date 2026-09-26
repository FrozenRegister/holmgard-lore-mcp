---
type: fix
issue: 708
---

## CI: use `pnpm exec` instead of `npx` so tooling can't resolve from the npm registry

`.github/workflows/ci.yml` (type-check diagnostics, lint report) and
`.github/workflows/d1-migrate.yml` (D1 migrations) invoked local dev tools via
`npx`. When `npx` cannot resolve a binary from the local install it silently
downloads the newest version from the npm registry and runs that, so a
misconfigured or pruned dependency tree yields a report produced by a version
CI never pinned rather than a hard failure. For the migration job that would
mean applying live D1 migrations under an unpinned `wrangler`.

Switched those call sites to `pnpm exec`, which runs the lockfile-pinned binary
or fails closed (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`). This also matches the
convention already established in this repo's `unit-tests` job, which uses
`pnpm exec vitest` rather than `pnpm run test:unit -- <flags>`.

No behavior change when the dependency tree is correct — all three tools
(`typescript`, `eslint`, `wrangler`) are declared devDependencies.
