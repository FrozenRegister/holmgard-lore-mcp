## Smoke test for patch pipeline

- Added `.patches/smoke-test.patch` to validate the `apply-patches.yml` workflow end-to-end
- Workflow correctly applied the patch, deleted the `.patch` file, and committed the result
- Verified path allowlist, `git apply --check`, and size cap enforcement
