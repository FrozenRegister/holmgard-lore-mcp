### Added

- `world_map` gains `distance` and `pathfind` actions. `distance` computes
  hex-axial distance (always available) plus, on a geo-calibrated world,
  precise Euclidean `straightLineKm`, a per-biome `terrainBreakdown`, and
  `estimatedTravelDays` — `null` when any hex on the direct line is
  impassable for `mode` (flagged in `warnings`) rather than silently averaged.
  `pathfind` runs a real A* over hex neighbors (bounded search around
  `from`/`to`), supports `avoid` (biome names or `zone_type` values from the
  existing dynamic registries, not a hardcoded list), and returns the routed
  `path`, `totalKm`/`totalDays`, and zone `warnings`. Both actions reuse
  #429/#431's per-hex effective movement cost (biome cost, overridden by an
  explicit `water_depth` fording rule when set) instead of separate terrain
  math. (#430)
