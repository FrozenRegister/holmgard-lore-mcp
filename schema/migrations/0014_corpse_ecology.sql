-- Migration 0014: Corpse Ecology (#288)
-- Extends the existing `corpses` table (built for D&D combat loot — a
-- 4-state fresh/decaying/skeletal/gone `state` enum with a CHECK constraint)
-- with Preserve-specific decomposition tracking. The legacy `state`/`decay`/
-- `loot`/`generate_loot` actions and column are untouched; new columns and
-- actions (register/decompose/scavenge_check/loot_corpse/recover/get_state/
-- psychological_impact) are additive, so D&D-style corpse usage elsewhere
-- in the codebase is unaffected.
--
-- Preserve corpse loot is tracked as a denormalized JSON snapshot
-- (preserve_inventory_snapshot) rather than corpse_inventory (FK'd to the
-- D&D `items` table — wrong shape for #286's free-form resource_inventory
-- item names) or resource_inventory itself (its owner_type CHECK constraint
-- only allows 'character'/'party'; widening a CHECK constraint requires
-- recreating the table under D1/SQLite, out of scope for an additive
-- migration — a documented follow-up, not a silent gap).

ALTER TABLE corpses ADD COLUMN death_at TEXT;
ALTER TABLE corpses ADD COLUMN cause_of_death TEXT;
ALTER TABLE corpses ADD COLUMN decomposition_stage TEXT NOT NULL DEFAULT 'fresh';
ALTER TABLE corpses ADD COLUMN preserve_inventory_snapshot TEXT NOT NULL DEFAULT '[]';
ALTER TABLE corpses ADD COLUMN recovered INTEGER NOT NULL DEFAULT 0;
ALTER TABLE corpses ADD COLUMN recovery_type TEXT;
ALTER TABLE corpses ADD COLUMN is_landmark INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_corpses_decomposition_stage ON corpses(decomposition_stage);
