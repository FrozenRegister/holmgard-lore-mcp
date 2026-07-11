-- schema/rpg-schema.sql
-- D1 schema for Holmgard RPG engine (ported from Mnehmos migrations.ts).
-- Tables are ordered by FK dependency so this file can be executed top-to-bottom
-- against a fresh D1 database.  All incremental ALTER TABLE migrations from the
-- original codebase have been consolidated into the base CREATE TABLE definitions.

-- ── World / Geography ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS worlds (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  seed        TEXT NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ── World State (time_manage) ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS world_state (
  world_id              TEXT PRIMARY KEY,
  current_date          TEXT NOT NULL DEFAULT '2184-07-15',
  era                   TEXT,
  tick_speed            TEXT NOT NULL DEFAULT 'realtime',
  last_advanced_at      TEXT,
  -- Production Cycle (#283) — see migration 0013.
  production_day        INTEGER NOT NULL DEFAULT 0,
  perimeter_radius      INTEGER,
  weather               TEXT,
  hazard_level          TEXT NOT NULL DEFAULT 'standard',
  encounter_modifier    REAL NOT NULL DEFAULT 0,
  extraction_window     TEXT NOT NULL DEFAULT 'closed',
  last_intervention_at  TEXT,
  production_mood       TEXT NOT NULL DEFAULT 'neutral',
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS node_networks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK(length(trim(name)) > 0 AND length(name) <= 100),
  type        TEXT NOT NULL CHECK(type IN ('cluster', 'linear')),
  world_id    TEXT NOT NULL,
  center_x    INTEGER NOT NULL,
  center_y    INTEGER NOT NULL,
  bounding_box TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_node_networks_coords ON node_networks(center_x, center_y);
CREATE INDEX IF NOT EXISTS idx_node_networks_world  ON node_networks(world_id);

-- biome_context has no CHECK constraint (#290) — validated at the
-- application layer against the per-world dynamic biome registry
-- (biome-manage.ts's getBiomeRegistry), same pattern as world_map.ts's
-- tiles.biome. See migration 0015 for the table-rebuild history (SQLite
-- can't drop a CHECK constraint in place).
CREATE TABLE IF NOT EXISTS room_nodes (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL CHECK(length(trim(name)) > 0 AND length(name) <= 100),
  base_description TEXT NOT NULL CHECK(length(trim(base_description)) >= 10 AND length(base_description) <= 2000),
  biome_context    TEXT NOT NULL,
  atmospherics     TEXT NOT NULL DEFAULT '[]',
  exits            TEXT NOT NULL DEFAULT '[]',
  entity_ids       TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  visited_count    INTEGER NOT NULL DEFAULT 0,
  last_visited_at  TEXT,
  local_x          INTEGER DEFAULT 0,
  local_y          INTEGER DEFAULT 0,
  network_id       TEXT REFERENCES node_networks(id) ON DELETE SET NULL,
  world_id         TEXT REFERENCES worlds(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_room_nodes_biome        ON room_nodes(biome_context);
CREATE INDEX IF NOT EXISTS idx_room_nodes_visited      ON room_nodes(last_visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_room_nodes_local_coords ON room_nodes(local_x, local_y);
CREATE INDEX IF NOT EXISTS idx_room_nodes_network      ON room_nodes(network_id);
CREATE INDEX IF NOT EXISTS idx_room_nodes_world        ON room_nodes(world_id);

-- Nations must be created before regions (regions.owner_nation_id → nations)
CREATE TABLE IF NOT EXISTS nations (
  id              TEXT PRIMARY KEY,
  world_id        TEXT NOT NULL,
  name            TEXT NOT NULL,
  leader          TEXT NOT NULL,
  ideology        TEXT NOT NULL,
  aggression      INTEGER NOT NULL DEFAULT 50,
  trust           INTEGER NOT NULL DEFAULT 50,
  paranoia        INTEGER NOT NULL DEFAULT 50,
  gdp             REAL NOT NULL DEFAULT 1000,
  resources       TEXT NOT NULL DEFAULT '{"food":0,"metal":0,"oil":0}',
  relations       TEXT NOT NULL DEFAULT '{}',
  private_memory  TEXT,
  public_intent   TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nations_world ON nations(world_id);

CREATE TABLE IF NOT EXISTS regions (
  id              TEXT PRIMARY KEY,
  world_id        TEXT NOT NULL,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,
  center_x        INTEGER NOT NULL,
  center_y        INTEGER NOT NULL,
  color           TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  owner_nation_id TEXT REFERENCES nations(id) ON DELETE SET NULL,
  control_level   INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_regions_owner_nation ON regions(owner_nation_id);

-- ── Characters ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS characters (
  id                             TEXT PRIMARY KEY,
  name                           TEXT NOT NULL,
  stats                          TEXT NOT NULL,
  hp                             INTEGER NOT NULL,
  max_hp                         INTEGER NOT NULL,
  ac                             INTEGER NOT NULL,
  level                          INTEGER NOT NULL,
  faction_id                     TEXT,
  behavior                       TEXT,
  created_at                     TEXT NOT NULL,
  updated_at                     TEXT NOT NULL,
  -- columns added by incremental migrations in Mnehmos, consolidated here:
  character_type                 TEXT DEFAULT 'pc',
  character_class                TEXT DEFAULT 'fighter',
  spell_slots                    TEXT,
  pact_magic_slots               TEXT,
  known_spells                   TEXT DEFAULT '[]',
  prepared_spells                TEXT DEFAULT '[]',
  cantrips_known                 TEXT DEFAULT '[]',
  max_spell_level                INTEGER DEFAULT 0,
  concentrating_on               TEXT,
  conditions                     TEXT DEFAULT '[]',
  race                           TEXT DEFAULT 'Human',
  legendary_actions              INTEGER,
  legendary_actions_remaining    INTEGER,
  legendary_resistances          INTEGER,
  legendary_resistances_remaining INTEGER,
  has_lair_actions               INTEGER DEFAULT 0,
  resistances                    TEXT DEFAULT '[]',
  vulnerabilities                TEXT DEFAULT '[]',
  immunities                     TEXT DEFAULT '[]',
  currency                       TEXT DEFAULT '{"gold":0,"silver":0,"copper":0}',
  current_room_id                TEXT REFERENCES room_nodes(id) ON DELETE SET NULL,
  perception_bonus               INTEGER DEFAULT 0,
  stealth_bonus                  INTEGER DEFAULT 0,
  xp                             INTEGER NOT NULL DEFAULT 0,
  resource_pools                 TEXT DEFAULT '{}',
  background                     TEXT,
  alignment                      TEXT,
  origin                         TEXT,
  -- Production Cycle (#283) — JSON stat block (days_survived, crates_claimed,
  -- etc.), see migration 0013.
  production_state               TEXT
);

CREATE INDEX IF NOT EXISTS idx_characters_type ON characters(character_type);

-- ── Character Snapshots (temporal versioning for time-travel) ─────────────────

CREATE TABLE IF NOT EXISTS character_snapshots (
  id            TEXT PRIMARY KEY,
  character_id  TEXT NOT NULL,
  captured_at   TEXT NOT NULL,
  captured_by   TEXT DEFAULT 'manual',
  event_id      TEXT,
  stats_json    TEXT NOT NULL,
  hp            INTEGER,
  max_hp        INTEGER,
  level         INTEGER,
  ac            INTEGER,
  state_json    TEXT,
  narrative_note TEXT,
  created_at    TEXT NOT NULL,
  FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE,
  FOREIGN KEY(event_id) REFERENCES timeline_events(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_character_snapshots_char_time ON character_snapshots(character_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_character_snapshots_event ON character_snapshots(event_id);
CREATE INDEX IF NOT EXISTS idx_character_snapshots_captured_by ON character_snapshots(captured_by);

-- ── World geography (depends on worlds only) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS tiles (
  id          TEXT PRIMARY KEY,
  world_id    TEXT NOT NULL,
  x           INTEGER NOT NULL,
  y           INTEGER NOT NULL,
  biome       TEXT NOT NULL,
  elevation   INTEGER NOT NULL,
  moisture    INTEGER NOT NULL,
  temperature INTEGER NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE,
  UNIQUE(world_id, x, y)
);

CREATE TABLE IF NOT EXISTS structures (
  id          TEXT PRIMARY KEY,
  world_id    TEXT NOT NULL,
  region_id   TEXT,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  x           INTEGER NOT NULL,
  y           INTEGER NOT NULL,
  population  INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  metadata    TEXT,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
);

-- Zone/territory shapes (#276) — see migration 0011. metadata JSON reused,
-- no new column; this partial index keeps zone-bearing lookups fast.
CREATE INDEX IF NOT EXISTS idx_structures_zone ON structures(world_id) WHERE json_extract(metadata, '$.zone') IS NOT NULL;

-- Dynamic per-world biome registry (#274) — see migration 0010 for the
-- rollout notes on why spatial_manage's room_nodes.biome_context CHECK
-- constraint isn't also replaced by this table yet.
CREATE TABLE IF NOT EXISTS biomes (
  id            TEXT PRIMARY KEY,
  world_id      TEXT NOT NULL,
  name          TEXT NOT NULL,
  glyph         TEXT NOT NULL DEFAULT '?',
  category      TEXT NOT NULL DEFAULT 'terrain',
  color_hex     TEXT NOT NULL DEFAULT '#888888',
  movement_cost REAL NOT NULL DEFAULT 1.0,
  -- #280 — baseline threat contribution ("biome_base" in encounter.resolve).
  -- See migration 0012.
  base_threat   REAL NOT NULL DEFAULT 0,
  description   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE,
  UNIQUE(world_id, name)
);

CREATE INDEX IF NOT EXISTS idx_biomes_world ON biomes(world_id);

-- Encounter resolution engine (#280) — see migration 0012.
CREATE TABLE IF NOT EXISTS encounter_types (
  id             TEXT PRIMARY KEY,
  world_id       TEXT NOT NULL,
  predator_name  TEXT,
  category       TEXT NOT NULL,
  aggression     TEXT NOT NULL DEFAULT 'curious',
  base_weight    REAL NOT NULL DEFAULT 1.0,
  min_threat     REAL NOT NULL DEFAULT 0,
  requires_core  INTEGER NOT NULL DEFAULT 0,
  description    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_encounter_types_world ON encounter_types(world_id);

CREATE TABLE IF NOT EXISTS character_injuries (
  id               TEXT PRIMARY KEY,
  character_id     TEXT,
  world_id         TEXT NOT NULL,
  severity         TEXT NOT NULL,
  injury_type      TEXT NOT NULL,
  location         TEXT,
  ability          TEXT,
  ability_modifier INTEGER,
  bleeding_rate    TEXT,
  infection_risk   TEXT,
  recovery         TEXT,
  description      TEXT,
  treated          INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_character_injuries_character ON character_injuries(character_id);
CREATE INDEX IF NOT EXISTS idx_character_injuries_world ON character_injuries(world_id);

CREATE TABLE IF NOT EXISTS rivers (
  id               TEXT PRIMARY KEY,
  world_id         TEXT NOT NULL,
  name             TEXT NOT NULL,
  path             TEXT NOT NULL,
  width            INTEGER NOT NULL,
  source_elevation INTEGER NOT NULL,
  mouth_elevation  INTEGER NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
);

-- ── Quests / Parties ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quests (
  id            TEXT PRIMARY KEY,
  world_id      TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  status        TEXT NOT NULL,
  objectives    TEXT NOT NULL,
  rewards       TEXT NOT NULL,
  prerequisites TEXT NOT NULL,
  giver         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
);

-- Quest Milestones — see migration 0016.
CREATE TABLE IF NOT EXISTS quest_milestones (
  id                  TEXT PRIMARY KEY,
  quest_id            TEXT NOT NULL,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  title               TEXT NOT NULL,
  notes               TEXT,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  linked_entity_type  TEXT,
  linked_entity_id    TEXT,
  color               TEXT,
  is_private          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  FOREIGN KEY(quest_id) REFERENCES quests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quest_milestones_quest   ON quest_milestones(quest_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_quest_milestones_status  ON quest_milestones(status);
CREATE INDEX IF NOT EXISTS idx_quest_milestones_linked  ON quest_milestones(linked_entity_type, linked_entity_id);

-- Campaign journals and session logs — see migration 0017.
CREATE TABLE IF NOT EXISTS journals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  entry TEXT NOT NULL,
  date_year INTEGER,
  date_month INTEGER,
  date_day INTEGER,
  calendar_id TEXT,
  is_private INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_journals_date    ON journals(date_year, date_month, date_day);
CREATE INDEX IF NOT EXISTS idx_journals_calendar ON journals(calendar_id);
CREATE INDEX IF NOT EXISTS idx_journals_created  ON journals(created_at DESC);

CREATE TABLE IF NOT EXISTS journal_participants (
  id TEXT PRIMARY KEY,
  journal_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(journal_id) REFERENCES journals(id) ON DELETE CASCADE,
  UNIQUE(journal_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_journal_participants_journal ON journal_participants(journal_id);
CREATE INDEX IF NOT EXISTS idx_journal_participants_entity  ON journal_participants(entity_type, entity_id);

-- Races/Species entity type — see migration 0018.
CREATE TABLE IF NOT EXISTS races (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  is_extinct  INTEGER NOT NULL DEFAULT 0,
  parent_race_id TEXT REFERENCES races(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_races_extinct ON races(is_extinct);
CREATE INDEX IF NOT EXISTS idx_races_parent  ON races(parent_race_id);

CREATE TABLE IF NOT EXISTS parties (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT,
  world_id         TEXT REFERENCES worlds(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dormant', 'archived')),
  current_location TEXT,
  current_quest_id TEXT REFERENCES quests(id) ON DELETE SET NULL,
  formation        TEXT NOT NULL DEFAULT 'standard',
  position_x       INTEGER,
  position_y       INTEGER,
  current_poi      TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  last_played_at   TEXT,
  -- Party Trust & Betrayal (#285) — see migration 0013. Extends this existing
  -- table rather than a second, colliding "party" concept.
  morale           INTEGER NOT NULL DEFAULT 62,
  cohesion         TEXT NOT NULL DEFAULT 'stable',
  watch_order      TEXT NOT NULL DEFAULT '[]',
  current_watch    TEXT
);

CREATE INDEX IF NOT EXISTS idx_parties_status   ON parties(status);
CREATE INDEX IF NOT EXISTS idx_parties_world    ON parties(world_id);
CREATE INDEX IF NOT EXISTS idx_parties_position ON parties(position_x, position_y);

-- Party Trust & Betrayal (#285) — see migration 0013.
CREATE TABLE IF NOT EXISTS party_trust (
  id                 TEXT PRIMARY KEY,
  party_id           TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  from_character_id  TEXT NOT NULL,
  to_character_id    TEXT NOT NULL,
  trust_score        INTEGER NOT NULL DEFAULT 50,
  updated_at         TEXT NOT NULL,
  UNIQUE(party_id, from_character_id, to_character_id)
);

CREATE INDEX IF NOT EXISTS idx_party_trust_party ON party_trust(party_id);

CREATE TABLE IF NOT EXISTS party_members (
  id               TEXT PRIMARY KEY,
  party_id         TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  character_id     TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  role             TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('leader', 'member', 'companion', 'hireling', 'prisoner', 'mount')),
  is_active        INTEGER NOT NULL DEFAULT 0,
  position         INTEGER,
  share_percentage INTEGER NOT NULL DEFAULT 100,
  joined_at        TEXT NOT NULL,
  notes            TEXT,
  UNIQUE(party_id, character_id)
);

CREATE INDEX IF NOT EXISTS idx_party_members_party     ON party_members(party_id);
CREATE INDEX IF NOT EXISTS idx_party_members_character ON party_members(character_id);

-- ── Combat ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS encounters (
  id              TEXT PRIMARY KEY,
  region_id       TEXT,
  tokens          TEXT NOT NULL,
  round           INTEGER NOT NULL,
  active_token_id TEXT,
  status          TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY(region_id) REFERENCES regions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS battlefield (
  id           TEXT PRIMARY KEY,
  encounter_id TEXT NOT NULL,
  grid_data    TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  FOREIGN KEY(encounter_id) REFERENCES encounters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS combat_action_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  encounter_id   TEXT NOT NULL,
  round          INTEGER NOT NULL,
  turn_index     INTEGER NOT NULL,
  actor_id       TEXT NOT NULL,
  actor_name     TEXT NOT NULL,
  action_type    TEXT NOT NULL,
  target_ids     TEXT,
  result_summary TEXT NOT NULL,
  result_detail  TEXT,
  damage_dealt   INTEGER,
  healing_done   INTEGER,
  hp_changes     TEXT,
  timestamp      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_combat_action_log_encounter ON combat_action_log(encounter_id);
CREATE INDEX IF NOT EXISTS idx_combat_action_log_round     ON combat_action_log(encounter_id, round);

-- ── Items / Inventory ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS items (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  type        TEXT NOT NULL,
  weight      REAL NOT NULL DEFAULT 0,
  value       INTEGER NOT NULL DEFAULT 0,
  properties  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_items (
  character_id TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  quantity     INTEGER NOT NULL DEFAULT 1,
  equipped     INTEGER NOT NULL DEFAULT 0,
  slot         TEXT,
  PRIMARY KEY(character_id, item_id),
  FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE,
  FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quest_logs (
  character_id       TEXT PRIMARY KEY,
  active_quests      TEXT NOT NULL,
  completed_quests   TEXT NOT NULL,
  failed_quests      TEXT NOT NULL,
  FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- ── Math / Calculations ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS calculations (
  id         TEXT PRIMARY KEY,
  session_id TEXT,
  input      TEXT NOT NULL,
  result     TEXT NOT NULL,
  steps      TEXT,
  seed       TEXT,
  timestamp  TEXT NOT NULL,
  metadata   TEXT
);

-- ── Strategy / Nations ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS turn_state (
  world_id        TEXT PRIMARY KEY,
  current_turn    INTEGER NOT NULL DEFAULT 1,
  turn_phase      TEXT NOT NULL DEFAULT 'planning',
  phase_started_at TEXT NOT NULL,
  nations_ready   TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS diplomatic_relations (
  from_nation_id TEXT NOT NULL,
  to_nation_id   TEXT NOT NULL,
  opinion        INTEGER NOT NULL DEFAULT 0,
  is_allied      INTEGER NOT NULL DEFAULT 0,
  truce_until    INTEGER,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY(from_nation_id, to_nation_id),
  FOREIGN KEY(from_nation_id) REFERENCES nations(id) ON DELETE CASCADE,
  FOREIGN KEY(to_nation_id)   REFERENCES nations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS territorial_claims (
  id             TEXT PRIMARY KEY,
  nation_id      TEXT NOT NULL,
  region_id      TEXT NOT NULL,
  claim_strength INTEGER NOT NULL DEFAULT 50,
  justification  TEXT,
  created_at     TEXT NOT NULL,
  FOREIGN KEY(nation_id)  REFERENCES nations(id)  ON DELETE CASCADE,
  FOREIGN KEY(region_id) REFERENCES regions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_territorial_claims_nation ON territorial_claims(nation_id);
CREATE INDEX IF NOT EXISTS idx_territorial_claims_region ON territorial_claims(region_id);

CREATE TABLE IF NOT EXISTS nation_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  world_id         TEXT NOT NULL,
  turn_number      INTEGER NOT NULL,
  event_type       TEXT NOT NULL,
  involved_nations TEXT NOT NULL,
  details          TEXT NOT NULL,
  timestamp        TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nation_events_world ON nation_events(world_id);
CREATE INDEX IF NOT EXISTS idx_nation_events_turn  ON nation_events(world_id, turn_number);

-- ── Secrets ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS secrets (
  id                  TEXT PRIMARY KEY,
  world_id            TEXT NOT NULL,
  type                TEXT NOT NULL,
  category            TEXT NOT NULL,
  name                TEXT NOT NULL,
  public_description  TEXT NOT NULL,
  secret_description  TEXT NOT NULL,
  linked_entity_id    TEXT,
  linked_entity_type  TEXT,
  revealed            INTEGER NOT NULL DEFAULT 0,
  revealed_at         TEXT,
  revealed_by         TEXT,
  reveal_conditions   TEXT NOT NULL DEFAULT '[]',
  sensitivity         TEXT NOT NULL DEFAULT 'medium',
  leak_patterns       TEXT NOT NULL DEFAULT '[]',
  notes               TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_secrets_world    ON secrets(world_id);
CREATE INDEX IF NOT EXISTS idx_secrets_revealed ON secrets(revealed);
CREATE INDEX IF NOT EXISTS idx_secrets_linked   ON secrets(linked_entity_id, linked_entity_type);

-- ── NPC Memory ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS npc_relationships (
  character_id       TEXT NOT NULL,
  npc_id             TEXT NOT NULL,
  familiarity        TEXT NOT NULL DEFAULT 'stranger' CHECK (familiarity IN ('stranger', 'acquaintance', 'friend', 'close_friend', 'rival', 'enemy')),
  disposition        TEXT NOT NULL DEFAULT 'neutral' CHECK (disposition IN ('hostile', 'unfriendly', 'neutral', 'friendly', 'helpful')),
  notes              TEXT,
  first_met_at       TEXT NOT NULL,
  last_interaction_at TEXT NOT NULL,
  interaction_count  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(character_id, npc_id)
);

CREATE INDEX IF NOT EXISTS idx_npc_relationships_char ON npc_relationships(character_id);
CREATE INDEX IF NOT EXISTS idx_npc_relationships_npc  ON npc_relationships(npc_id);

CREATE TABLE IF NOT EXISTS conversation_memories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL,
  npc_id       TEXT NOT NULL,
  summary      TEXT NOT NULL,
  importance   TEXT NOT NULL DEFAULT 'medium' CHECK (importance IN ('low', 'medium', 'high', 'critical')),
  topics       TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_memories_char_npc  ON conversation_memories(character_id, npc_id);
CREATE INDEX IF NOT EXISTS idx_conversation_memories_importance ON conversation_memories(importance);

-- ── Theft / Fencing ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stolen_items (
  id                  TEXT PRIMARY KEY,
  item_id             TEXT NOT NULL,
  stolen_from         TEXT NOT NULL,
  stolen_by           TEXT NOT NULL,
  stolen_at           TEXT NOT NULL,
  stolen_location     TEXT,
  heat_level          TEXT NOT NULL DEFAULT 'burning' CHECK (heat_level IN ('burning', 'hot', 'warm', 'cool', 'cold')),
  heat_updated_at     TEXT NOT NULL,
  reported_to_guards  INTEGER NOT NULL DEFAULT 0,
  bounty              INTEGER NOT NULL DEFAULT 0,
  witnesses           TEXT NOT NULL DEFAULT '[]',
  recovered           INTEGER NOT NULL DEFAULT 0,
  recovered_at        TEXT,
  fenced              INTEGER NOT NULL DEFAULT 0,
  fenced_at           TEXT,
  fenced_to           TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  FOREIGN KEY(item_id)     REFERENCES items(id)      ON DELETE CASCADE,
  FOREIGN KEY(stolen_from) REFERENCES characters(id),
  FOREIGN KEY(stolen_by)   REFERENCES characters(id)
);

CREATE INDEX IF NOT EXISTS idx_stolen_items_item   ON stolen_items(item_id);
CREATE INDEX IF NOT EXISTS idx_stolen_items_thief  ON stolen_items(stolen_by);
CREATE INDEX IF NOT EXISTS idx_stolen_items_victim ON stolen_items(stolen_from);
CREATE INDEX IF NOT EXISTS idx_stolen_items_heat   ON stolen_items(heat_level);

CREATE TABLE IF NOT EXISTS fence_npcs (
  npc_id               TEXT PRIMARY KEY,
  faction_id           TEXT,
  buy_rate             REAL NOT NULL DEFAULT 0.4,
  max_heat_level       TEXT NOT NULL DEFAULT 'hot',
  daily_heat_capacity  INTEGER NOT NULL DEFAULT 100,
  current_daily_heat   INTEGER NOT NULL DEFAULT 0,
  last_reset_at        TEXT NOT NULL,
  specializations      TEXT NOT NULL DEFAULT '[]',
  cooldown_days        INTEGER NOT NULL DEFAULT 7,
  reputation           INTEGER NOT NULL DEFAULT 50,
  FOREIGN KEY(npc_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- ── Corpses / Loot ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS corpses (
  id                   TEXT PRIMARY KEY,
  character_id         TEXT NOT NULL,
  character_name       TEXT NOT NULL,
  character_type       TEXT NOT NULL,
  creature_type        TEXT,
  cr                   REAL,
  world_id             TEXT,
  region_id            TEXT,
  position_x           INTEGER,
  position_y           INTEGER,
  encounter_id         TEXT,
  state                TEXT NOT NULL DEFAULT 'fresh' CHECK (state IN ('fresh', 'decaying', 'skeletal', 'gone')),
  state_updated_at     TEXT NOT NULL,
  loot_generated       INTEGER NOT NULL DEFAULT 0,
  looted               INTEGER NOT NULL DEFAULT 0,
  looted_by            TEXT,
  looted_at            TEXT,
  harvestable          INTEGER NOT NULL DEFAULT 0,
  harvestable_resources TEXT NOT NULL DEFAULT '[]',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  currency             TEXT DEFAULT '{"gold":0,"silver":0,"copper":0}',
  currency_looted      INTEGER NOT NULL DEFAULT 0,
  -- Corpse Ecology (#288) — see migration 0014. Additive; the legacy `state`
  -- enum/CHECK above is untouched, so D&D-style corpse usage is unaffected.
  death_at                    TEXT,
  cause_of_death              TEXT,
  decomposition_stage         TEXT NOT NULL DEFAULT 'fresh',
  preserve_inventory_snapshot TEXT NOT NULL DEFAULT '[]',
  recovered                   INTEGER NOT NULL DEFAULT 0,
  recovery_type               TEXT,
  is_landmark                 INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_corpses_encounter      ON corpses(encounter_id);
CREATE INDEX IF NOT EXISTS idx_corpses_world_position ON corpses(world_id, position_x, position_y);
CREATE INDEX IF NOT EXISTS idx_corpses_state          ON corpses(state);
CREATE INDEX IF NOT EXISTS idx_corpses_character      ON corpses(character_id);
CREATE INDEX IF NOT EXISTS idx_corpses_decomposition_stage ON corpses(decomposition_stage);

CREATE TABLE IF NOT EXISTS corpse_inventory (
  corpse_id TEXT NOT NULL,
  item_id   TEXT NOT NULL,
  quantity  INTEGER NOT NULL DEFAULT 1,
  looted    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(corpse_id, item_id),
  FOREIGN KEY(corpse_id) REFERENCES corpses(id) ON DELETE CASCADE,
  FOREIGN KEY(item_id)   REFERENCES items(id)   ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS loot_tables (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  creature_types       TEXT NOT NULL DEFAULT '[]',
  cr_min               REAL,
  cr_max               REAL,
  guaranteed_drops     TEXT NOT NULL DEFAULT '[]',
  random_drops         TEXT NOT NULL DEFAULT '[]',
  currency_range       TEXT,
  harvestable_resources TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_loot_tables_name ON loot_tables(name);

-- ── Improvisation / Custom Effects ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS custom_effects (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id          TEXT NOT NULL,
  target_type        TEXT NOT NULL CHECK (target_type IN ('character', 'npc')),
  name               TEXT NOT NULL,
  description        TEXT,
  source_type        TEXT NOT NULL CHECK (source_type IN ('divine', 'arcane', 'natural', 'cursed', 'psionic', 'unknown')),
  source_entity_id   TEXT,
  source_entity_name TEXT,
  category           TEXT NOT NULL CHECK (category IN ('boon', 'curse', 'neutral', 'transformative')),
  power_level        INTEGER NOT NULL CHECK (power_level BETWEEN 1 AND 5),
  mechanics          TEXT NOT NULL DEFAULT '[]',
  duration_type      TEXT NOT NULL CHECK (duration_type IN ('rounds', 'minutes', 'hours', 'days', 'permanent', 'until_removed')),
  duration_value     INTEGER,
  rounds_remaining   INTEGER,
  triggers           TEXT NOT NULL DEFAULT '[]',
  removal_conditions TEXT NOT NULL DEFAULT '[]',
  stackable          INTEGER NOT NULL DEFAULT 0,
  max_stacks         INTEGER NOT NULL DEFAULT 1,
  current_stacks     INTEGER NOT NULL DEFAULT 1,
  is_active          INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL,
  expires_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_custom_effects_target ON custom_effects(target_id, target_type);
CREATE INDEX IF NOT EXISTS idx_custom_effects_active ON custom_effects(is_active);
CREATE INDEX IF NOT EXISTS idx_custom_effects_name   ON custom_effects(name);

-- Synthesized spells (Arcane Synthesis mastery)
CREATE TABLE IF NOT EXISTS synthesized_spells (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id           TEXT NOT NULL,
  name                   TEXT NOT NULL,
  level                  INTEGER NOT NULL CHECK (level BETWEEN 1 AND 9),
  school                 TEXT NOT NULL,
  effect_type            TEXT NOT NULL,
  effect_dice            TEXT,
  damage_type            TEXT,
  targeting_type         TEXT NOT NULL,
  targeting_range        INTEGER NOT NULL,
  targeting_area_size    INTEGER,
  targeting_max_targets  INTEGER,
  saving_throw_ability   TEXT,
  saving_throw_effect    TEXT,
  components_verbal      INTEGER NOT NULL DEFAULT 1,
  components_somatic     INTEGER NOT NULL DEFAULT 1,
  components_material    TEXT,
  concentration          INTEGER NOT NULL DEFAULT 0,
  duration               TEXT NOT NULL,
  synthesis_dc           INTEGER NOT NULL,
  created_at             TEXT NOT NULL,
  mastered_at            TEXT NOT NULL,
  times_cast             INTEGER NOT NULL DEFAULT 0,
  UNIQUE(character_id, name)
);

CREATE INDEX IF NOT EXISTS idx_synthesized_spells_character ON synthesized_spells(character_id);
CREATE INDEX IF NOT EXISTS idx_synthesized_spells_school    ON synthesized_spells(school);

-- ── Concentration / Auras ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS concentration (
  character_id TEXT PRIMARY KEY,
  active_spell TEXT NOT NULL,
  spell_level  INTEGER NOT NULL CHECK (spell_level BETWEEN 0 AND 9),
  target_ids   TEXT,
  started_at   INTEGER NOT NULL,
  max_duration INTEGER,
  save_dc_base INTEGER NOT NULL DEFAULT 10,
  FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_concentration_character ON concentration(character_id);

CREATE TABLE IF NOT EXISTS auras (
  id                     TEXT PRIMARY KEY,
  owner_id               TEXT NOT NULL,
  spell_name             TEXT NOT NULL,
  spell_level            INTEGER NOT NULL CHECK (spell_level BETWEEN 0 AND 9),
  radius                 INTEGER NOT NULL CHECK (radius > 0),
  affects_allies         INTEGER NOT NULL DEFAULT 0,
  affects_enemies        INTEGER NOT NULL DEFAULT 0,
  affects_self           INTEGER NOT NULL DEFAULT 0,
  effects                TEXT NOT NULL,
  started_at             INTEGER NOT NULL,
  max_duration           INTEGER,
  requires_concentration INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(owner_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auras_owner ON auras(owner_id);

-- ── Event Inbox ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_inbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'npc_action', 'combat_update', 'world_change', 'quest_update',
    'time_passage', 'environmental', 'system'
  )),
  payload    TEXT NOT NULL,
  source_type TEXT CHECK (source_type IN ('npc', 'combat', 'world', 'system', 'scheduler')),
  source_id  TEXT,
  priority   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
  consumed_at TEXT,
  expires_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_event_inbox_unconsumed ON event_inbox(consumed_at) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_event_inbox_created    ON event_inbox(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_inbox_priority   ON event_inbox(priority DESC);

-- ── Audit / Misc ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  action    TEXT NOT NULL,
  actor_id  TEXT,
  target_id TEXT,
  details   TEXT,
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_logs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  type      TEXT NOT NULL,
  payload   TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patches (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  op        TEXT NOT NULL,
  path      TEXT NOT NULL,
  value     TEXT,
  timestamp TEXT NOT NULL
);

-- ── Narrative / Scenes ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS narrative_notes (
  id         TEXT PRIMARY KEY,
  world_id   TEXT NOT NULL,
  type       TEXT NOT NULL CHECK(type IN ('plot_thread', 'canonical_moment', 'npc_voice', 'foreshadowing', 'session_log')),
  content    TEXT NOT NULL,
  metadata   TEXT NOT NULL DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'dm_only' CHECK(visibility IN ('dm_only', 'player_visible')),
  tags       TEXT NOT NULL DEFAULT '[]',
  entity_id  TEXT,
  entity_type TEXT,
  status     TEXT DEFAULT 'active' CHECK(status IN ('active', 'resolved', 'dormant', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_narrative_notes_world   ON narrative_notes(world_id);
CREATE INDEX IF NOT EXISTS idx_narrative_notes_type    ON narrative_notes(type);
CREATE INDEX IF NOT EXISTS idx_narrative_notes_status  ON narrative_notes(status);
CREATE INDEX IF NOT EXISTS idx_narrative_notes_created ON narrative_notes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_narrative_notes_entity  ON narrative_notes(entity_id, entity_type);

CREATE TABLE IF NOT EXISTS scenes (
  id               TEXT PRIMARY KEY,
  world_id         TEXT NOT NULL,
  title            TEXT,
  when_label       TEXT,
  place_label      TEXT,
  narration        TEXT NOT NULL,
  engine_state     TEXT NOT NULL DEFAULT '{}',
  participants     TEXT NOT NULL DEFAULT '[]',
  previous_scene_id TEXT,
  created_at       TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scenes_world_time ON scenes(world_id, created_at DESC);

-- ── Agent Layer ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agents (
  id                   TEXT PRIMARY KEY,
  character_id         TEXT NOT NULL UNIQUE REFERENCES characters(id) ON DELETE CASCADE,
  provider             TEXT NOT NULL DEFAULT 'cloudflare',
  model                TEXT NOT NULL DEFAULT '@cf/meta/llama-3.1-8b-instruct',
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'retired')),
  auto_on_turn         INTEGER NOT NULL DEFAULT 0,
  temperature          REAL NOT NULL DEFAULT 0.7,
  max_tokens           INTEGER NOT NULL DEFAULT 512,
  budget_tokens        INTEGER,
  tokens_used          INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  circuit_state        TEXT NOT NULL DEFAULT 'closed' CHECK (circuit_state IN ('closed', 'open', 'half_open')),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agents_character    ON agents(character_id);
CREATE INDEX IF NOT EXISTS idx_agents_auto_on_turn ON agents(auto_on_turn) WHERE auto_on_turn = 1;

CREATE TABLE IF NOT EXISTS agent_prompt_slices (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('persona', 'directive', 'secrets', 'narrative_feed', 'recent', 'character_state', 'custom')),
  label       TEXT,
  content     TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_slices_agent_order ON agent_prompt_slices(agent_id, order_index);

CREATE TABLE IF NOT EXISTS agent_secrets (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  importance TEXT NOT NULL DEFAULT 'medium' CHECK (importance IN ('low', 'medium', 'high', 'critical')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_secrets_agent ON agent_secrets(agent_id);

CREATE TABLE IF NOT EXISTS agent_journal (
  id           TEXT PRIMARY KEY,
  agent_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('response', 'observation', 'plan', 'reflection', 'dm_note')),
  encounter_id TEXT,
  round        INTEGER,
  content      TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_journal_agent_time ON agent_journal(agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_calls (
  id                TEXT PRIMARY KEY,
  agent_id          TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  request_id        TEXT,
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  messages_json     TEXT NOT NULL,
  raw_response      TEXT,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  duration_ms       INTEGER,
  status            TEXT NOT NULL,
  error_message     TEXT,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calls_agent_time ON agent_calls(agent_id, created_at DESC);

-- ── Constraint-Perception ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subsystem_bindings (
  character_id TEXT NOT NULL,
  subsystem_id TEXT NOT NULL,
  bound_at     TEXT NOT NULL,
  PRIMARY KEY (character_id, subsystem_id)
);

CREATE INDEX IF NOT EXISTS idx_subsystem_bindings_subsystem ON subsystem_bindings(subsystem_id);

CREATE TABLE IF NOT EXISTS perception_assessments (
  id                        TEXT PRIMARY KEY,
  seq                       INTEGER NOT NULL,
  prev_seq                  INTEGER,
  event_hash                TEXT NOT NULL,
  intent_id                 TEXT NOT NULL,
  observer_id               TEXT NOT NULL,
  target_ref_kind           TEXT NOT NULL CHECK (target_ref_kind IN ('room','encounter','scene')),
  target_ref_id             TEXT NOT NULL,
  hazards                   TEXT NOT NULL DEFAULT '[]',
  applicable_controls       TEXT NOT NULL DEFAULT '[]',
  blind_spots               TEXT NOT NULL DEFAULT '[]',
  disposition               TEXT NOT NULL CHECK (disposition IN ('commit','reject_inert','no_op_spoken','unknown')),
  reject_reason             TEXT,
  cost_paid                 INTEGER NOT NULL DEFAULT 0,
  capacity_remaining_after  INTEGER NOT NULL DEFAULT 0,
  created_at                TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_perception_assessments_observer ON perception_assessments(observer_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_perception_assessments_target   ON perception_assessments(target_ref_kind, target_ref_id);

-- ── Map Editor (hexes + landmarks) ───────────────────────────────────────────
-- These two tables are NOT in Mnehmos; they back the /admin/map/* routes
-- consumed by holmgard-lore-editor's mapSync.ts.

CREATE TABLE IF NOT EXISTS hexes (
  q          INTEGER NOT NULL,
  r          INTEGER NOT NULL,
  map_id     TEXT NOT NULL DEFAULT 'main',
  terrain    TEXT,
  label      TEXT,
  data       TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (DATETIME('now')),
  PRIMARY KEY (q, r, map_id)
);

CREATE TABLE IF NOT EXISTS landmarks (
  id         TEXT PRIMARY KEY,
  map_id     TEXT NOT NULL DEFAULT 'main',
  q          INTEGER NOT NULL,
  r          INTEGER NOT NULL,
  name       TEXT NOT NULL,
  category   TEXT,
  data       TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (DATETIME('now'))
);

CREATE INDEX IF NOT EXISTS idx_landmarks_map    ON landmarks(map_id);
CREATE INDEX IF NOT EXISTS idx_landmarks_coords ON landmarks(q, r);

-- ── Entity Relations ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS entity_relations (
  id TEXT PRIMARY KEY,
  from_type TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_type TEXT NOT NULL,
  to_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  attitude INTEGER,
  is_bidirectional INTEGER DEFAULT 1,
  color TEXT,
  is_pinned INTEGER DEFAULT 0,
  is_private INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entity_relations_from ON entity_relations(from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_entity_relations_to ON entity_relations(to_type, to_id);

-- ── Timeline Engine (timeline-manage) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS timeline_events (
  id            TEXT PRIMARY KEY,
  world_id      TEXT NOT NULL,
  thread_id     TEXT NOT NULL DEFAULT 'main',
  event_at      TEXT NOT NULL,
  verb          TEXT NOT NULL,
  entity_id     TEXT,
  object_entity TEXT,
  location_id   TEXT,
  detail        TEXT,
  is_canonical  INTEGER NOT NULL DEFAULT 0,
  branch_id     TEXT,
  created_at    TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE,
  FOREIGN KEY(entity_id) REFERENCES characters(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_timeline_events_thread    ON timeline_events(thread_id, event_at);
CREATE INDEX IF NOT EXISTS idx_timeline_events_canonical ON timeline_events(is_canonical);
CREATE INDEX IF NOT EXISTS idx_timeline_events_branch    ON timeline_events(branch_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_entity    ON timeline_events(entity_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_location  ON timeline_events(location_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_world     ON timeline_events(world_id, event_at);

CREATE TABLE IF NOT EXISTS timeline_branches (
  id                 TEXT PRIMARY KEY,
  world_id           TEXT NOT NULL,
  name               TEXT NOT NULL,
  parent_branch_id   TEXT,
  forked_at_event_id TEXT NOT NULL,
  fork_reason        TEXT,
  is_active          INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES worlds(id) ON DELETE CASCADE,
  FOREIGN KEY(forked_at_event_id) REFERENCES timeline_events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_timeline_branches_world ON timeline_branches(world_id);

CREATE TABLE IF NOT EXISTS entity_knowledge (
  id             TEXT PRIMARY KEY,
  entity_id      TEXT NOT NULL,
  topic          TEXT NOT NULL,
  knowledge_type TEXT NOT NULL DEFAULT 'fact',
  source         TEXT,
  acquired_at    TEXT NOT NULL,
  detail         TEXT,
  confidence     INTEGER NOT NULL DEFAULT 100,
  is_current     INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(entity_id) REFERENCES characters(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_entity_knowledge_entity ON entity_knowledge(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_knowledge_topic  ON entity_knowledge(entity_id, topic);

-- ── Production Cycle (#283) ──────────────────────────────────────────────────
-- See migration 0013. world_state/characters columns are defined inline
-- above, at their existing table definitions.

CREATE TABLE IF NOT EXISTS production_calendar (
  id            TEXT PRIMARY KEY,
  world_id      TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  day           INTEGER NOT NULL,
  event_type    TEXT NOT NULL,
  event_data    TEXT,
  triggered     INTEGER NOT NULL DEFAULT 0,
  triggered_at  TEXT,
  resolved      INTEGER NOT NULL DEFAULT 0,
  UNIQUE(world_id, day, event_type)
);

CREATE INDEX IF NOT EXISTS idx_production_calendar_world_day ON production_calendar(world_id, day);

-- ── Resource Survival (#286) ─────────────────────────────────────────────────
-- See migration 0013.

CREATE TABLE IF NOT EXISTS resource_inventory (
  id                 TEXT PRIMARY KEY,
  world_id           TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  owner_type         TEXT NOT NULL CHECK(owner_type IN ('character', 'party')),
  owner_id           TEXT NOT NULL,
  item_name          TEXT NOT NULL,
  category           TEXT NOT NULL,
  quantity           INTEGER NOT NULL DEFAULT 1,
  degradation_timer  REAL,
  expires_on_day     INTEGER,
  spoiled            INTEGER NOT NULL DEFAULT 0,
  acquired_day       INTEGER,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_resource_inventory_owner ON resource_inventory(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_resource_inventory_world ON resource_inventory(world_id);

CREATE TABLE IF NOT EXISTS resource_owner_state (
  owner_type        TEXT NOT NULL CHECK(owner_type IN ('character', 'party')),
  owner_id          TEXT NOT NULL,
  world_id          TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  days_without_food INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL,
  PRIMARY KEY(owner_type, owner_id)
);

CREATE TABLE IF NOT EXISTS crate_drops (
  id          TEXT PRIMARY KEY,
  world_id    TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  day         INTEGER NOT NULL,
  x           INTEGER NOT NULL,
  y           INTEGER NOT NULL,
  contents    TEXT NOT NULL,
  claimed     INTEGER NOT NULL DEFAULT 0,
  claimed_by  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crate_drops_world_day ON crate_drops(world_id, day);

-- ── Broadcast & Production Intervention (#287) ───────────────────────────────
-- See migration 0013.

CREATE TABLE IF NOT EXISTS broadcast_approval (
  character_id  TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  world_id      TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  approval      INTEGER NOT NULL DEFAULT 50,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_broadcast_approval_world ON broadcast_approval(world_id);

CREATE TABLE IF NOT EXISTS broadcast_votes (
  id           TEXT PRIMARY KEY,
  world_id     TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  vote_type    TEXT NOT NULL,
  day          INTEGER NOT NULL,
  options      TEXT,
  result       TEXT,
  resolved     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  resolved_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_broadcast_votes_world ON broadcast_votes(world_id, resolved);

CREATE TABLE IF NOT EXISTS broadcast_interventions (
  id                   TEXT PRIMARY KEY,
  world_id             TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  day                  INTEGER NOT NULL,
  intervention_type    TEXT NOT NULL,
  target_character_id  TEXT,
  details              TEXT,
  created_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_broadcast_interventions_world ON broadcast_interventions(world_id, day);
