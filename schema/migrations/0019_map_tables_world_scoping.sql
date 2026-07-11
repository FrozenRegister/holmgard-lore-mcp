-- Migration 0019: World-scope the Map Editor tables (#319, Phase 1 of #308)
--
-- `hexes`/`landmarks` previously had NO migration file at all — their schema
-- lived ad-hoc in `MAP_SCHEMA_DDL` (src/admin/routes.ts) and schema/rpg-schema.sql,
-- created at request time via POST /admin/map/setup-db, bypassing the
-- .github/workflows/d1-migrate.yml auto-migrate pipeline every other table
-- relies on. This migration formalizes them into the normal pipeline — this is
-- safe because the ad-hoc tables already exist in production with this exact
-- pre-migration shape.
--
-- This also begins unifying the map-editor's hex grid with the RPG engine's
-- square-grid world-simulation tables (worlds/tiles/structures/biomes), which
-- today are two entirely separate spatial systems with no shared coordinate
-- space. `world_id` links a hex map to the RPG world it represents; `biome`
-- lets hexes carry a registry-validated biome (see biome-manage.ts's
-- getBiomeRegistry) alongside the editor's freeform `terrain` label — the two
-- vocabularies don't line up 1:1, so this does NOT force a terrain->biome
-- remap, following this repo's own "don't guess narrative data" precedent
-- (see migration 0009's world_id backfill comment). `zone_*`/`region_id`/
-- `population` on `landmarks` fold in what `structures` carries today, so a
-- landmark with a non-null `zone_shape` becomes a zone (matching the RPG
-- engine's #280 threat-resolution model); plain POIs leave those columns null.
--
-- SQLite/D1 can't ALTER TABLE ADD COLUMN ... REFERENCES (rejected at
-- migration-apply time — confirmed in docs/issues/HIGH-fk-enforcement-is-
-- active-for-create-table-references.md), so this rebuilds both tables using
-- the same create-copy-drop-rename pattern as migration
-- 0015_room_nodes_biome_registry.sql. world_id defaults NULL on every existing
-- row — no backfill guessing about which world a pre-existing map/landmark
-- belongs to.
--
-- This is Phase 1 of a 4-phase effort (#319-#322): purely additive schema,
-- no handler behavior change. world_map.ts / encounter-manage.ts /
-- biome-manage.ts still read/write tiles/structures until Phase 2 (#320).

CREATE TABLE hexes_new (
  q          INTEGER NOT NULL,
  r          INTEGER NOT NULL,
  map_id     TEXT NOT NULL DEFAULT 'main',
  terrain    TEXT,
  label      TEXT,
  data       TEXT DEFAULT '{}',
  biome      TEXT,
  elevation  INTEGER DEFAULT 0,
  moisture   INTEGER DEFAULT 50,
  temperature INTEGER DEFAULT 15,
  world_id   TEXT REFERENCES worlds(id) ON DELETE SET NULL,
  updated_at TEXT DEFAULT (DATETIME('now')),
  PRIMARY KEY (q, r, map_id)
);

INSERT INTO hexes_new (q, r, map_id, terrain, label, data, updated_at)
SELECT q, r, map_id, terrain, label, data, updated_at FROM hexes;

DROP TABLE hexes;
ALTER TABLE hexes_new RENAME TO hexes;

CREATE INDEX IF NOT EXISTS idx_hexes_world ON hexes(world_id);
CREATE INDEX IF NOT EXISTS idx_hexes_map   ON hexes(map_id);

CREATE TABLE landmarks_new (
  id             TEXT PRIMARY KEY,
  map_id         TEXT NOT NULL DEFAULT 'main',
  q              INTEGER NOT NULL,
  r              INTEGER NOT NULL,
  name           TEXT NOT NULL,
  category       TEXT,
  data           TEXT DEFAULT '{}',
  world_id       TEXT REFERENCES worlds(id) ON DELETE SET NULL,
  region_id      TEXT,
  population     INTEGER DEFAULT 0,
  zone_type      TEXT,
  zone_shape     TEXT,
  predator_ref   TEXT,
  threat_level   INTEGER,
  dominance_rank INTEGER,
  updated_at     TEXT DEFAULT (DATETIME('now'))
);

INSERT INTO landmarks_new (id, map_id, q, r, name, category, data, updated_at)
SELECT id, map_id, q, r, name, category, data, updated_at FROM landmarks;

DROP TABLE landmarks;
ALTER TABLE landmarks_new RENAME TO landmarks;

CREATE INDEX IF NOT EXISTS idx_landmarks_map    ON landmarks(map_id);
CREATE INDEX IF NOT EXISTS idx_landmarks_coords ON landmarks(q, r);
CREATE INDEX IF NOT EXISTS idx_landmarks_world  ON landmarks(world_id);
