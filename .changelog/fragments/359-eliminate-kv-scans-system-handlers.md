---
issue: 359
type: perf
---

# Eliminate O(n) KV scans in system.ts handlers

Replaced three full `kvList()` scans with a single O(1) read from the
`_idx:prefix:all` master index:

- **`list_topics`** (no-prefix path) — was `kvList()`, now `getAllKeys()`
- **`get_lore`** auto-suggest — was `kvList()`, now `getAllKeys()`
- **`validate_topic_exists`** — was `kvList()`, now `getAllKeys()`

The master index is maintained automatically by `updateIndexes()` on every
`set_lore`, `delete_lore`, `batch_set_lore`, `batch_mutate`, and `restore_lore`
call. When the index doesn't exist yet (e.g. test seeds via `seedKV` that bypass
`set_lore`), `getAllKeys()` falls back to `kvList()` transparently.