-- Migration 0010: Dynamic Biome Registry (#274)
-- Replaces the hardcoded biome glyph map in world_map.preview and the implicit
-- "any string is a valid biome" behavior of world_map.patch with a per-world
-- D1-backed registry, so a new world's narrative can register whatever biomes
-- it needs (e.g. Gotland's limestone_karst, bog, sea_cliff) without a source
-- change + redeploy.
--
-- No inline REFERENCES-less design needed here since this is a brand-new
-- table (not an incremental ALTER TABLE ADD COLUMN) — the self-referential-FK
-- restriction discovered while landing migrations 0008/0009 only applies to
-- ALTER TABLE, not CREATE TABLE, so the FK constraint below is safe.
--
-- Deliberately NOT touched in this migration: spatial_manage's room_nodes
-- table has biome_context TEXT NOT NULL CHECK(biome_context IN (...8 values))
-- — a DB-level CHECK constraint, not just a Zod enum — and room_nodes has no
-- world_id column at all, so there's no clean way to scope biome validation
-- to a specific world's registry there yet. Removing a CHECK constraint in
-- SQLite requires a full table rebuild (create new table, copy data, drop
-- old, rename), which is a separate, higher-risk migration deserving its own
-- issue and its own careful review — not bundled into this one.

CREATE TABLE IF NOT EXISTS biomes (
  id            TEXT PRIMARY KEY,
  world_id      TEXT NOT NULL,
  name          TEXT NOT NULL,
  glyph         TEXT NOT NULL DEFAULT '?',
  category      TEXT NOT NULL DEFAULT 'terrain',
  color_hex     TEXT NOT NULL DEFAULT '#888888',
  movement_cost REAL NOT NULL DEFAULT 1.0,
  description   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE,
  UNIQUE(world_id, name)
);

CREATE INDEX IF NOT EXISTS idx_biomes_world ON biomes(world_id);
