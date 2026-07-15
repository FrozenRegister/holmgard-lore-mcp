-- Phase 1 of #308: add `universes` as a narrative-namespace parent, additive/non-breaking.
-- worlds/timeline_events keep their spatial-grid semantics unchanged; universe_id is a
-- nullable FK that lets a future cross-world query span multiple `worlds` rows that belong
-- to the same narrative universe. No backfill, no NOT NULL, no renames — see the Phase 1
-- gameplan on #308 for what is explicitly deferred (Phase 2/3, query-layer work).

CREATE TABLE IF NOT EXISTS universes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL
);

ALTER TABLE worlds ADD COLUMN universe_id TEXT REFERENCES universes(id);
ALTER TABLE timeline_events ADD COLUMN universe_id TEXT REFERENCES universes(id);
ALTER TABLE production_calendar ADD COLUMN universe_id TEXT;
ALTER TABLE resource_inventory ADD COLUMN universe_id TEXT;
ALTER TABLE crate_drops ADD COLUMN universe_id TEXT;
ALTER TABLE broadcast_votes ADD COLUMN universe_id TEXT;
ALTER TABLE broadcast_interventions ADD COLUMN universe_id TEXT;
