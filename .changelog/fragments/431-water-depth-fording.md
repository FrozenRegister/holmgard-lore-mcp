### Added

- `hexes` gains a nullable `water_depth` column (meters), settable per-hex via
  `world_map.patch`/`batch`'s `waterDepth` field. When set, it overrides the
  biome-based movement cost (#429) for that hex on `move_hex`: `≤1.2m` is
  fordable by `foot`/`horse` at half speed (`swimRisk: true` in the response
  once past `0.6m`), `>1.2m`, or any depth at all for `carriage`/`car`, is
  impassable. `aircraft` always ignores `water_depth`. `null` (the default)
  defers entirely to the hex's biome cost, so existing hexes/worlds are
  unaffected until a narrator opts in. Layered alongside #429's per-mode
  biome cost overrides, not a replacement — a hex can carry both a coarse
  always-on `river`-style biome and a fine-grained opt-in `water_depth`.
  (#431)
