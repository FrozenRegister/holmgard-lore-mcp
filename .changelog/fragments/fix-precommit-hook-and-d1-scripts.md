### Fixed

- `core.hooksPath scripts` had no actual `scripts/pre-commit` file, so the documented local pre-commit gate was a silent no-op — added the missing hook, wired to the existing `pre-commit-validate` script.
- The pre-commit validate scripts (`.sh`/`.ps1`) checked for a stale `CHANGELOG.md` requirement; corrected to match the real `check-changelog` CI gate, which requires a fragment under `.changelog/fragments/`.

### Added

- `db:setup` / `db:reset` / `db:status` scripts for bootstrapping the local D1 database (`holmgard-rpg`), generating the migration list from `schema/migrations/*.sql` at runtime instead of a hardcoded (and stale) filename list.

### Documentation

- `docs/testing-and-linting-guide.md` now documents the pre-commit hook and the local D1 setup scripts.
