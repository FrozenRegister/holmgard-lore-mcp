-- Migration 0008: Character Co-Habitation (Phase 2 — light schema, #226)
-- Adds host_body_id/active columns so multiple character rows can represent
-- consciousnesses sharing one physical body; only one is active at a time.
-- This is a narrow *mechanical* layer (who's currently in control) that lives
-- alongside — not instead of — the Phase 1 KV co-habitating:<tag> freeform
-- tag from #226, which continues to carry narrative "why" content unchanged.
--
-- host_body_id intentionally has no inline REFERENCES clause: D1 (under
-- miniflare/vitest-pool-workers, confirmed empirically) rejects a
-- self-referential FK inside an ALTER TABLE ... ADD COLUMN, failing the whole
-- migration transaction. This matches the existing faction_id column on this
-- same table (also a plain TEXT with no REFERENCES) — FK enforcement isn't
-- demonstrably active anywhere in this schema (no migration sets
-- PRAGMA foreign_keys), so this is behavior-equivalent to the FK version.
-- A co-habitation group is any set of rows sharing the same host_body_id
-- value by convention, not schema enforcement.

ALTER TABLE characters ADD COLUMN host_body_id TEXT;
ALTER TABLE characters ADD COLUMN active INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_characters_host_body ON characters(host_body_id);
