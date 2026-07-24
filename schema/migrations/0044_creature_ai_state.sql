-- Migration 0044: creature_ai_state — per-map autonomous creature AI (#445, #440 Phase 3)
--
-- The first table holding autonomous creature behaviour state. Each row is one
-- creature (feral predator, Shaper, or a deferred parasitic/environmental type)
-- registered on a world's hex map. The creature_ai_tick hook (tick-hooks.ts)
-- reads these rows every time.advance and branches on predator_taxonomy to run
-- the feral (CK3 hunger model) or Shaper (creative-drive/tenderizing/atelier)
-- state machine — see src/rpg/utils/creature-ai.ts.
--
-- predator_taxonomy lives HERE, not on characters (#445): the column only needs
-- to exist where the AI that reads it lives. There is no characters change for
-- taxonomy.
--
-- FK-in-CREATE is safe for a fresh CREATE TABLE under D1/miniflare (the ALTER
-- TABLE ADD COLUMN … REFERENCES restriction that forced migration 0042's claim
-- columns to be FK-less does not apply here — see migration 0020's world_id FK
-- for the same pattern).

CREATE TABLE IF NOT EXISTS creature_ai_state (
  id                 TEXT PRIMARY KEY,
  world_id           TEXT REFERENCES worlds(id) ON DELETE CASCADE,
  creature_key       TEXT,
  predator_taxonomy  TEXT NOT NULL DEFAULT 'feral',
  home_nest_q        INTEGER,
  home_nest_r        INTEGER,
  territory_radius   INTEGER,
  hunger             INTEGER DEFAULT 0,
  creative_drive     INTEGER DEFAULT 0,
  aggression         REAL,
  activity_pattern   TEXT,
  movement_speed     INTEGER,
  stealth            REAL,
  perception         REAL,
  current_state      TEXT,
  current_hex_q      INTEGER,
  current_hex_r      INTEGER,
  target_hex_q       INTEGER,
  target_hex_r       INTEGER,
  atelier_hex_q      INTEGER,
  atelier_hex_r      INTEGER,
  yield_preference   TEXT,
  created_at         TEXT,
  updated_at         TEXT
);

-- Per-world lookup (creature_ai_tick loads every creature for a world each tick).
CREATE INDEX IF NOT EXISTS idx_creature_ai_world ON creature_ai_state(world_id);

-- Per-hex lookup within a world (spatial queries — who is at / near this hex).
CREATE INDEX IF NOT EXISTS idx_creature_ai_world_hex
  ON creature_ai_state(world_id, current_hex_q, current_hex_r);

-- Notes on schema design:
-- 1. predator_taxonomy NOT NULL DEFAULT 'feral' — a creature registered without
--    an explicit taxonomy runs the feral state machine.
-- 2. hunger / creative_drive default 0 (fed / uninspired). feralTick drives
--    hunger; shaperTick drives creative_drive.
-- 3. aggression / stealth / perception are REAL (0.0–1.0 heuristic weights).
-- 4. current_state is the state-machine state: resting / patrolling / hunting /
--    feeding / fleeing (feral) or patrolling / stalking / tenderizing (Shaper).
-- 5. atelier_hex_q/r and yield_preference are Shaper-only (the workshop hex the
--    Shaper drags claimed prey toward, and which yield grade it prefers).
-- 6. created_at / updated_at are TEXT ISO-8601, set by the application.
