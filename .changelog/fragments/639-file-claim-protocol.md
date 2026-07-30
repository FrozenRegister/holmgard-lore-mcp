## Documented a file-claim protocol for parallel agent work (#639)

### Added

- `docs/file-claim-protocol.md` — a GitHub-native (comment + draft-PR based) convention for agents to
  claim the files they're about to edit and check for overlapping claims before starting new work,
  since GitHub has no native file-checkout/lock feature for source files.

### Changed

- `CLAUDE.md` gains a short pointer section referencing the new protocol, alongside the existing
  patch-pipeline and issue-resolution protocol references.
