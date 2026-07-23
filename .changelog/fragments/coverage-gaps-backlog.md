### Added a pinned, auto-updated Coverage Gaps backlog issue

- New `scripts/report-coverage-gaps.mjs` (`pnpm run report:coverage-gaps`) generates a worst-covered-first markdown report from `coverage-summary.json`.
- The `coverage` CI job now updates a pinned issue — [Coverage Gaps (auto-updated)](https://github.com/FrozenRegister/holmgard-lore-mcp/issues/504) — with this report on every push to `main`. Not a merge gate; a standing, agent-actionable backlog for downtime work, always current since it rides on a trigger the job already has rather than a separate schedule.
- Documented in `CLAUDE.md` and `CONTRIBUTING.md` ("Looking for something to do?").
