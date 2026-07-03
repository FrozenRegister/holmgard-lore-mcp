### Added

- `lore_manage`'s `list` action accepts an optional `prefix` param and now consults the maintained `_idx:prefix:<ns>` index instead of always doing a full `kvList()` scan. Index-on-write already generalizes to every key prefix (not just `character`); this just wires a consumer up to it, with automatic scan-and-filter fallback when an index doesn't exist yet. (#18)
