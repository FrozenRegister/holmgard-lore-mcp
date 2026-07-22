### Fix

- The `coverage` CI job now actually enforces 100% patch coverage. Previously it only ran `vitest run --coverage` and reported a percentage — nothing failed the job if new/changed lines were uncovered, so PRs could merge before Codecov's async `codecov/patch` check (which `auto-merge.yml` excludes from blocking merge anyway) ever posted a real number. A new `check:patch-coverage` script diffs changed lines against the PR base branch and fails the job if any are untested. See #480.
