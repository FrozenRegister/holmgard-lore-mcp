-- Migration 0020: Dynamic per-world zone-type registry (#320 follow-up)
--
-- world_map.ts's preview action previously rendered zone overlays (perimeter/
-- exclusion/hazard/territory) using a hardcoded 4-entry TS map (ZONE_GLYPHS)
-- with no way for a narrator to register a new zone type or customize its
-- glyph without a source change + redeploy. This mirrors the exact pattern
-- already established for biomes (migration 0010/#274): a per-world registry
-- table, seeded with sensible defaults on world creation, with narrator-
-- extensible entries beyond the defaults.
--
-- glyph is nullable: a zone type with no glyph renders no overlay in
-- preview at all (deliberately informational-only) — matching how
-- 'broadcast' zones were excluded from the old hardcoded ZONE_GLYPHS map.

CREATE TABLE IF NOT EXISTS zone_types (
  id         TEXT PRIMARY KEY,
  world_id   TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  glyph      TEXT,
  color_hex  TEXT,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(world_id, name)
);

CREATE INDEX IF NOT EXISTS idx_zone_types_world ON zone_types(world_id);
