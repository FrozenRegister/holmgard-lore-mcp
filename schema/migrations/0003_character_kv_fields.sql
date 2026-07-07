-- Migration 0003: KV-native character fields
-- Adds structured columns for fields that previously lived only in KV prose.
-- These support the KV→D1 character migration endpoint and get_lore redirect.

ALTER TABLE characters ADD COLUMN alias TEXT;
ALTER TABLE characters ADD COLUMN age TEXT;
ALTER TABLE characters ADD COLUMN gender TEXT;
ALTER TABLE characters ADD COLUMN orientation TEXT;
ALTER TABLE characters ADD COLUMN weight_1 REAL DEFAULT 0.0;
ALTER TABLE characters ADD COLUMN weight_2 REAL DEFAULT 0.0;
ALTER TABLE characters ADD COLUMN perception_float REAL DEFAULT 0.0;
ALTER TABLE characters ADD COLUMN thread_id TEXT;
ALTER TABLE characters ADD COLUMN state_stage INTEGER DEFAULT 1;
ALTER TABLE characters ADD COLUMN state_stage_timer INTEGER DEFAULT 0;
ALTER TABLE characters ADD COLUMN kv_origin TEXT;
