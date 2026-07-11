-- Migration 0018: Races/Species entity type
-- First-class D1 table for ancestries and species

CREATE TABLE IF NOT EXISTS races (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  is_extinct  INTEGER NOT NULL DEFAULT 0,
  parent_race_id TEXT REFERENCES races(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_races_extinct ON races(is_extinct);
CREATE INDEX IF NOT EXISTS idx_races_parent ON races(parent_race_id);
