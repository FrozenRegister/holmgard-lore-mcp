-- Migration 0007: Character State Snapshots
-- Adds temporal versioning for time-travel and timeline jumps.
-- Stores character state at historical moments for jump_to reconstruction.

CREATE TABLE IF NOT EXISTS character_snapshots (
  id            TEXT PRIMARY KEY,
  character_id  TEXT NOT NULL,
  captured_at   TEXT NOT NULL,
  captured_by   TEXT DEFAULT 'manual',
  event_id      TEXT,
  stats_json    TEXT NOT NULL,
  hp            INTEGER,
  max_hp        INTEGER,
  level         INTEGER,
  ac            INTEGER,
  state_json    TEXT,
  narrative_note TEXT,
  created_at    TEXT NOT NULL,
  FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE,
  FOREIGN KEY(event_id) REFERENCES timeline_events(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_character_snapshots_char_time ON character_snapshots(character_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_character_snapshots_event ON character_snapshots(event_id);
CREATE INDEX IF NOT EXISTS idx_character_snapshots_captured_by ON character_snapshots(captured_by);
