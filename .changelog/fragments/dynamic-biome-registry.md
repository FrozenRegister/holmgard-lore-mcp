### Feature — Dynamic biome registry (#274)
- Adds a D1-backed `biomes` table and a new `biome_manage` sub-tool (`rpg` tool, `sub: "biome"`) with actions `register`, `list`, `get`, `update`, `delete`, `validate`, `seed_defaults`, so a world's narrative can register whatever biomes it needs (e.g. `limestone_karst`, `bog`, `sea_cliff`) without a source change + redeploy.
- `world_map.preview` now renders glyphs from the per-world biome registry instead of a hardcoded 9-entry map, falling back to the legacy glyphs for worlds with no registered biomes.
- `world_map.patch` validates tile biomes against the registry once a world has at least one registered biome; worlds with zero registered biomes remain unrestricted (backward compatible).
- `world_manage.create` and `world_manage.generate` now auto-seed the 15 default biomes (union of the old `world_map` glyph map and `spatial_manage`'s biome enum) for every newly-created world.
- Deliberately out of scope: `spatial_manage`/`room_nodes` integration — `room_nodes.biome_context` has a DB-level `CHECK` constraint and no `world_id` column, so scoping validation there requires a separate, higher-risk table-rebuild migration.
