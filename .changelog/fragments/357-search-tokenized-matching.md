## Added

- `lore_manage.search` now supports `match_mode` parameter: `"any"` (default, tokenized-OR), `"all"` (AND — all tokens must be present), `"exact"` (full contiguous substring, backward compatible)
- `lore_manage.search` now supports `prefix` parameter to scope searches to a key prefix (e.g. `"character"`, `"location"`)
- Search results are now ranked by relevance: entries matching more query tokens rank higher

## Changed

- `lore_manage.search` default behavior changed from contiguous substring matching to tokenized-OR matching. Single-word queries are unaffected. Multi-word queries now match if any token is found instead of requiring the full contiguous string. Use `match_mode: "exact"` for the old behavior.
- Search metadata now includes `match_mode` and `prefix` fields
