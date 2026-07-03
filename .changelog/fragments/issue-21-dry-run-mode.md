### Added

- `set`, `delete`, `patch`, and `increment` actions on `lore_manage` accept an optional `dry_run: true` — runs all normal validation (existence/ambiguity/type checks) and returns a `would_change` diff (`before`/`after`) without writing to KV. Scope: these four core single-key mutation tools; `batch_set`/`batch_mutate`/`transfer_item`/`map_integration` are not covered by this pass. (#21)
