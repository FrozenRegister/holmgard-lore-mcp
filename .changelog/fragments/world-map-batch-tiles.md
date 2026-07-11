### Feature — world_map.batch: bulk tile import (#275)
- Adds a `batch` action to `world_map` for seeding large hand-authored maps in a single call (up to 1000 tiles), instead of chunking manually through `patch`.
- Validates tile biomes against the world's biome registry (#274) by default (`validateBiomes`, default `true`); invalid tiles are reported per-index in `errors` while valid tiles still write. Worlds with no registered biomes remain unrestricted (backward compatible), and `validateBiomes: false` skips validation entirely for trusted bulk loads.
- Writes are chunked into groups of 100 via `db.batch()` (D1's per-batch limit); reports `tilesInserted`/`tilesUpdated` counts and `duration_ms`.
