# Landing Zone Classification (Slice 1 of #436)

Add computed `landing_zone` field to hex tiles returned by `world_map` `hexes` action, derived from biome and a slope estimate computed from axial neighbor elevations within the same query result.

## Changes

- **`src/rpg/handlers/world-map.ts`**
  - Export `computeLandingZone(biome: string, slope: number): string | null` helper function that classifies hex tiles into landing zones (`clearing`, `road`, `slope`, `water`, `unlandable`, or `null`).
  - Modify `hexes` action to compute and return `landing_zone` field on each hex object.
  - Slope is estimated as the maximum elevation difference to any present axial neighbor in the query result. Neighbors outside the query bounds are treated as equal elevation (slope 0 contribution).
  - Elevation units used directly as proxy for slope degrees (e.g., delta of 2 units ≈ 2° grade).

- **`tests/worker/world-map.test.ts`**
  - Add unit tests covering `computeLandingZone` function: all biome buckets, slope boundaries (2/5/10), and null-fallback cases.
  - Add integration test for `hexes` action confirming landing zones are computed correctly on a small seeded grid with known elevations and neighbor relationships.

## Deferred (intentional scope exclusion for slice 1)

- `landing_zone_override` D1 column for manually-cleared strips
- Weather gates for takeoff/landing
- `travel.takeoff` and `travel.land` action split
- These are tracked under #436 for a follow-up slice.
