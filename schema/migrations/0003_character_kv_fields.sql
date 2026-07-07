-- Migration 0003: KV-native character fields
-- Adds structured columns for fields that previously lived only in KV prose.
-- These support the KV→D1 character migration endpoint and get_lore redirect.

ALTER TABLE characters ADD COLUMN IF NOT EXISTS alias TEXT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS age TEXT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS orientation TEXT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS weight_1 REAL DEFAULT 0.0;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS weight_2 REAL DEFAULT 0.0;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS perception_float REAL DEFAULT 0.0;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS thread_id TEXT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS state_stage INTEGER DEFAULT 1;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS state_stage_timer INTEGER DEFAULT 0;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS kv_origin TEXT;
