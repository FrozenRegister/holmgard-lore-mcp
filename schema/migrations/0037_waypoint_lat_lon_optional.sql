-- #399: make waypoints.lat/lon nullable — deferred edge case from #341.
-- A purely grid/hex world that never calls waypoint.calibrate has no
-- meaningful geographic origin, so forcing callers to supply placeholder
-- lat/lon values on `register` stores fabricated data that looks real.
-- `q`/`r` stay NOT NULL — hex coordinates are always required regardless of
-- geo-calibration; only lat/lon become conditional (enforced in
-- waypoint-manage.ts's `register` handler based on whether the target
-- world's world_state has geo_origin_lat/lon set, via the existing
-- getGeoOrigin() helper — not re-derived here).
--
-- Table-rebuild pattern (SQLite can't ALTER COLUMN ... DROP NOT NULL), same
-- approach as migration 0027.

CREATE TABLE waypoints_new (
  id         TEXT PRIMARY KEY,
  world_id   TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  q          INTEGER NOT NULL,
  r          INTEGER NOT NULL,
  lat        REAL,
  lon        REAL,
  kind       TEXT NOT NULL DEFAULT 'settlement',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(world_id, name)
);

INSERT INTO waypoints_new (id, world_id, name, q, r, lat, lon, kind, created_at, updated_at)
SELECT id, world_id, name, q, r, lat, lon, kind, created_at, updated_at FROM waypoints;

DROP TABLE waypoints;
ALTER TABLE waypoints_new RENAME TO waypoints;

CREATE INDEX IF NOT EXISTS idx_waypoints_world ON waypoints(world_id);
