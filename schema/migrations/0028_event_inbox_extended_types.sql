-- Add extended event types to event_inbox for #337/#340/#341-adjacent RPG
-- systems (production cycle, broadcast/intervention, hazards) that emit
-- through event_manage but aren't in the original 7-type closed enum.
-- Using table-rebuild pattern (SQLite can't ALTER a CHECK constraint in place).

CREATE TABLE event_inbox_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'npc_action', 'combat_update', 'world_change', 'quest_update',
    'time_passage', 'environmental', 'system', 'crate_drop', 'perimeter_contraction',
    'audience_vote', 'production_intervention', 'predator_release', 'shelter_collapse',
    'weather_shift', 'echo_activation'
  )),
  payload    TEXT NOT NULL,
  source_type TEXT CHECK (source_type IN ('npc', 'combat', 'world', 'system', 'scheduler')),
  source_id  TEXT,
  priority   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
  consumed_at TEXT,
  expires_at  TEXT
);

INSERT INTO event_inbox_new
  (id, event_type, payload, source_type, source_id, priority, created_at, consumed_at, expires_at)
SELECT
  id, event_type, payload, source_type, source_id, priority, created_at, consumed_at, expires_at
FROM event_inbox;

DROP TABLE event_inbox;
ALTER TABLE event_inbox_new RENAME TO event_inbox;

CREATE INDEX IF NOT EXISTS idx_event_inbox_unconsumed ON event_inbox(consumed_at) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_event_inbox_created    ON event_inbox(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_inbox_priority   ON event_inbox(priority DESC);
