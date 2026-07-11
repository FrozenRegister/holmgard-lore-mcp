-- Migration 0021: Gotland waypoint registry + real-world-distance party
-- movement (#328).
--
-- Adds a per-world "waypoint" registry (named, real-lat/lon-anchored
-- locations) and a precomputed pairwise distance table, following the exact
-- same "mechanism generic, seed data campaign-specific" split already used
-- for biomes (migration 0010) and zone types (migration 0020): the tables
-- and handler are reusable by any world, but the actual named places
-- (Visby, Roma Kloster, Fårösund, Klintehamn) only get seeded into a world
-- that opts in via waypoint.seed_defaults — unlike biomes/zone-types, this is
-- NOT auto-seeded on world_manage.create/generate, since real Swedish place
-- names only make sense for a Gotland-set campaign.
--
-- Distances between waypoints are precomputed OFFLINE, once (see
-- scripts/gotland-precompute-distances.mjs) and shipped as static seed data
-- (schema/seed-data/gotland-waypoints.json, gotland-distance-matrix.json).
-- The Worker never makes a live routing API call — distance_km is NULL when
-- no route was found, which callers surface as a structured "blocked"
-- response, not an error. (Discovery, this session: OSRM's foot profile
-- actually finds a route across the Fårösund strait — presumably via the
-- free car/foot ferry — so the initial 4-waypoint Gotland seed set has no
-- real example of an unroutable pair; the NULL/"blocked" path is still
-- exercised by waypoint-manage.test.ts against synthetic fixture data.)
--
-- geo_origin_lat/lon + geo_km_per_hex on world_state let a hex's real-world
-- position be derived on demand (see src/rpg/utils/geo-transform.ts), reusing
-- world-map.ts's existing hexToPixel formula with kilometers standing in for
-- pixels — this is a placement/visualization convenience only; the
-- authoritative travel distance always comes from waypoint_distances, never
-- from hex position.
--
-- parties gains movement columns via the table-rebuild pattern (SQLite/D1
-- can't ALTER TABLE ADD COLUMN with a CHECK constraint the same way as a
-- fresh CREATE TABLE; this also matches migration 0019's precedent of
-- rebuilding rather than incrementally altering when adding several related
-- columns at once). travel_pace_km_per_day's DEFAULT 24 is the only place
-- this number lives — application code never hardcodes a fallback pace.
-- parties.position_x/position_y (unused square-grid-era columns — confirmed
-- zero references anywhere in party-manage.ts) are preserved as-is; dropping
-- them is a separate, out-of-scope cleanup decision.

ALTER TABLE world_state ADD COLUMN geo_origin_lat REAL;
ALTER TABLE world_state ADD COLUMN geo_origin_lon REAL;
ALTER TABLE world_state ADD COLUMN geo_km_per_hex REAL;

CREATE TABLE IF NOT EXISTS waypoints (
  id         TEXT PRIMARY KEY,
  world_id   TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  q          INTEGER NOT NULL,
  r          INTEGER NOT NULL,
  lat        REAL NOT NULL,
  lon        REAL NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'settlement',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(world_id, name)
);

CREATE INDEX IF NOT EXISTS idx_waypoints_world ON waypoints(world_id);

CREATE TABLE IF NOT EXISTS waypoint_distances (
  world_id         TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  from_waypoint_id TEXT NOT NULL REFERENCES waypoints(id) ON DELETE CASCADE,
  to_waypoint_id   TEXT NOT NULL REFERENCES waypoints(id) ON DELETE CASCADE,
  distance_km      REAL,
  route_source     TEXT NOT NULL,
  computed_at      TEXT NOT NULL,
  PRIMARY KEY (world_id, from_waypoint_id, to_waypoint_id)
);

CREATE INDEX IF NOT EXISTS idx_waypoint_distances_world ON waypoint_distances(world_id);

CREATE TABLE parties_new (
  id                         TEXT PRIMARY KEY,
  name                       TEXT NOT NULL,
  description                TEXT,
  world_id                   TEXT REFERENCES worlds(id) ON DELETE SET NULL,
  status                     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dormant', 'archived')),
  current_location           TEXT,
  current_quest_id           TEXT REFERENCES quests(id) ON DELETE SET NULL,
  formation                  TEXT NOT NULL DEFAULT 'standard',
  position_x                 INTEGER,
  position_y                 INTEGER,
  current_poi                TEXT,
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL,
  last_played_at             TEXT,
  morale                     INTEGER NOT NULL DEFAULT 62,
  cohesion                   TEXT NOT NULL DEFAULT 'stable',
  watch_order                TEXT NOT NULL DEFAULT '[]',
  current_watch              TEXT,
  -- Gotland waypoint movement (#328) — no FK on the waypoint-id columns
  -- (mirrors landmarks.zone_type having no FK to zone_types.name); validity
  -- is an application-level check in party-manage.ts, same as
  -- zone-type-manage.ts's delete guard.
  current_waypoint_id        TEXT,
  travel_target_waypoint_id  TEXT,
  travel_remaining_km        REAL,
  travel_pace_km_per_day     REAL NOT NULL DEFAULT 24,
  travel_status              TEXT NOT NULL DEFAULT 'stationary' CHECK (travel_status IN ('stationary', 'marching', 'blocked', 'arrived')),
  current_hex_q              INTEGER,
  current_hex_r              INTEGER
);

INSERT INTO parties_new (
  id, name, description, world_id, status, current_location, current_quest_id, formation,
  position_x, position_y, current_poi, created_at, updated_at, last_played_at,
  morale, cohesion, watch_order, current_watch
)
SELECT
  id, name, description, world_id, status, current_location, current_quest_id, formation,
  position_x, position_y, current_poi, created_at, updated_at, last_played_at,
  morale, cohesion, watch_order, current_watch
FROM parties;

DROP TABLE parties;
ALTER TABLE parties_new RENAME TO parties;

-- DROP TABLE drops its indexes too — recreate the pre-existing ones (from
-- migration 0001) plus a new one for tickAllPartiesMarch's per-world
-- marching-party scan.
CREATE INDEX IF NOT EXISTS idx_parties_status   ON parties(status);
CREATE INDEX IF NOT EXISTS idx_parties_world    ON parties(world_id);
CREATE INDEX IF NOT EXISTS idx_parties_position ON parties(position_x, position_y);
CREATE INDEX IF NOT EXISTS idx_parties_travel_status ON parties(world_id, travel_status);
