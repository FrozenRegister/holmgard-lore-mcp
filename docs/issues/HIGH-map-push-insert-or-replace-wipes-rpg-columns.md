# HIGH: `/admin/map/push-hexes` and `/admin/map/push-landmarks` silently wiped RPG-owned columns

## Symptom

Any narrator-set `world_id`/`biome` (on `hexes`) or `world_id`/`region_id`/`population`/`zone_type`/`zone_shape`/`predator_ref`/`threat_level`/`dominance_rank` (on `landmarks`) — set via `world_map.ts`'s `patch`/`batch`/`suggest_poi`/`update_poi` actions — would silently disappear the next time the `holmgard-lore-editor` map editor pushed an ordinary sync (moving a label, repainting terrain, anything at all touching the same row).

## Root cause

Both routes used `INSERT OR REPLACE INTO hexes (q, r, map_id, terrain, label, data) ...` / `INSERT OR REPLACE INTO landmarks (id, map_id, q, r, name, category, data) ...`. `INSERT OR REPLACE` deletes the existing row and reinserts a brand-new one with only the listed columns populated — every column *not* in that list (all the RPG-owned ones added by migration `0019`/#319) reverts to its schema default (`NULL` for `world_id`/`biome`/`zone_*`, `0` for `population`) rather than being left alone.

This is exactly the "shared row, split ownership" hazard flagged when Phase 1/2 (#319/#320) were designed — the editor's own push path predates those columns entirely and was never updated to know about them.

## Fix (#321)

Switched both routes from `INSERT OR REPLACE` to `INSERT ... ON CONFLICT DO UPDATE SET <only the columns this route owns>`:

- `push-hexes`: `ON CONFLICT(q, r, map_id) DO UPDATE SET terrain, label, data, updated_at` unconditionally, plus `world_id`/`biome` via `COALESCE(excluded.x, hexes.x)` — the editor's `HexRecord` MAY now optionally carry `worldId`/`biome` (e.g. from #321's biome picker), and when it doesn't, the existing RPG-set value is preserved instead of nulled.
- `push-landmarks`: `ON CONFLICT(id) DO UPDATE SET map_id, q, r, name, category, data, updated_at` — the RPG-owned columns are simply never referenced in either the column list or the `SET` clause, so they're left completely untouched on both insert (schema defaults apply) and update (existing value survives).

## Why this wasn't caught by existing tests

`src/__tests__/admin-map.test.ts`'s push tests only ever asserted the response shape and that the editor-owned columns round-tripped — none of them first set a `world_id`/`biome`/`zone_*` value via `world_map.ts` and then pushed again to check it survived. Regression coverage for exactly this scenario was added alongside this fix.
