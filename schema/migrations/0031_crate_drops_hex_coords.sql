-- Rename crate_drops.x/y to q/r. crate_drop's placement was generating
-- positions as Math.random() * worlds.width/height with Euclidean distance
-- (Math.hypot) for the avoidPositions check — a fully cartesian model with
-- no relationship to the actual axial hex world (hexes.q/r). A crate's x/y
-- never corresponded to any real hex on the map. See #391.
-- Using table-rebuild pattern (SQLite/D1 does not support column rename
-- inline with other structural changes in this repo's established style).

CREATE TABLE crate_drops_new (
  id          TEXT PRIMARY KEY,
  world_id    TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  day         INTEGER NOT NULL,
  q           INTEGER NOT NULL,
  r           INTEGER NOT NULL,
  contents    TEXT NOT NULL,
  claimed     INTEGER NOT NULL DEFAULT 0,
  claimed_by  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

INSERT INTO crate_drops_new (id, world_id, day, q, r, contents, claimed, claimed_by, created_at, updated_at)
SELECT id, world_id, day, x, y, contents, claimed, claimed_by, created_at, updated_at
FROM crate_drops;

DROP TABLE crate_drops;
ALTER TABLE crate_drops_new RENAME TO crate_drops;

CREATE INDEX IF NOT EXISTS idx_crate_drops_world_day ON crate_drops(world_id, day);
