## Global snake_case/camelCase parameter-casing bridge for tools/call (#511)

### Added

- `normalizeParamCasing()` (`src/lib/normalize-param-casing.ts`) — normalizes every top-level `tools/call` argument key at the transport boundary in `src/index.ts`, adding the missing snake_case or camelCase alias for any key that doesn't already have both forms present. Requires no per-tool Zod schema knowledge: an alias a schema doesn't recognize is just an extra key that gets silently stripped, same as unrecognized keys always have been.
- This replaces the incomplete, per-handler `world_id`/`worldId` bridge from #377/#336/#268 (only 5 of ~40 RPG handlers had it) with a single bridge covering every parameter (`world_id`/`worldId`, `entity_key`/`entityKey`, `location_key`/`locationKey`, etc.) across every RPG sub and non-RPG tool.

### Changed

- `docs/parameter-naming-conventions.md` — documents the new global bridge and notes the 5 existing per-handler bridges are now redundant for `tools/call` traffic but were left in place for direct-handler callers (e.g. tests that call a handler function directly, bypassing `POST /mcp`).
