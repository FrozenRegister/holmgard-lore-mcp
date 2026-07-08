### D1-as-Authoritative Character Storage (Issue #154)

- **D1-First Architecture:** D1 (RPG_DB) is now the single source of truth for all character data; KV serves as a generated markdown projection
- **Projection Sync:** Added `formatD1CharToKv()` utility to convert D1 character rows to markdown with D1 migration markers (`## D1-Migrated: true`, `## D1-Character-ID: <id>`)
- **Automatic Sync:** All character mutations in `character_manage` handler now sync D1 records to KV projections (create, update, add_xp, level_up, cast_spell)
- **Smart Redirects:** `handle_get_lore()` detects D1-migrated entries and redirects reads to live D1 data, serving current state instead of stale KV text
- **KV Metadata:** Migrated entries include D1 tracking metadata (`d1_migrated`, `d1_id`, `updatedAt`) for audit and reconciliation
- **Bidirectional Utilities:** Existing `parseKvCharToD1()` (KV→D1) paired with new `formatD1CharToKv()` (D1→KV) for full-cycle migrations
- **Character Sync Module:** New `src/rpg/utils/character-sync.ts` with `syncCharacterToKv()` and `syncAllCharactersToKv()` helpers for incremental and bulk projections
- **Eliminates Dual-Source Drift:** KV projections are always current with D1, preventing conflicts between separate storage layers

Unblocks issue #228 (character state snapshots) and #226 (co-habitation) by establishing D1 as the reliable source for character state.
