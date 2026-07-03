### Added

- `GET /admin/export` — dumps the entire KV namespace (including `_history:`, `_idx:`, `_changelog`, and other system keys `kvList()` normally hides) for disaster recovery backup. `POST /admin/import` restores the same format verbatim. Both gated by `ADMIN_SECRET`. (#19)
