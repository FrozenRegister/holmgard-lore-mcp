-- migration 0005: world clock and character birthdates
-- Adds born column to characters and creates the world_state table.

ALTER TABLE characters ADD COLUMN IF NOT EXISTS born TEXT;

CREATE TABLE IF NOT EXISTS world_state (
  world_id         TEXT PRIMARY KEY,
  current_date     TEXT NOT NULL DEFAULT '2184-07-15',
  era              TEXT,
  tick_speed       TEXT NOT NULL DEFAULT 'realtime',
  last_advanced_at TEXT,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
);
