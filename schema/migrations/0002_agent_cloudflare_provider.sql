-- Migration 0002: Cloudflare Workers AI provider support for agent_manage
-- Drops and recreates the agent layer tables (no data exists — agent_manage
-- tool was added in Phase 4, after these tables were first created in Phase 1).
-- Changes: provider defaults to 'cloudflare'; model gets a default; removes the
-- openai/openrouter-only CHECK so any provider string is accepted.

DROP TABLE IF EXISTS agent_calls;
DROP TABLE IF EXISTS agent_journal;
DROP TABLE IF EXISTS agent_secrets;
DROP TABLE IF EXISTS agent_prompt_slices;
DROP TABLE IF EXISTS agents;

CREATE TABLE IF NOT EXISTS agents (
  id                   TEXT PRIMARY KEY,
  character_id         TEXT NOT NULL UNIQUE REFERENCES characters(id) ON DELETE CASCADE,
  provider             TEXT NOT NULL DEFAULT 'cloudflare',
  model                TEXT NOT NULL DEFAULT '@cf/meta/llama-3.1-8b-instruct',
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'retired')),
  auto_on_turn         INTEGER NOT NULL DEFAULT 0,
  temperature          REAL NOT NULL DEFAULT 0.7,
  max_tokens           INTEGER NOT NULL DEFAULT 512,
  budget_tokens        INTEGER,
  tokens_used          INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  circuit_state        TEXT NOT NULL DEFAULT 'closed' CHECK (circuit_state IN ('closed', 'open', 'half_open')),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agents_character    ON agents(character_id);
CREATE INDEX IF NOT EXISTS idx_agents_auto_on_turn ON agents(auto_on_turn) WHERE auto_on_turn = 1;

CREATE TABLE IF NOT EXISTS agent_prompt_slices (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('persona', 'directive', 'secrets', 'narrative_feed', 'recent', 'character_state', 'custom')),
  label       TEXT,
  content     TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_slices_agent_order ON agent_prompt_slices(agent_id, order_index);

CREATE TABLE IF NOT EXISTS agent_secrets (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  importance TEXT NOT NULL DEFAULT 'medium' CHECK (importance IN ('low', 'medium', 'high', 'critical')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_secrets_agent ON agent_secrets(agent_id);

CREATE TABLE IF NOT EXISTS agent_journal (
  id           TEXT PRIMARY KEY,
  agent_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('response', 'observation', 'plan', 'reflection', 'dm_note')),
  encounter_id TEXT,
  round        INTEGER,
  content      TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_journal_agent_time ON agent_journal(agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_calls (
  id                TEXT PRIMARY KEY,
  agent_id          TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  request_id        TEXT,
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  messages_json     TEXT NOT NULL,
  raw_response      TEXT,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  duration_ms       INTEGER,
  status            TEXT NOT NULL,
  error_message     TEXT,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calls_agent_time ON agent_calls(agent_id, created_at DESC);
