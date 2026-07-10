# Issue: `syncCharacterToKv` Bypasses `_idx:location:*` Index Maintenance — Repo-Wide, Not Co-Habitation-Specific

**Severity:** HIGH
**Reported:** 2026-07-09
**Status:** Open — documented, not fixed. Discovered while implementing #226 Phase 2 (character co-habitation), out of scope for that change.

## Symptom

Any `character_manage` mutation that changes a D1 character's `current_room_id` (e.g. `create`, `update`) never updates the `_idx:location:<location-key>` KV index for that character. Tools that trust the index directly — `get_location_occupants`, `process_stage_batch`, `scene_brief` — can silently miss or retain-stale entries for D1-backed characters whose location has changed.

## Root Cause

`syncCharacterToKv` (`src/rpg/utils/character-sync.ts`) regenerates a character's KV markdown projection after every mutating `character_manage` action and writes it via `env.LORE_DB.put(kvKey, ...)` **directly** — bypassing both the `kvPut()` lib wrapper and `updateIndexes()` (`src/lib/indexes.ts`) entirely.

`updateIndexes()` is the sole mechanism that keeps `_idx:location:*`/`_idx:thread:*`/`_idx:prefix:*` in sync, and it is only ever invoked from the freeform-KV write paths: `set_lore`, `delete_lore`, `patch_lore`, the `batch_set_lore`/`batch_mutate` paths (`src/tools/lore.ts`), `plant_setup`/`pay_off_setup` (`src/tools/meta.ts`), an entity delete path (`src/tools/entity.ts`), and the `/admin/set-lore`/`/admin/delete-lore` REST routes. None of these are on the D1 `character_manage` mutation path.

So a character's KV text can correctly show `**Location:** location:tavern` (the projection itself is accurate) while `_idx:location:tavern` never gains that character's key — the index and the text drift independently.

## Impact

- `get_location_occupants` (`src/lib/indexes.ts` → `resolveIndexedEntities`) trusts the index array as-is when populated; it does not re-verify each returned key's `Location` field. A D1-backed character can be permanently missing from every location query, or (if they later move via a `set_lore`/`patch_lore` call instead) leave a stale entry behind at their old location.
- `check_continuity`'s `occupancy` check is unaffected by this specific gap (it validates each character's `Location` field resolves to a real `location:*` key, not index membership), so this bug produces **no continuity findings** — it's silent.
- Directly relevant to #226 (character co-habitation): if two co-habitating characters are ever migrated to D1-backed rows, moving one via `character_manage` would leave the location index unaware of the change, compounding the location-desync risk #226 already calls out for the KV-only case.

## Reproduction

1. `character_manage({ action: 'create', name: 'Test NPC', currentRoomId: 'location:tavern' })`.
2. Confirm the KV projection for the new character's key contains `**Location:** location:tavern` (via `get_lore`).
3. `lore_manage({ action: 'get_location_occupants', location_key: 'location:tavern' })` (or the equivalent `world_manage` action) — the new character is absent from the result, despite their KV text correctly listing that location.

## Suggested Fix (for a future issue — not this PR)

- Either have `syncCharacterToKv` call `updateIndexes(c, kvKey, newText, oldText)` after its `put`, matching every other KV write path, or
- Make the index-maintenance logic in `updateIndexes()` independently callable/importable so `character-sync.ts` (which has no `Context`/Hono binding, only `AppBindings`) can invoke it without needing the full tool-handler call shape the other sites use.
- Either fix needs a `_idx:location:*` regression test exercising a D1-character location change specifically, since the existing index tests are all written against the freeform-KV write paths.
