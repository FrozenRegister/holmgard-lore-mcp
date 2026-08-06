## Post a single upserted PR comment when all ci.yml jobs are green (#657)

### Added
- New `notify-all-green` job in `.github/workflows/ci.yml`: fires once per commit (not once per shard) when every job in `ci.yml` — including all 4 matrix shards of `test` — has succeeded, and upserts a single marker-tagged comment on the PR summarizing the all-green status, rather than posting a new comment on every run.

### Known limitation
- `pr-quality.yml` (Issue Link, Naming Conventions, Changelog Fragment, Documentation checks) is a separate workflow and is not reflected in this job's `success()` — a PR could see this "all green" comment while `pr-quality.yml` still has an outstanding check. Accepted as low-risk since those checks fail loud and fast rather than silently.
