-- Migration 0016: Quest Milestones
-- Adds ordered milestones for quests with entity linking support.
-- Milestones represent sub-objectives/phases within a quest with status tracking,
-- color indicators, and optional links to other entities (characters, locations, etc).

CREATE TABLE IF NOT EXISTS quest_milestones (
  id                  TEXT PRIMARY KEY,
  quest_id            TEXT NOT NULL,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  title               TEXT NOT NULL,
  notes               TEXT,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  linked_entity_type  TEXT,
  linked_entity_id    TEXT,
  color               TEXT,
  is_private          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  FOREIGN KEY(quest_id) REFERENCES quests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quest_milestones_quest ON quest_milestones(quest_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_quest_milestones_status ON quest_milestones(status);
CREATE INDEX IF NOT EXISTS idx_quest_milestones_linked ON quest_milestones(linked_entity_type, linked_entity_id);
