-- Migration 0011: Zone/territory shapes on world_map structures (#276)
-- No new columns needed — structures.metadata (added in 0001_initial.sql) is
-- reused to store optional zone geometry (circle/polygon/ring) as JSON:
--   { "zone": { "type": "circle"|"polygon"|"ring", ... }, "zone_type": "territory", "predator": "..." }
-- This migration only adds a partial index so zone-bearing structure lookups
-- (world_map.query_zone / list_zones) stay fast without a full table scan as
-- structure counts grow — it does not change how any existing row is read.

CREATE INDEX IF NOT EXISTS idx_structures_zone ON structures(world_id) WHERE json_extract(metadata, '$.zone') IS NOT NULL;
