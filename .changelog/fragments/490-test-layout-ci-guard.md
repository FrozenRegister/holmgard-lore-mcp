### Added a CI guard against test files reappearing outside `tests/` (#490)

- New `scripts/check-test-layout.mjs` (`pnpm run check:test-layout`) fails if any tracked `*.test.ts` file lives outside `tests/{unit,worker,live}/` — the layout established by #488/#489. Without this, a stray colocated test file wouldn't just go uncounted, it would silently never run, since all three Vitest configs now scope their `include` glob to one specific `tests/` subdirectory.
- Runs as its own fast `Test Layout` CI job (no `pnpm install` needed — just `git ls-files`) and as step 1 of the local pre-commit gate (`scripts/pre-commit-validate.sh` / `.ps1`).
- Cleanup: removed `scripts/parse-blocks.mjs` and `scripts/split-tests.mjs`, two orphaned one-off dev utilities that both hardcoded a read from `src/__tests__/worker.test.ts` — a file with no git history in this repo (never actually committed) and, since #489, no possible location it could exist at anyway.
