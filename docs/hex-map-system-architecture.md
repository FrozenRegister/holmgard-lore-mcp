# Hex Map System Architecture — Coordinates, Storage, and Zoom

**Status:** Reference doc — how the system actually works today, consolidated from both repos.
**Companion doc:** `holmgard-lore-editor/docs/zoom-mechanisms-comparison.md` (client-side zoom mechanisms in detail — this doc summarizes it and adds the backend half + the region-switcher mechanism it doesn't cover).

This exists because the pieces of the hex map system are scattered across two repos, several partially-stale planning docs, and a handful of vendor JS files, and no single doc answers "how do coordinates work end to end" or "how does zoom actually work today." Both questions came up while triaging GitHub issue #391 Cluster 3 (#337, #340, #341), which turned out to be based on a wrong premise (see `docs/issues/cluster-3-hex-coordinate-alignment-plan.md`).

## 1. Coordinate system: axial `(q, r)`, everywhere

Every map-shaped table and every map-shaped client data structure in this project uses **axial hex coordinates**, field names `q`/`r`, pointy-top orientation. There is no cube (`s`) coordinate, no offset-row coordinate, in any app-owned code.

- **Distance formula** (identical in both repos): `(|dq| + |dr| + |dq + dr|) / 2`
  - Backend: none needed server-side today (pathfinding is client-only), but the formula matches `mapTools.ts`.
  - Client: `holmgard-lore-editor/src/lib/mapTools.ts:36-40`, and duplicated in `mapDb.ts:188,210,239`.
- **Six neighbor directions** (pointy-top axial), `mapTools.ts:43-50`:

  ```
  [{1,0}, {1,-1}, {0,-1}, {-1,0}, {-1,1}, {0,1}]
  ```

- **Hex↔pixel** (for SVG rendering) lives server-side in `src/rpg/handlers/world-map.ts` (`hexToPixel`, `hexCorners`, ~lines 239-252) and matches the standard Red Blob Games pointy-top formulas.
- **Hex↔lat/lon** (for real-world-anchored campaigns, e.g. Gotland) lives server-side in `src/rpg/utils/geo-transform.ts` (`hexToLatLon`/`latLonToHex`), calibrated per-world via `world_state.geo_origin_lat/lon` + `geo_km_per_hex`. The client has an independent, simpler version for Earth-derived maps in `hexmap-utils.ts:143-164` (`axialToLatLon`/`latLonToAxial`) — these are **not the same formula** and are not meant to interoperate; the server one is precise per-world calibration for gameplay (waypoints, party marches), the client one is a fixed-scale approximation for rendering pre-generated Earth data.

### `x`/`y` naming that secretly (or actually) meant `q`/`r` — fixed 2026-07-15

Three places in the live hex-world model used `x`/`y` naming or storage despite operating entirely within the axial hex system. All three are now fixed (migrations 0029-0031, plus code renames):

1. **`encounter-manage.ts`'s `resolveEncounterCore`, and its `resolve`/`check` actions** — the function signature and every caller (`travel-manage.ts`) used to name these parameters `x`/`y` while binding them directly to the `hexes` table's `q`/`r` columns. This was a naming artifact, not a second coordinate system, but it was exactly the kind of thing that risks a future caller passing genuinely cartesian values by mistake. Renamed `x`/`y` → `q`/`r` throughout `EncounterResolveInput`/`EncounterResolveResult`, the MCP schema, and both call sites in `travel-manage.ts` (the `travel` action's optional `resolveEncounter` integration, and `move_hex`'s encounter check).
2. **`corpses.position_x`/`position_y`** — a genuinely used pair (written by `create`/`register`, read by `scavenge_check`'s exact-position match), but cartesian while every other world-position column (`characters`/`parties.current_hex_q/r`) is axial hex. Renamed to `position_q`/`position_r` (migration 0029); `corpse-manage.ts`'s `positionX`/`positionY` params became `positionQ`/`positionR`.
3. **`crate_drops.x`/`y`** — the deeper bug of the three. `resource-manage.ts`'s `crate_drop` action generated positions via `Math.random() * worlds.width/height` with a Euclidean `Math.hypot` distance check for `avoidPositions` — a fully rectangular-cartesian placement model with no relationship to the actual axial hex world. A crate's `x`/`y` never corresponded to any real hex on the map (there is no width/height-to-axial-hex mapping established anywhere in this codebase). Renamed the table to `q`/`r` (migration 0031) and rewrote placement to pick from real rows in `hexes` for that `world_id`, using a proper axial hex-distance formula for the avoidance check, falling back to the map origin `(0,0)` only when the world has no hexes yet.

### Where a *real*, intentionally separate Cartesian grid does exist

`combat_map` (`src/rpg/handlers/combat-map.ts`) is a **square tactical grid** for turn-based combat encounters — `x`/`y` integer coordinates stored as JSON keys inside `battlefield.grid_data` (no typed D1 columns at all). This is by design: D&D-style tactical combat grids are conventionally square, not hex, and nothing in the codebase or docs suggests unifying it with the hex world map. Treat `combat_map` as out of scope for any hex-coordinate migration.

`parties.position_x`/`position_y` (INTEGER, added in migration `0001_initial.sql`) were **dead** cartesian columns — confirmed zero code references. Migration `0021_gotland_waypoints_and_party_march.sql`'s header comment (lines 38-40) flagged this and deferred dropping them as "a separate, out-of-scope cleanup decision." **That cleanup is now done** — migration `0030_drop_party_cartesian_position.sql` drops both columns. `parties.current_hex_q`/`current_hex_r` (migration 0021) remains the live hex-position column pair, written by `party-manage.ts` on `begin_march`/arrival and by `travel-manage.ts`'s `move_hex`.

## 2. Backend D1 schema (source of truth for hex world data)

All defined in `schema/migrations/0019_map_tables_world_scoping.sql` (hexes/landmarks base + RPG columns), `0020_zone_types.sql`, `0021_gotland_waypoints_and_party_march.sql`.

```sql
CREATE TABLE hexes (
  q, r,                              -- axial coordinate (PK component)
  map_id TEXT DEFAULT 'main',        -- PK component; which map/world-map this hex belongs to
  terrain, label, data,              -- editor-owned (freeform, pushed from holmgard-lore-editor)
  biome, elevation, moisture, temperature,  -- RPG-owned (narrator-set via world_map.patch/batch)
  world_id REFERENCES worlds(id),
  updated_at,
  PRIMARY KEY (q, r, map_id)
);

CREATE TABLE landmarks (
  id TEXT PRIMARY KEY,
  map_id, q, r, name, category, data,       -- editor-owned
  world_id, region_id, population,
  zone_type, zone_shape,                     -- JSON, e.g. {type:'circle'|'polygon'|'ring', ...radius/points in q/r units}
  predator_ref, threat_level, dominance_rank,-- RPG-owned
  updated_at
);

CREATE TABLE waypoints (
  id, world_id, name,
  q, r,                              -- axial position, NOT NULL (required — see below)
  lat, lon,                          -- real-world-anchored position, nullable since
                                      -- migration 0037 (#399) — required only when the
                                      -- target world is geo-calibrated (see below)
  kind, created_at, updated_at
);

-- parties (relevant columns only)
current_waypoint_id, travel_target_waypoint_id, travel_remaining_km,
travel_pace_km_per_day, travel_status,
current_hex_q INTEGER, current_hex_r INTEGER   -- live hex position
-- position_x, position_y dropped in migration 0030 (were DEAD, migration 0001, unreferenced)

-- corpses / crate_drops (relevant columns only) — renamed from x/y to q/r
-- in migrations 0029/0031; see "x/y naming that secretly (or actually)
-- meant q/r" above.
corpses.position_q INTEGER, corpses.position_r INTEGER
crate_drops.q INTEGER NOT NULL, crate_drops.r INTEGER NOT NULL
```

`hexes`/`landmarks` is a **single-table, column-level split of ownership**, not a KV/D1-style split — the editor's push endpoints (`/admin/map/push-hexes`, `/admin/map/push-landmarks`) and the RPG engine's write paths (`world_map.patch`/`batch`/`suggest_poi`/`update_poi`) both write to the same rows but touch disjoint column sets. This was the root cause of a real bug (`docs/issues/HIGH-map-push-insert-or-replace-wipes-rpg-columns.md`, #321): the editor's `INSERT OR REPLACE` push used to null out the RPG-owned columns on every ordinary editor sync. Fixed via `ON CONFLICT DO UPDATE` that only touches the columns each route owns — a pattern any future map-table write path must follow.

**`waypoint.register` requires `q`/`r`; `lat`/`lon` are conditionally required** (`waypoint-manage.ts:100-111`) — `q`/`r` are always mandatory, but `lat`/`lon` are only enforced when the target world has already been geo-calibrated (`waypoint.calibrate` has set `world_state.geo_origin_lat/lon`); an uncalibrated grid/hex world can register a waypoint with `q`/`r` alone. This changed after Cluster 3: migration `0037_waypoint_lat_lon_optional.sql` (#399) made `waypoints.lat`/`lon` nullable specifically because forcing placeholder lat/lon on a non-geo-calibrated world would store fabricated data. See the companion plan doc for the original Cluster 3 context.

## 3. Backend↔frontend sync path

- **Reads**: MCP `rpg({sub:'world_map', action:'hexes'|'overview'|'region'|'find_poi'|...})` for agent/narrator use. A planned (not yet implemented) bare-method read surface `get_map_hexes`/`get_map_landmarks`/`get_map_meta` on `POST /mcp` is documented in `docs/d1-readback-api-design.md` for the editor's bulk sync — **note this doc's own "Current D1 Schema" section is stale**, written before migration 0019 added `world_id`/`biome`/`elevation`/`zone_*`/etc.; treat the schema in §2 above as current.
- **Writes**: editor pushes via `POST /admin/map/push-hexes` / `push-landmarks` (`ADMIN_SECRET`-gated REST, per the repo's read/write API-surface convention). Editor-side: `holmgard-lore-editor/src/lib/mapSync.ts` `pushMapToWorker()`/`pullMapFromWorker()`, batched 500 rows at a time.
- **Client local store**: `holmgard-lore-editor/src/lib/mapDb.ts` — IndexedDB, flat `HexRecord {mapId,q,r,terrain,name,description,worldId?,biome?}` / `LandmarkRecord {mapId,id,q,r,name,type,notes,attributes(json-string),linkedMapId,visible,linkedLoreKey}`. **This local store is single-resolution** — no zoom/detail field exists in it at all (see §4).

## 4. Zoom levels — what's live vs. dormant

There are **four** distinct "zoom" mechanisms in this codebase (the editor's own `docs/zoom-mechanisms-comparison.md` covers the first three in more depth; this section adds the fourth and the backend angle).

### A. Viewport scale zoom — **the only one actually running today**

Pure rendering zoom. `static/hexmap/game-ui-bindings.js:41-79` multiplies `state.hexMap.viewport.scale` (clamped 0.02–500, ×1.3 per step) and re-renders. Same underlying hex data at every zoom level — this is a CSS/canvas transform, not a resolution change. No backend involvement at all.

### B. DetailHex — a built-in, ~95%-ready, currently-dormant two-level LOD system

Lives inside the vendor `game.js` (gitignored/external) plus the editor's own `src/lib/terrain-aggregation.ts` (math) and `static/hexmap/parent-child-terrain-sync.js` (live rollup watcher, polls `detailHexes` every 500ms and rolls terrain up to the parent hex).

- `HexMap.detailGridDensity` ∈ `{7, 19, 37}` → `edgeFactor` ∈ `{2, 3, 4}` (cells per parent cluster).
- A detail hex's coordinate is **in the same axial space as its parent, just scaled**: `detailQ = parentQ * edgeFactor + offset`, ownership resolved by `parentQ = floor(detailQ / edgeFactor)`. Not a separate coordinate system or an extra field — just bigger `q`/`r` numbers in the same `HexMap.detailHexes` array.
- **Currently unpopulated in all generated maps**: every generator output has `detailGridEnabled: false`, `detailHexes: []` (verified empirically against `src/lib/data/earth-996-world.json`, 41,676 hexes, empty detail layer).
- **`detailHexes` never reaches the backend at all** — `mapIngest.ts` (`ingestMap()`) only reads `data.hexes` when flattening into IndexedDB; the detail layer is silently dropped before it would ever be pushed to D1. The D1 `hexes` table has no concept of a detail/parent distinction — it is single-resolution by design today.
- Two levels only — no recursion (can't zoom settlement → building).
- The editor's `docs/zoom-mechanisms-comparison.md` recommends this as the path forward *if* multi-resolution zoom is ever built out, over the alternative below.

### C. Continent/Region hierarchical WorldMap — dead code

`holmgard-lore-editor/src/lib/worldmap.ts` — a completely separate `WorldMap`/`Tile` type with unlimited-depth parent/child linking (`aggregateChildToParent()` rolls majority terrain up). File's own header says "NOT imported by any production code." No backend counterpart exists. Explicitly not recommended by the editor's own comparison doc. Ignore for planning purposes unless someone deliberately revives it.

### D. Region-switcher — the mechanism that's *actually* producing "zoom into a different area" behavior for Earth-derived maps, and isn't in either existing zoom doc

`static/hexmap/region-switcher.js` (`RegionSwitcher` class) loads a manifest (`earth-996-regions.json`) listing named regions, each backed by an **entirely separate map JSON file** (e.g. `earth-996-karelia.json`) with its own independent hex grid and its own `qc`/`rc` axial origin offset. Picking a region in the UI swaps `window.state.hexMap` wholesale via `loadMapDataIntoState()`.

This is not a LOD/aggregation system like B or C — there's no shared coordinate space and no rollup between a "world" file and a "region" file. It's closer to loading a different document. Each region file independently syncs to the backend as its own `mapId` (per `mapSync.ts`'s `mapId`-scoped push/pull and D1's `hexes.map_id`/`landmarks.map_id` columns). Worth knowing about because it's the one mechanism here that's both **live in production** and **crosses the backend boundary** (unlike B and C).

### Summary table

| Mechanism | Live today? | Crosses to backend? | Depth | Where |
|---|---|---|---|---|
| A. Viewport scale | ✅ Yes | No (pure client render) | n/a | `game-ui-bindings.js` |
| B. DetailHex (parent/detail cluster) | ❌ Dormant (data never generated, dropped on ingest) | No (dropped in `mapIngest.ts`) | 2 levels | `game.js` (vendor), `terrain-aggregation.ts`, `parent-child-terrain-sync.js` |
| C. Continent/Region `WorldMap` | ❌ Dead code | No (never wired in) | Unlimited (in theory) | `worldmap.ts` |
| D. Region-switcher (manifest of sibling map files) | ✅ Yes | Yes — each region is its own `mapId` in D1 | 1 (flat list of independent maps) | `region-switcher.js`, `earth-996-regions.json` |

**Bottom line for anyone planning backend work against "zoom levels":** the D1 schema (`hexes`, `landmarks`) has no zoom/LOD/resolution column and needs none for what's live today — mechanism A doesn't touch data, and mechanism D just means "more than one `map_id` can exist for the same world region set, each independently synced." If DetailHex (B) is ever activated, the `hexes` table's `(q, r, map_id)` primary key already has enough room to hold detail-layer rows (larger `q`/`r` in the same `map_id`) without a schema change — but `mapIngest.ts` would need to stop dropping `detailHexes`, and the D1 read/push paths would need a way to distinguish parent-layer from detail-layer rows (today there isn't one — a detail hex and an unrelated hex with the same numeric `q`/`r` in the same `map_id` are indistinguishable).

## 5. Known documentation drift (flagged, not yet fixed)

- ~~`src/index.ts`'s `SUB_SCHEMAS` doc comment for `world_map` advertises stale actions...~~ **Fixed.** The `world_map` entry in `SUB_SCHEMAS` (`src/index.ts:156`) now lists `overview, region, hexes, patch, batch, preview, find_poi, suggest_poi, update_poi, query_zone, list_zones, render_svg, distance, pathfind` with `q, r` params, matching `world-map.ts`'s real `ACTIONS` array (which has since grown `distance`/`pathfind` via #430) exactly. Left here as a resolved record rather than deleted, per this doc's own stated purpose of not letting drift get rediscovered from scratch.
- `docs/d1-readback-api-design.md`'s "Current D1 Schema" section predates migration 0019 and is missing `world_id`/`biome`/`elevation`/`moisture`/`temperature`/`zone_*`/`region_id`/`population`.
- `CLAUDE.md`'s "editor-maintained (tracked) files" list under Hex Map Editor is stale on the *editor repo* side: `parent-child-terrain-sync.js`, `region-switcher.js`, `mcp-auth.js`, `mcp-storage.js`, `river-edges.js` are tracked/editor-maintained, not external/gitignored as its comment implies.

These are called out here so they don't get rediscovered from scratch again; fixing them is small, low-risk cleanup and not blocking on anything in this doc.
