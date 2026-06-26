-- Migration 0004: Explicit entity relations
-- Typed bidirectional relations between any two lore entities (character, location, nation, etc.)

CREATE TABLE IF NOT EXISTS entity_relations (
  id TEXT PRIMARY KEY,
  from_type TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_type TEXT NOT NULL,
  to_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  attitude INTEGER,
  is_bidirectional INTEGER DEFAULT 1,
  color TEXT,
  is_pinned INTEGER DEFAULT 0,
  is_private INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entity_relations_from ON entity_relations(from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_entity_relations_to ON entity_relations(to_type, to_id);
