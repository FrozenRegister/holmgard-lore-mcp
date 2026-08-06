### Fixed

- `apply-patches.yml`: added a job-level `if: hashFiles('.patches/*.patch') != ''` condition. Previously, applying a patch and committing the result back onto the PR branch re-triggered the `pull_request` workflow on the same branch; that second run found no `.patches/*.patch` files left and failed instead of skipping. The job now no-ops cleanly when there's nothing to apply (#562).
