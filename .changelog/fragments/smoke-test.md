## Patch Pipeline Smoke Test

- Added cross-references to `docs/patch-pipeline-agent-guide.md` from `ARCHITECTURE.md`, `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, and `docs/ai-automation-pipeline.md`
- Fixed idempotency bug in `apply-patches.yml`: added `hashFiles` guard so the workflow skips when no `.patches/*.patch` exist
