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
-- NOTE: on the production `holmgard-rpg` D1 database, `kv_origin` had already been
-- added out-of-band (a raw, non-migration import from the earlier Mnehmos data load)
-- before this migration was written, so this ALTER failed with a duplicate-column
-- error and rolled back the whole transaction — silently reverting the 9 ALTERs
-- above along with it. The remote DB was repaired by hand (missing columns/tables
-- added directly, then `0003`-`0006` marked applied in `d1_migrations`), so
-- `wrangler d1 migrations apply` won't try to re-run this file there. A *fresh*
-- database has no pre-existing `kv_origin` column, so this file runs fine as-is.
ALTER TABLE characters ADD COLUMN kv_origin TEXT;
