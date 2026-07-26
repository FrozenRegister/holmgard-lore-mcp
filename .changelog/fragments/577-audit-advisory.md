### Added

- Advisory (non-blocking) `pnpm audit` job in new `audit.yml` workflow (#577), running on every PR and push to `main`. `pnpm audit` currently reports 38 existing findings (17 in production dependencies, including several in `hono` itself — tracked separately in #576, not fixed by this PR). A hard-fail gate would have broken every PR immediately given that backlog, so this job always exits 0 and surfaces the report in the job's step summary instead — visibility without blocking merges.
