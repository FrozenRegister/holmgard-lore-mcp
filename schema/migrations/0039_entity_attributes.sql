-- #410 — D1-backed interaction weights and attributes for entity_manage.
-- Campaign-configurable numeric attributes (Weight-1, Weight-2, Tenderness-Index,
-- Cortisol-Level, or anything a campaign defines) that resolve_interaction,
-- analyze_utility, and get_compatibility read as the primary source of truth,
-- falling back to KV lore markdown parsing when no row exists here.
--
-- Dual-keyed to accommodate the two active campaigns' different entity identity
-- schemes: Archisector references entities by lore key (character:guard-1);
-- Calder references D1 characters by UUID. lore_key and character_id are both
-- nullable — a row needs at least one to be reachable, but callers set whichever
-- (or both) apply to their entity. Partial unique indexes keep each identity
-- axis single-row without forcing every campaign to populate both.
--
-- attributes is a JSON object blob, not fixed columns — campaigns own their own
-- attribute schema without requiring a migration per new field (per issue: "a
-- JSON attributes blob that accepts arbitrary key-value pairs").
CREATE TABLE IF NOT EXISTS entity_attributes (
  id           TEXT PRIMARY KEY,
  lore_key     TEXT,
  character_id TEXT REFERENCES characters(id),
  attributes   TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_attributes_lore_key ON entity_attributes(lore_key) WHERE lore_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_attributes_character_id ON entity_attributes(character_id) WHERE character_id IS NOT NULL;
