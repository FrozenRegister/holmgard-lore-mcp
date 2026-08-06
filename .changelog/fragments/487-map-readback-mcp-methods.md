## Added MCP-discoverable map reads: get_map_hexes / get_map_landmarks / get_map_meta (#487)

### Added

- `src/lib/map-readback.ts` — shared `rowToHex`/`rowToLandmark` conversion and
  `fetchMapHexes`/`fetchMapLandmarks`/`fetchMapMeta` D1 query helpers, keyed
  by `mapId`. Extracted from `/internal/map-readback` so both callers share
  one implementation.
- `world_map` (via `rpg{sub:"world_map"}`) gained three new actions:
  `get_map_hexes`, `get_map_landmarks`, `get_map_meta` — full-map bulk reads
  by `mapId`, matching `/internal/map-readback`'s query/row shape but with no
  `ADMIN_SECRET` requirement, per this repo's "reads via MCP" convention
  (`CLAUDE.md` API surface convention section).
- `get_map_hexes`, `get_map_landmarks`, `get_map_meta` bare JSON-RPC methods
  on `/mcp` (`src/index.ts`), mirroring how `get_world_biomes` wraps an
  existing action's content-block response into clean structured `result`
  JSON for bulk-sync callers.

### Changed

- `src/internal/routes.ts`'s `/map-readback` route now imports
  `rowToHex`/`rowToLandmark` from `src/lib/map-readback.ts` instead of
  defining its own copies — behavior unchanged, still gated by
  `ADMIN_SECRET` as the editor's own authenticated bulk-sync path.
- `docs/d1-readback-api-design.md` updated from "SUPERSEDED — never built"
  to "IMPLEMENTED", with the registration checklist and success criteria
  corrected to describe what actually shipped (actions on an existing
  `world_map` handler + bare-method wrapper, not a new standalone module or
  new top-level `tools/list` entries).

### Out of scope

- No new top-level MCP tool was added — `get_map_hexes` etc. are actions of
  the already-registered `world_map` sub of the `rpg` tool, same as
  `hexes`/`patch`/`overview`. `CLAUDE.md`'s 10-tool count is unaffected.
- The two hardening suggestions from #487's red-team review (a separately
  scoped `MAP_READ_API_KEY` distinct from `ADMIN_SECRET`) are not addressed
  here — `/internal/map-readback` still uses `ADMIN_SECRET` unchanged, and
  the new MCP methods use the same `MCP_API_KEY` check every other `/mcp`
  method already uses, not a new scoped key.
