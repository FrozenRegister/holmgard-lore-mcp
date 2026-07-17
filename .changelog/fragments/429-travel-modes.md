### Added

- `rpg{sub:"travel"}`'s `move_hex` action accepts an optional transport `mode`
  (`foot`/`horse`/`carriage`/`car`/`aircraft`, default `foot`) and now enforces
  terrain passability against the destination hex's biome — previously it moved
  the party unconditionally regardless of terrain. `biome.register`/`biome.update`
  gain an optional `modeCosts` field for per-mode movement cost overrides on the
  existing per-world biome registry (same cost semantics as `movementCost`:
  higher = slower, `0` = impassable), falling back to `movementCost` when a mode
  has no override so existing biomes/worlds are unaffected by default. `move_hex`
  returns `effectiveSpeedKmPerDay` and rejects impassable moves with an error
  instead of moving the party. (#429)

### Fixed

- Corrected the `rpg{sub:"travel"}` and `rpg{sub:"biome"}` tool schemas in
  `load_tool_schema`/`search_tools`, which advertised stale action names and a
  `speed` enum that was never implemented on the `travel` handler, and a
  `terrainType` field never implemented on the `biome` handler.
