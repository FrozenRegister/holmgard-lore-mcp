-- #316: conflict type taxonomy — physical, social, and hybrid scenes for
-- dual-agent routing. A global (not per-world) taxonomy, same shape as
-- #311's event_verb_taxonomy: seeded with the three core types, runtime-
-- extensible via conflict_type_manage without a code deploy.
--
-- `resolver` records which agent(s) the type routes to — 'combat' (a
-- tactical/combat agent), 'drama' (the narrative agent's opposed-check/
-- social-combat subsystem, #214), or 'both' for hybrid scenes. This MCP
-- cannot enforce that routing server-side; it's a convention the calling
-- agent(s) honor, same as #312's time-mode coordination.
CREATE TABLE IF NOT EXISTS conflict_types (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  resolver    TEXT NOT NULL CHECK(resolver IN ('combat', 'drama', 'both')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO conflict_types (id, name, description, resolver) VALUES
  ('physical', 'Physical', 'Predator encounter, combat, chase -- resolved by a tactical/combat agent via combat_action.', 'combat'),
  ('social',   'Social',   'Boardroom war, patrimoine claim, personhood ruling, diplomatic negotiation -- resolved by the narrative agent via drama (#214).', 'drama'),
  ('hybrid',   'Hybrid',   'Social tension that can erupt into physical violence -- both agents active simultaneously, each handling their own participants.', 'both');

ALTER TABLE scenes ADD COLUMN conflict_type_id TEXT REFERENCES conflict_types(id);
