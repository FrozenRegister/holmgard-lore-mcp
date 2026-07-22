### Feature

- CI now produces small, structured artifacts alongside the human-readable job logs, so an agent fixing a PR can read a specific answer (which lines are uncovered, which lint rule fired where, which test failed and why) instead of re-running the suite or scraping a noisy log. New artifacts: `coverage/patch-coverage-report.json` (structured patch-coverage result, `coverage-report` artifact), `eslint-report.json` (`lint-report-{sha}`), `tsc-diagnostics.txt` (`typecheck-report-{sha}`), and per-job structured test results (`test-results-unit-{sha}`, `test-results-shard-{1..4}-{sha}`). See #479.

### Fix

- Discovered while wiring up the above: `.github/workflows/ci.yml`'s sharded `test` job was invoking `pnpm test -- --shard=N/4`, but pnpm's `--` forwarding inserts an extra literal `--` that vitest treats as a positional filter, not a flag — every "shard" was silently running the full suite instead of its 1/4 slice. Fixed by invoking vitest directly (`pnpm exec vitest run --shard=N/4 ...`); verified locally that a shard now runs a real ~1/4 subset in ~2 min instead of the full ~7 min suite.
