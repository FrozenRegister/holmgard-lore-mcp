-- Rename corpses.position_x/position_y to position_q/position_r. The world
-- map is an axial hex grid (see hexes.q/r, characters.current_hex_q/r,
-- parties.current_hex_q/r) — corpses was the one table still using cartesian
-- x/y for a world-scale position, which risks silently mismatching hex
-- coordinates passed in by callers (scavenge_check's exact-match query on
-- position_x/position_y would never match a corpse registered from a
-- character's current_hex_q/current_hex_r without a caller manually
-- remembering to relabel q->x, r->y).
-- Using table-rebuild pattern (SQLite/D1 does not support column rename
-- inline with other structural changes in this repo's established style).

CREATE TABLE corpses_new (
  id                   TEXT PRIMARY KEY,
  character_id         TEXT NOT NULL,
  character_name       TEXT NOT NULL,
  character_type       TEXT NOT NULL,
  creature_type        TEXT,
  cr                   REAL,
  world_id             TEXT,
  region_id            TEXT,
  position_q           INTEGER,
  position_r           INTEGER,
  encounter_id         TEXT,
  state                TEXT NOT NULL DEFAULT 'fresh' CHECK (state IN ('fresh', 'decaying', 'skeletal', 'gone')),
  state_updated_at     TEXT NOT NULL,
  loot_generated       INTEGER NOT NULL DEFAULT 0,
  looted               INTEGER NOT NULL DEFAULT 0,
  looted_by            TEXT,
  looted_at            TEXT,
  harvestable          INTEGER NOT NULL DEFAULT 0,
  harvestable_resources TEXT NOT NULL DEFAULT '[]',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  currency             TEXT DEFAULT '{"gold":0,"silver":0,"copper":0}',
  currency_looted      INTEGER NOT NULL DEFAULT 0,
  death_at                    TEXT,
  cause_of_death              TEXT,
  decomposition_stage         TEXT NOT NULL DEFAULT 'fresh',
  preserve_inventory_snapshot TEXT NOT NULL DEFAULT '[]',
  recovered                   INTEGER NOT NULL DEFAULT 0,
  recovery_type               TEXT,
  is_landmark                 INTEGER NOT NULL DEFAULT 0
);

INSERT INTO corpses_new
  (id, character_id, character_name, character_type, creature_type, cr, world_id, region_id,
   position_q, position_r, encounter_id, state, state_updated_at, loot_generated, looted,
   looted_by, looted_at, harvestable, harvestable_resources, created_at, updated_at,
   currency, currency_looted, death_at, cause_of_death, decomposition_stage,
   preserve_inventory_snapshot, recovered, recovery_type, is_landmark)
SELECT
  id, character_id, character_name, character_type, creature_type, cr, world_id, region_id,
  position_x, position_y, encounter_id, state, state_updated_at, loot_generated, looted,
  looted_by, looted_at, harvestable, harvestable_resources, created_at, updated_at,
  currency, currency_looted, death_at, cause_of_death, decomposition_stage,
  preserve_inventory_snapshot, recovered, recovery_type, is_landmark
FROM corpses;

DROP TABLE corpses;
ALTER TABLE corpses_new RENAME TO corpses;

CREATE INDEX IF NOT EXISTS idx_corpses_encounter      ON corpses(encounter_id);
CREATE INDEX IF NOT EXISTS idx_corpses_world_position ON corpses(world_id, position_q, position_r);
CREATE INDEX IF NOT EXISTS idx_corpses_state          ON corpses(state);
CREATE INDEX IF NOT EXISTS idx_corpses_character      ON corpses(character_id);
CREATE INDEX IF NOT EXISTS idx_corpses_decomposition_stage ON corpses(decomposition_stage);
