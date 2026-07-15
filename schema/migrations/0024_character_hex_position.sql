-- Add hex map position tracking to characters (issue #340 — place_character action)
-- Mirrors parties.current_hex_q/r pattern from migration 0021 for character-level positioning
ALTER TABLE characters ADD COLUMN current_hex_q INTEGER;
ALTER TABLE characters ADD COLUMN current_hex_r INTEGER;
ALTER TABLE characters ADD COLUMN map_id TEXT;
