-- Migration 0009: Character World Scoping (#268)
-- Adds world_id so character.list/character.search can filter out cross-world
-- contamination (e.g. two universes' characters both named "Kael" showing up
-- in the same result). No inline REFERENCES clause on world_id — matches the
-- existing host_body_id/faction_id precedent on this table; D1/miniflare
-- rejects a REFERENCES clause inside an incremental ALTER TABLE ADD COLUMN
-- (confirmed empirically while landing migration 0008), and FK enforcement
-- isn't active anywhere in this schema anyway (no migration sets
-- PRAGMA foreign_keys).
--
-- This migration does NOT backfill world_id on existing characters. There is
-- no structural signal in D1 to do so safely: current_room_id is unset on
-- every existing character, faction_id is unset on every existing character,
-- and guessing world membership from name patterns risks silently mis-tagging
-- narrative data. Backfilling the existing 38 characters into their correct
-- worlds is a separate, explicit follow-up requiring the narrator's actual
-- knowledge of which character belongs to which world.

ALTER TABLE characters ADD COLUMN world_id TEXT;

CREATE INDEX IF NOT EXISTS idx_characters_world ON characters(world_id);
