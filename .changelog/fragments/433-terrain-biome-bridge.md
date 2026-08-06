## Added a terrain->biome vocabulary bridge for hexes with editor-only terrain (#433)

### Added

- `src/lib/resolve-biome.ts` — `resolveBiomeForTerrain(db, worldId, terrain)` and
  `resolveBiomeForHex(db, worldId, q, r)`. Given a hex whose `biome` column is
  NULL but whose editor-owned `terrain` column is set (e.g. `"Woods"`), looks
  up the biome most commonly assigned to other hexes in the same world that
  share that terrain string, and returns it as a fallback. Deterministic:
  picks the most frequent biome for a terrain string, ties broken by biome
  name ascending.

### Changed

- `resolveEncounterCore` (`src/rpg/handlers/encounter-manage.ts`) now resolves
  a hex's biome via `resolveBiomeForHex` instead of reading the `biome`
  column directly, so encounter threat rolls no longer silently treat a hex
  as unclassified (baseThreat 0) just because it was pushed from the editor
  and never had a biome manually assigned.

### Out of scope

- Editor-side auto-suggestion for the #321 biome-assignment panel — tracked
  separately as `holmgard-lore-editor#201`.
- Other biome-reading call sites are unaffected by this change; only the
  encounter threat-roll path was wired to the new bridge in this pass.
