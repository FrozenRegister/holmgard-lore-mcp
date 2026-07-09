### World scoping for cross-world KV filtering (#259)
- Adds optional `world` parameter to `lore_manage.list`, `lore_manage.search`, and `continuity_manage.check_continuity`
- Filters entries by their `**World:**` markdown field (freeform narrative label, distinct from D1's `world_id` FK) via new `matchesWorld()` helper in `src/lib/lore.ts`
- `check_continuity`'s world filter narrows which entries are scanned/reported without shrinking the existence set used for dangling-reference checks
- Fully backward compatible: omitting `world` returns all worlds, exactly as before
