### CI Artifacts Phase 2 (#484) — build diff + job durations

Extends the artifact pattern from PR #482 with the two items that survived the scoping/filtering pass in #484 (the rest — `changelog-check.json`, `pr-metadata.json`, `secrets-audit.json` — are already covered by existing checks/tools; `migration-check.json` is deferred pending a concrete spec).

- New `build-diff-{sha}` artifact (from the `build` job, PR-only): `pkg-diff.txt` (diff of `package.json` against the PR's base ref) and `diff-stat.txt` (whole-PR `--stat` summary). Answers "did dependencies change" and "how big is this PR" with zero new dependencies.
- New `job-durations-{sha}` artifact (new `job-durations` job, runs after every other CI job completes): per-job and per-step wall-clock duration, computed from GitHub's own Jobs API (`gh api .../actions/runs/{run_id}/jobs`). Would have caught PR #482's silent no-op-sharding and the full-suite-runs-twice issue (#483) automatically from data GitHub already records, instead of requiring a human to notice the timing felt off.
- `docs/agent-ci-artifacts-guide.md` and `CLAUDE.md` updated: new artifacts documented, plus the P2 "failure-mode spec" item — an explicit "if absent" column added to the artifacts table so an agent never has to guess whether a missing artifact means "job failed" or "not applicable to this run."
