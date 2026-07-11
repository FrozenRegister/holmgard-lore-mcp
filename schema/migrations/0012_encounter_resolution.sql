-- Migration 0012: Encounter resolution engine (#280)
--
-- Zone threat/dominance fields (threatLevel/dominanceRank) live in the
-- existing structures.metadata JSON — no schema change needed for those, see
-- world-map.ts's mergeZoneMetadata/resolveZonesAt. This migration adds:
--
--   1. biomes.base_threat — per-biome baseline threat contribution ("biome_base"
--      in the resolve() formula). Plain typed column, no inline REFERENCES,
--      safe under the established D1/ALTER TABLE convention. Defaults to 0 so
--      every existing biome is unaffected until a narrator opts in via
--      biome_manage's register/update actions.
--
--   2. encounter_types — per-world, narrator-registered encounter definitions
--      (predator/environmental/system/passive) used by encounter.resolve's
--      weighted random type selection. No defaults are seeded automatically
--      (unlike biomes) — predator rosters are narrative-specific per world
--      (the Calder narrative's giant_panther/leonar/etc. have no meaning for
--      a generic fantasy world), so every world's roster is narrator-authored
--      via encounter.add_type.
--
--   3. character_injuries — persisted injury records from encounter.resolve
--      so encounter.check_infection can look up severity/infection-risk by
--      injuryId later. character_id is nullable: resolve can be called for a
--      generic party without real character records, in which case the
--      injury is returned in the response but not persisted for later lookup.

ALTER TABLE biomes ADD COLUMN base_threat REAL NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS encounter_types (
  id             TEXT PRIMARY KEY,
  world_id       TEXT NOT NULL,
  predator_name  TEXT,
  category       TEXT NOT NULL,
  aggression     TEXT NOT NULL DEFAULT 'curious',
  base_weight    REAL NOT NULL DEFAULT 1.0,
  min_threat     REAL NOT NULL DEFAULT 0,
  requires_core  INTEGER NOT NULL DEFAULT 0,
  description    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_encounter_types_world ON encounter_types(world_id);

CREATE TABLE IF NOT EXISTS character_injuries (
  id               TEXT PRIMARY KEY,
  character_id     TEXT,
  world_id         TEXT NOT NULL,
  severity         TEXT NOT NULL,
  injury_type      TEXT NOT NULL,
  location         TEXT,
  ability          TEXT,
  ability_modifier INTEGER,
  bleeding_rate    TEXT,
  infection_risk   TEXT,
  recovery         TEXT,
  description      TEXT,
  treated          INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_character_injuries_character ON character_injuries(character_id);
CREATE INDEX IF NOT EXISTS idx_character_injuries_world ON character_injuries(world_id);
