### Added

- `.patches/` diff-based patch pipeline (#554): remote agents open a PR containing a small `.patches/*.patch` unified diff; `.github/workflows/apply-patches.yml` validates it (200KB size cap, `git apply --check`, and a path allowlist/deny-list checked against the patch's real target paths) and auto-commits the applied result back onto the PR branch. Phase 1 allowlist is `docs/**`, `.changelog/fragments/**`, `README.md`, `CONTRIBUTING.md`, `TODO.md`; `.github/**`, `CLAUDE.md`, `ISSUE_RESOLUTION_PROTOCOL.md`, `PROTOCOL_INVOCATION.md`, `ARCHITECTURE.md`, `SECURITY.md`, and `CHANGELOG.md` are explicitly excluded.
- `CODEOWNERS` now requires review on the previously-unowned allowlisted paths, since they're now an automated-write surface.
