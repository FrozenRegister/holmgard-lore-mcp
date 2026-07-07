-- Migration 0006: Timeline Engine
-- Adds D1-backed timeline events, branching, and entity knowledge tables.

CREATE TABLE IF NOT EXISTS timeline_events (
  id            TEXT PRIMARY KEY,
  world_id      TEXT NOT NULL,
  thread_id     TEXT NOT NULL DEFAULT 'main',
  event_at      TEXT NOT NULL,
  verb          TEXT NOT NULL,
  entity_id     TEXT,
  object_entity TEXT,
  location_id   TEXT,
  detail        TEXT,
  is_canonical  INTEGER NOT NULL DEFAULT 0,
  branch_id     TEXT,
  created_at    TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE,
  FOREIGN KEY(entity_id) REFERENCES characters(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_timeline_events_thread   ON timeline_events(thread_id, event_at);
CREATE INDEX IF NOT EXISTS idx_timeline_events_canonical ON timeline_events(is_canonical);
CREATE INDEX IF NOT EXISTS idx_timeline_events_branch   ON timeline_events(branch_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_entity   ON timeline_events(entity_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_location ON timeline_events(location_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_world    ON timeline_events(world_id, event_at);

CREATE TABLE IF NOT EXISTS timeline_branches (
  id                 TEXT PRIMARY KEY,
  world_id           TEXT NOT NULL,
  name               TEXT NOT NULL,
  parent_branch_id   TEXT,
  forked_at_event_id TEXT NOT NULL,
  fork_reason        TEXT,
  is_active          INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE,
  FOREIGN KEY(forked_at_event_id) REFERENCES timeline_events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_timeline_branches_world  ON timeline_branches(world_id);

CREATE TABLE IF NOT EXISTS entity_knowledge (
  id             TEXT PRIMARY KEY,
  entity_id      TEXT NOT NULL,
  topic          TEXT NOT NULL,
  knowledge_type TEXT NOT NULL DEFAULT 'fact',
  source         TEXT,
  acquired_at    TEXT NOT NULL,
  detail         TEXT,
  confidence     INTEGER NOT NULL DEFAULT 100,
  is_current     INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(entity_id) REFERENCES characters(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_entity_knowledge_entity ON entity_knowledge(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_knowledge_topic  ON entity_knowledge(entity_id, topic);
