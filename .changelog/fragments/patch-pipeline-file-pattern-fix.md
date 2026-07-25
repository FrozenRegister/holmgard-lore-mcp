### Fixed

- `apply-patches.yml`: added `.patches/*.patch` to the `git-auto-commit-action` `file_pattern` so a patch file's deletion (`rm "$patch_file"` after applying) actually gets committed back to the PR branch. Previously the deletion happened in the runner's working tree but was never staged, so the `.patch` artifact silently persisted in the PR branch's history instead of being ephemeral as designed (#554).
- `apply-patches.yml`: added `shopt -s nullglob` so the apply loop is a true no-op when no `.patches/*.patch` files are present, instead of one wasted iteration over the unexpanded glob pattern.

### Documentation

- Corrected "when to use the patch pipeline" guidance in `ARCHITECTURE.md`, `CONTRIBUTING.md`, and `docs/patch-pipeline-agent-guide.md`, which incorrectly cited lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) as example use cases — none of those paths are in the Phase 1 allowlist (`docs/**`, `.changelog/fragments/**`, `README.md`, `CONTRIBUTING.md`, `TODO.md`) and a patch targeting them is rejected by the workflow's path check.
- Added cross-references to `docs/patch-pipeline-agent-guide.md` from `ARCHITECTURE.md`, `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, and `docs/ai-automation-pipeline.md`.
