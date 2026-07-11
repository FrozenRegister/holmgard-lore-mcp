-- Migration 0013: Production Cycle (#283), Party Trust & Betrayal (#285),
-- Resource Survival (#286), Broadcast & Production Intervention (#287).
--
-- Implemented together in one PR because the four systems are circularly
-- coupled by content, not merely by citation number (the issues themselves
-- cite each other's numbers incorrectly — drafted before final numbering —
-- but the actual coupling is real): advance_day (#283) drives resource
-- degradation/crate drops (#286) and reads broadcast state (#287); broadcast
-- votes (#287) pressure party betrayal (#285); party's shared resources
-- (#285) are tracked by the resource system (#286).

-- ── Production Cycle (#283) ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS production_calendar (
  id            TEXT PRIMARY KEY,
  world_id      TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  day           INTEGER NOT NULL,
  event_type    TEXT NOT NULL,
  event_data    TEXT,
  triggered     INTEGER NOT NULL DEFAULT 0,
  triggered_at  TEXT,
  resolved      INTEGER NOT NULL DEFAULT 0,
  UNIQUE(world_id, day, event_type)
);

CREATE INDEX IF NOT EXISTS idx_production_calendar_world_day ON production_calendar(world_id, day);

-- Per-world production clock. Added to world_state (the existing per-world
-- singleton row from time_manage) rather than a new table, since this is
-- the same "one row per world" shape.
ALTER TABLE world_state ADD COLUMN production_day INTEGER NOT NULL DEFAULT 0;
ALTER TABLE world_state ADD COLUMN perimeter_radius INTEGER;
ALTER TABLE world_state ADD COLUMN weather TEXT;
ALTER TABLE world_state ADD COLUMN hazard_level TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE world_state ADD COLUMN encounter_modifier REAL NOT NULL DEFAULT 0;
ALTER TABLE world_state ADD COLUMN extraction_window TEXT NOT NULL DEFAULT 'closed';
ALTER TABLE world_state ADD COLUMN last_intervention_at TEXT;
ALTER TABLE world_state ADD COLUMN production_mood TEXT NOT NULL DEFAULT 'neutral';

-- Per-character production stat block (days_survived, crates_claimed, etc.,
-- see #283's example) — a JSON blob rather than individual columns,
-- matching the existing characters.resource_pools/currency JSON convention.
ALTER TABLE characters ADD COLUMN production_state TEXT;

-- ── Party Trust & Betrayal (#285) ────────────────────────────────────────────
-- Extends the EXISTING `party` sub-handler/parties table rather than adding
-- a second, colliding "party" concept — #285 assumed rpg{sub:"party"} didn't
-- exist yet, but it already does (generic create/get/list/add_member/etc.
-- grouping used by combat and world-manage). The trust/morale/betrayal
-- actions this migration supports are additive to that existing handler.

ALTER TABLE parties ADD COLUMN morale INTEGER NOT NULL DEFAULT 62;
ALTER TABLE parties ADD COLUMN cohesion TEXT NOT NULL DEFAULT 'stable';
ALTER TABLE parties ADD COLUMN watch_order TEXT NOT NULL DEFAULT '[]';
ALTER TABLE parties ADD COLUMN current_watch TEXT;

CREATE TABLE IF NOT EXISTS party_trust (
  id                 TEXT PRIMARY KEY,
  party_id           TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  from_character_id  TEXT NOT NULL,
  to_character_id    TEXT NOT NULL,
  trust_score        INTEGER NOT NULL DEFAULT 50,
  updated_at         TEXT NOT NULL,
  UNIQUE(party_id, from_character_id, to_character_id)
);

CREATE INDEX IF NOT EXISTS idx_party_trust_party ON party_trust(party_id);

-- ── Resource Survival (#286) ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS resource_inventory (
  id                 TEXT PRIMARY KEY,
  world_id           TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  owner_type         TEXT NOT NULL CHECK(owner_type IN ('character', 'party')),
  owner_id           TEXT NOT NULL,
  item_name          TEXT NOT NULL,
  category           TEXT NOT NULL,
  quantity           INTEGER NOT NULL DEFAULT 1,
  degradation_timer  REAL,
  expires_on_day     INTEGER,
  spoiled            INTEGER NOT NULL DEFAULT 0,
  acquired_day       INTEGER,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_resource_inventory_owner ON resource_inventory(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_resource_inventory_world ON resource_inventory(world_id);

-- Starvation-streak tracking, separate from individual item rows since a
-- days-without-food counter belongs to the owner, not any one resource.
CREATE TABLE IF NOT EXISTS resource_owner_state (
  owner_type        TEXT NOT NULL CHECK(owner_type IN ('character', 'party')),
  owner_id          TEXT NOT NULL,
  world_id          TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  days_without_food INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL,
  PRIMARY KEY(owner_type, owner_id)
);

CREATE TABLE IF NOT EXISTS crate_drops (
  id          TEXT PRIMARY KEY,
  world_id    TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  day         INTEGER NOT NULL,
  x           INTEGER NOT NULL,
  y           INTEGER NOT NULL,
  contents    TEXT NOT NULL,
  claimed     INTEGER NOT NULL DEFAULT 0,
  claimed_by  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crate_drops_world_day ON crate_drops(world_id, day);

-- ── Broadcast & Production Intervention (#287) ───────────────────────────────

CREATE TABLE IF NOT EXISTS broadcast_approval (
  character_id  TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  world_id      TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  approval      INTEGER NOT NULL DEFAULT 50,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_broadcast_approval_world ON broadcast_approval(world_id);

CREATE TABLE IF NOT EXISTS broadcast_votes (
  id           TEXT PRIMARY KEY,
  world_id     TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  vote_type    TEXT NOT NULL,
  day          INTEGER NOT NULL,
  options      TEXT,
  result       TEXT,
  resolved     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  resolved_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_broadcast_votes_world ON broadcast_votes(world_id, resolved);

CREATE TABLE IF NOT EXISTS broadcast_interventions (
  id                   TEXT PRIMARY KEY,
  world_id             TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  day                  INTEGER NOT NULL,
  intervention_type    TEXT NOT NULL,
  target_character_id  TEXT,
  details              TEXT,
  created_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_broadcast_interventions_world ON broadcast_interventions(world_id, day);
