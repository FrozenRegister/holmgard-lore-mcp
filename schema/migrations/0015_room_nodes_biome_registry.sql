-- Migration 0015: Integrate room_nodes with the dynamic biome registry
-- (#290, a #274 follow-up)
--
-- room_nodes.biome_context has a DB-level CHECK constraint restricting it to
-- the original 8 hardcoded biome names, and the table has no world_id column
-- to scope a per-world biome registry lookup against (#274's
-- getBiomeRegistry(db, worldId) needs a worldId to look anything up).
-- SQLite/D1 cannot DROP a CHECK constraint or otherwise alter a column's
-- constraints in place, so this rebuilds the table: create the new shape,
-- copy every existing row across (world_id defaults NULL — there is no
-- structural signal on an existing room_nodes row to infer which world it
-- belongs to; same backfill-avoidance reasoning as migration 0009's
-- characters.world_id — guessing risks silently mis-scoping narrative
-- content), drop the old table, rename the new one into place, recreate
-- every index.
--
-- Existing FK-shaped columns pointing at room_nodes(id) — e.g.
-- characters.current_room_id — are unaffected by the drop+recreate: FK
-- enforcement is not active anywhere in this schema (no migration sets
-- PRAGMA foreign_keys), so there is no FK violation risk here. The inline
-- `network_id TEXT REFERENCES node_networks(id)` on the *original* table
-- (from migration 0001) confirms a straight CREATE TABLE with an inline
-- REFERENCES clause already works under D1/miniflare — the previously-
-- documented rejection was specific to REFERENCES inside an incremental
-- ALTER TABLE ADD COLUMN, not a fresh CREATE TABLE.

CREATE TABLE room_nodes_new (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL CHECK(length(trim(name)) > 0 AND length(name) <= 100),
  base_description TEXT NOT NULL CHECK(length(trim(base_description)) >= 10 AND length(base_description) <= 2000),
  biome_context    TEXT NOT NULL,
  atmospherics     TEXT NOT NULL DEFAULT '[]',
  exits            TEXT NOT NULL DEFAULT '[]',
  entity_ids       TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  visited_count    INTEGER NOT NULL DEFAULT 0,
  last_visited_at  TEXT,
  local_x          INTEGER DEFAULT 0,
  local_y          INTEGER DEFAULT 0,
  network_id       TEXT REFERENCES node_networks(id) ON DELETE SET NULL,
  world_id         TEXT REFERENCES worlds(id) ON DELETE SET NULL
);

INSERT INTO room_nodes_new (
  id, name, base_description, biome_context, atmospherics, exits, entity_ids,
  created_at, updated_at, visited_count, last_visited_at, local_x, local_y, network_id
)
SELECT
  id, name, base_description, biome_context, atmospherics, exits, entity_ids,
  created_at, updated_at, visited_count, last_visited_at, local_x, local_y, network_id
FROM room_nodes;

DROP TABLE room_nodes;
ALTER TABLE room_nodes_new RENAME TO room_nodes;

CREATE INDEX IF NOT EXISTS idx_room_nodes_biome        ON room_nodes(biome_context);
CREATE INDEX IF NOT EXISTS idx_room_nodes_visited      ON room_nodes(last_visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_room_nodes_local_coords ON room_nodes(local_x, local_y);
CREATE INDEX IF NOT EXISTS idx_room_nodes_network      ON room_nodes(network_id);
CREATE INDEX IF NOT EXISTS idx_room_nodes_world        ON room_nodes(world_id);
