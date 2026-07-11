-- Migration 0017: Campaign journals and session logs
-- Tables for tracking campaign sessions, narrative entries, and linked participants

CREATE TABLE IF NOT EXISTS journals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  entry TEXT NOT NULL,
  date_year INTEGER,
  date_month INTEGER,
  date_day INTEGER,
  calendar_id TEXT,
  is_private INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_journals_date ON journals(date_year, date_month, date_day);
CREATE INDEX IF NOT EXISTS idx_journals_calendar ON journals(calendar_id);
CREATE INDEX IF NOT EXISTS idx_journals_created ON journals(created_at DESC);

CREATE TABLE IF NOT EXISTS journal_participants (
  id TEXT PRIMARY KEY,
  journal_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(journal_id) REFERENCES journals(id) ON DELETE CASCADE,
  UNIQUE(journal_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_journal_participants_journal ON journal_participants(journal_id);
CREATE INDEX IF NOT EXISTS idx_journal_participants_entity ON journal_participants(entity_type, entity_id);
