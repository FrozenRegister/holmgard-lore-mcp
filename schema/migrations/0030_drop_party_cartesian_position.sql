-- Drop parties.position_x/position_y. These predate the hex-grid world map
-- and are fully unused in application code (grep confirms zero references
-- in src/) — dead cartesian columns sitting alongside the real position
-- fields, current_hex_q/current_hex_r, added later for #337/#340. Left in
-- place they're a landmine: a future caller reaching for "position" on a
-- party could easily write to the wrong (cartesian, ignored) pair instead
-- of the axial hex columns that travel-manage.ts's move_hex actually reads.
-- Using table-rebuild pattern (SQLite/D1 does not support DROP COLUMN
-- inline with other structural changes in this repo's established style).

CREATE TABLE parties_new (
  id                         TEXT PRIMARY KEY,
  name                       TEXT NOT NULL,
  description                TEXT,
  world_id                   TEXT REFERENCES worlds(id) ON DELETE SET NULL,
  status                     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dormant', 'archived', 'broken')),
  current_location           TEXT,
  current_quest_id           TEXT REFERENCES quests(id) ON DELETE SET NULL,
  formation                  TEXT NOT NULL DEFAULT 'standard',
  current_poi                TEXT,
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL,
  last_played_at             TEXT,
  morale                     INTEGER NOT NULL DEFAULT 62,
  cohesion                   TEXT NOT NULL DEFAULT 'stable',
  cohesion_score             INTEGER NOT NULL DEFAULT 50,
  watch_order                TEXT NOT NULL DEFAULT '[]',
  current_watch               TEXT,
  current_waypoint_id        TEXT,
  travel_target_waypoint_id  TEXT,
  travel_remaining_km        REAL,
  travel_pace_km_per_day     REAL NOT NULL DEFAULT 24,
  travel_status               TEXT NOT NULL DEFAULT 'stationary' CHECK (travel_status IN ('stationary', 'marching', 'blocked', 'arrived')),
  current_hex_q              INTEGER,
  current_hex_r              INTEGER
);

INSERT INTO parties_new
  (id, name, description, world_id, status, current_location, current_quest_id, formation,
   current_poi, created_at, updated_at, last_played_at,
   morale, cohesion, cohesion_score, watch_order, current_watch,
   current_waypoint_id, travel_target_waypoint_id, travel_remaining_km, travel_pace_km_per_day,
   travel_status, current_hex_q, current_hex_r)
SELECT
  id, name, description, world_id, status, current_location, current_quest_id, formation,
  current_poi, created_at, updated_at, last_played_at,
  morale, cohesion, cohesion_score, watch_order, current_watch,
  current_waypoint_id, travel_target_waypoint_id, travel_remaining_km, travel_pace_km_per_day,
  travel_status, current_hex_q, current_hex_r
FROM parties;

DROP TABLE parties;
ALTER TABLE parties_new RENAME TO parties;

CREATE INDEX IF NOT EXISTS idx_parties_status   ON parties(status);
CREATE INDEX IF NOT EXISTS idx_parties_world    ON parties(world_id);
CREATE INDEX IF NOT EXISTS idx_parties_travel_status ON parties(world_id, travel_status);
