# Holmgard User Guide: The Lore Engine & Narrative Tools

## Overview

**Holmgard** is a collaborative storytelling system built on an **MCP (Model Context Protocol)** lore engine that tracks characters, locations, quests, NPCs, and world state. The system has two modes:

1. **AI Narrator Mode** (Shapes.inc chatbot) — The DM/narrator LLM reads player actions, consults the lore engine for world state and NPC behavior, and generates narrative responses.
2. **Player Mode** — Human roleplayers provide actions and dialogue; the narrator interprets them against the world and responds.

The **Holmgard MCP** (this project) is the backend that stores and retrieves the world state — everything from character stats to dialogue history to quest progress.

---

## How It Works: The Flow

```
Player: "Aldric approaches the tavern keeper and asks about the bandits."
     ↓
AI Narrator (Claude via Shapes.inc):
  1. Reads player action
  2. Calls MCP tools to fetch:
     - Character: Aldric (stats, background, knowledge)
     - Location: The tavern (description, NPCs, atmosphere)
     - NPC: Tavern keeper (personality, knowledge, disposition toward Aldric)
     - Related quests: Any active quests involving bandits
     - World state: Recent events that might affect responses
  3. Generates response:
     "The tavern keeper eyes you warily. [NPC voice/personality].
      They mention rumors of bandits near the Old Mill..."
     (Uses lore data to make the response consistent and world-aware)
  4. Calls MCP tools to update world state:
     - Mark that Aldric spoke to the tavern keeper
     - Update the tavern keeper's memory of Aldric
     - Flag the "bandits near Old Mill" rumor as known to Aldric
  5. Player sees the response and decides their next action
```

The cycle repeats — each interaction reads and writes to the lore engine, building a shared, persistent narrative.

---

## Tool Categories

### 1. **Lore Storage & Retrieval** (The Living Sourcebook)

These tools manage the raw lore — everything from character descriptions to world notes to dialogue logs.

| Tool | Used By | Purpose |
|------|---------|---------|
| `get_lore` | Narrator | Fetch a specific lore entry (character, location, NPC, quest) |
| `list_topics` | Narrator | Browse what lore entries exist in a category |
| `search_lore` | Narrator | Full-text search across all lore (find references to "the bandits" everywhere) |
| `set_lore` | Narrator | Create or update a lore entry (add a character backstory, update a location description) |
| `patch_lore` | Narrator | Small edits to existing lore (add a line to dialogue, mark a quest step complete) |
| `get_topic_histories` | Narrator | View all past versions of a lore entry (see how a character's disposition has changed) |

**Example Use:**

```
Narrator needs to recall the tavern keeper's personality:
  get_lore("npc:tavern_keeper_oldmill")
  → { text: "**Name:** Orm the Gruff\n**Disposition:** Suspicious of outsiders...", 
       meta: { updatedAt: "2025-06-08T14:22:00Z" } }

Narrator updates the lore after the conversation:
  patch_lore("npc:tavern_keeper_oldmill", 
    { action: "append", target: "## Known Relations", 
      text: "\n- Aldric: Cautious but cooperative. Shared info about bandits." })
```

---

### 2. **Character & Party Management** (Who Is In This Story?)

Track player characters, NPCs, companions, and groups.

| Tool | Used By | Purpose |
|------|---------|---------|
| `character_manage` (create, get, list, update) | Narrator | Create NPCs or track player character details (inventory, stats, relationships) |
| `party_manage` (create, join, list_members) | Narrator | Group characters into adventuring parties or factions |

**Example Use:**

```
Narrator creates the tavern keeper as an NPC:
  character_manage({ action: "create", name: "Orm", characterType: "npc", 
                     background: "Refugee from the Old Mill, now runs the tavern" })

Narrator checks a player's current inventory:
  character_manage({ action: "get", id: "player:aldric" })
  → { name: "Aldric", inventory: ["longsword", "rope", "healing_potion"] }
```

**Known Behavior (#398):** `character_manage`'s `kill` action now auto-removes the dying character
from every party they belonged to and returns a `partyUpdates` array (`{ partyId,
remainingMembers, archived, soloSurvivorId }` per party) — no need to manually call party cleanup
after a death. If a party reaches 0 members it's auto-archived (`status: "archived"`); if exactly
1 member remains, that character's id is surfaced as `soloSurvivorId` for the narrator to act on.
This does **not** call `rpg{sub:"party", action:"group_break"}` despite that being named in the
original issue — `group_break` fully disbands a party (removes *every* member) regardless of
`method`, so calling it per-death would incorrectly evict every living member over one character's
death. The party-membership cleanup here only ever removes the one dead character's own row.

---

### 3. **World & Location Mapping** (Geography & Exploration)

Track locations, regions, and how the world is connected.

| Tool | Used By | Purpose |
|------|---------|---------|
| `world_manage` | Narrator | Create worlds and manage geography |
| `world_map` | Narrator | Get a spatial overview of locations and distances |
| `spatial_manage` | Narrator | Track which entities are at which location (who's in the tavern right now?) |
| `get_location_occupants` | Narrator | Quick lookup: who/what is at this location? |
| `rpg{sub:"waypoint"}` | Narrator | Real-world-anchored named locations + precomputed travel distances between them (Gotland campaign, #328) |

**Real-world-distance party movement (`rpg{sub:"waypoint"}` + `rpg{sub:"party"}`, #328):**

For a Gotland-set campaign, `waypoint.seed_defaults({worldId})` seeds four named
places (Visby, Roma Kloster, Fårösund, Klintehamn) with real lat/lon, a
derived hex `(q, r)`, and precomputed real foot-routing distances between
every pair. A party then moves with `party.begin_march({partyId,
fromWaypointName, toWaypointName})`, and a narrator resolves a day's travel
for every marching party in a world with the exported `tickAllPartiesMarch()`
helper (deliberately not wired into `production.advance_day`, which ticks the
whole world's hazard/weather/degradation — movement resolves per-party so one
party's march never blocks on another's turn). An unrouted pair returns a
structured `{blocked: true, reason: 'no_route_found' | 'not_precomputed'}`
response, never a tool error.

**Known Behavior:** the offline precompute script (`scripts/gotland-precompute-distances.mjs`)
was expected to demonstrate the "no route" case at Fårösund (the plan assumed
no bridge exists in the foot-routing graph). In practice, OSRM's foot profile
finds a route across every pair in the seeded 4-waypoint set, including
Fårösund — apparently via the free ferry crossing — so the shipped seed data
has no real example of an unroutable pair; the `not_precomputed`/`no_route_found`
paths are exercised by unit tests against synthetic fixture data instead.

**Known Behavior (#399):** `waypoint.register`'s `lat`/`lon` are only required for a world that
has been geo-calibrated via `waypoint.calibrate`. A purely grid/hex world that never calibrates
can register a waypoint with just `q`/`r` — `lat`/`lon` are stored as `null` rather than forcing
callers to fabricate placeholder coordinates. For a calibrated world, `lat`/`lon` remain required
on `register` (dropping real geo data silently would be worse than requiring it).

**Example Use:**

```
Narrator checks who's at the tavern:
  get_location_occupants("location:oldmill_tavern")
  → [ "npc:orm_tavern_keeper", "player:aldric", "npc:acolyte_mysterious" ]

Narrator moves a character:
  entity_manage({ action: "move", entity_key: "player:aldric", 
                   new_location_key: "location:oldmill_road_north" })
```

---

### 4. **Quest & Objective Tracking** (What Are We Doing?)

Define quests, steps, and how they progress.

| Tool | Used By | Purpose |
|------|---------|---------|
| `quest_manage` | Narrator | Create quests, mark steps complete, check status |
| `set_goal` | Narrator | Track long-term party goals |

**Example Use:**

```
Narrator creates a quest:
  quest_manage({ action: "create", worldId: "world:holmgard", name: "Bandit Menace", 
                 objectives: [{ description: "Investigate bandits near the Old Mill" }] })

Narrator marks a step complete:
  quest_manage({ action: "complete_objective", questId: "quest:bandit_menace",
                 objectiveIndex: 0 })
```

---

### 5. **Combat & Encounters** (When Things Get Tense)

Manage combat scenarios, turn order, and encounter state.

| Tool | Used By | Purpose |
|------|---------|---------|
| `combat_manage` | Narrator | Create/track encounters, manage initiative and turn order |
| `combat_action` | Narrator | Resolve player or NPC actions during combat |
| `combat_map` | Narrator | Visualize combatants and distances (d&d grid or narrative distance) |

**Example Use:**

```
Narrator starts combat with bandits:
  combat_manage({ action: "create_encounter",
                  tokens: [
                    { id: "bandit_1", name: "Bandit", type: "enemy" },
                    { id: "bandit_2", name: "Bandit", type: "enemy" },
                    { id: "bandit_leader", name: "Bandit Leader", type: "enemy" }
                  ] })

Narrator resolves Aldric's attack:
  combat_action({ action: "attack", actorId: "player:aldric", 
                  targetIds: ["bandit_1"], attackRoll: 18 })
```

**Known Behavior (#314):** Characters have a `death_mode` field — `"instant"` (default) for
normal combat death, or `"staged"` for a narrator-controlled multi-stage dissolution process
(Mycelium integration, parasitic assimilation, dispatch protocols, etc.) that unfolds over hours,
days, or weeks. `combat_action`'s `attack` action **rejects outright** (no roll, no damage) when
any target has `death_mode: "staged"` — staged characters are non-combatants and must not be
attacked by a tactical/combat agent. Set/inspect the fields via `character_manage`'s `update`
action: `deathMode`, `dissolutionStage`, `dissolutionStages`, `dissolutionTerminal`,
`dissolutionId`. There's no fixed stage-name enum or assumed stage count — different staged
mechanisms can coexist across characters with their own stage counts and terminal states.

**Known Behavior (#315):** Co-habitating characters (multiple consciousnesses sharing one
physical body — see `character_manage`'s `host_body_id`/`active` fields from #226) now resolve
correctly through `drama_manage` and `combat_action`. `drama_manage`'s ability checks
(`roll_ability`, `opposed_check`, `group_check`, `social_combat`, `dramatic_conflict`) split
stats when the referenced character id is (or belongs to) a co-habitation group: physical
abilities (`str`/`dex`/`con`) always resolve from the host body, mental abilities
(`int`/`wis`/`cha`) resolve from whichever consciousness currently has `active = 1` (the
"driver"), and the reported character name follows the driver. `combat_action`'s `apply_damage`
and `heal` redirect to the host body's shared HP pool when aimed at a passenger consciousness's
own character id, rather than mutating a separate (and narratively meaningless) `hp` field on
that row. `character_manage`'s `activate`/`list_passengers` gained `set_driver`/`get_driver`
aliases matching the issue's proposed naming — no new mechanics, same actions. Per narrator Q&A
on #315: driver switching is narrator discretion (a story beat), not a mechanical action-cost or
contested roll — there was no tactical grid use case to design a contest DC for.

**Known Behavior (#411):** `entity_manage`'s `advance_stage` action now mirrors its KV
`State-Stage` advance into D1's `characters.dissolution_stage` whenever the entity resolves (via
`meta.d1_id`, or a case-insensitive name match — see `resolveEntityToCharacterId`) to a character
whose `death_mode` is already `"staged"` (#314). The response gains a `d1_mirrored: boolean`
field. This closes a real drift risk: `combat_action.attack`'s staged-rejection guard reads D1's
`dissolution_stage`, but narrators track stage progression through KV via `advance_stage` — without
the mirror, the two could disagree about which stage a character is on. No workflow change for the
caller; the mirror only fires for characters already marked `staged`, and only on `advance_stage`
(not `batch_stage`, which advances a whole location's entities at once and wasn't part of this
fix's scope).

**Known Behavior (#410):** `resolve_interaction`, `analyze_utility`, and `get_compatibility` now
read entity interaction attributes (Weight-1, Weight-2, Tenderness-Index, Cortisol-Level, or any
campaign-defined numeric field) from a D1-backed `entity_attributes` table first, falling back to
KV lore markdown parsing when no row exists — so nothing that worked before #410 stops working,
but a D1 row now wins over conflicting KV text. Two new `entity_manage` actions manage that table:
`get_attributes` (read) and `set_attributes` (write; `merge: true` by default folds new fields into
the existing set instead of replacing it wholesale). A row is dual-keyed by `lore_key` (Archisector's
`character:guard-1` style) and an opportunistically-resolved `character_id` (Calder's D1 UUIDs, via
the same `resolveEntityToCharacterId` used by #344/#411) — `set_attributes` only requires the KV
`entity_key`, and stores whichever identity axis resolves. `analyze_utility`'s response gains
`d1_attributes_used: boolean` and each `breakdown` entry gains `source: 'd1' | 'kv'`;
`resolve_interaction`'s metadata and `get_compatibility`'s response both gain
`weight_1_source`/`weight_2_source`. Populating D1 rows from existing KV lore is a campaign-side
migration, not automatic — per the issue's own non-goals, #410 does not backfill or change the
underlying interaction-probability formula (still the 70% ceiling, binary-outcome model).

**Known Behavior (#423, #424):** the `rpg` sub-schema for `world_map` (`load_tool_schema({toolName:
"rpg", sub: "world_map"})`, and its `maps` alias) previously described a square-grid model — actions
`generate`/`get_hex`/`get_region`/`list_regions`/`set_hex`/`get_map` with `x`/`y` coordinates — that
never existed at runtime; the handler was rewritten to hex-axial `q`/`r` coordinates and 12 different
actions (`overview`, `region`, `hexes`, `patch`, `batch`, `preview`, `find_poi`, `suggest_poi`,
`update_poi`, `query_zone`, `list_zones`, `render_svg`) back in #320, but the schema-advertisement
layer was never updated to match (#423). The schema now reflects the real handler, including its
alias actions (e.g. `update`/`modify` → `patch`, `tiles`/`hex_data` → `hexes`, `svg`/`export_svg` →
`render_svg`). Separately (#424), `load_tool_schema({toolName: "rpg"})` with no `sub` now returns an
`aliases` map (`{"maps":"world_map","stealth":"perception","characters":"character",
"npc_dialogue":"npc"}`) alongside the base schema, so the sub-name-vs-alias distinction — previously
invisible in the flat `sub` enum — is discoverable without reading source.

**Known Behavior (#425):** `character`, `world`, `party`, `secret`, and `quest`'s `update` actions,
plus a new `production.update_state` action, now accept an optional `fields` object — arbitrary
D1 column key-value pairs forwarded straight to the SQL `UPDATE ... SET` clause, blacklisted rather
than whitelisted (only `id`/`created_at`/`updated_at` and each table's ownership column, e.g.
`world_id`, are protected). This closes a real gap audited across the codebase: every one of these
handlers hardcoded an explicit Zod whitelist of updatable columns, so a migration that added a new
column left it permanently unreachable through MCP until someone remembered to also touch the
handler. Found on `characters` (9 columns from migration `0003` plus `production_state`, the worst
case — the single most-migrated table in the schema), `worlds.universe_id`, `world_state`'s
`production_mood`/`era`/`tick_speed` (zero writers anywhere — `world_state` has no single owning
handler, split across `time-manage.ts`/`production-manage.ts`, hence the new `production.update_state`
action rather than extending an existing `update`), five `parties` columns, most of `secrets`, and
`quests.rewards`/`prerequisites` (already declared in the Zod schema but never wired into the
`update` case — fixed directly as first-class params, not via `fields`, since Zod already validated
them). Response gains `fields_applied`/`fields_rejected` (the latter with a `reason`:
`'blacklisted'` or `'invalid column name'`) whenever `fields` is passed. An explicit param always
wins over the same key in `fields` — the passthrough entry is silently skipped, not an error. Column
names are validated against a strict snake_case shape (`^[a-z][a-z0-9_]*$`) before being interpolated
into the SQL text — that's the actual SQL-injection boundary, since identifiers can't be parameterized
as `?` bindings the way values can; D1 is the final type validator for the values themselves (a
bad-typed value surfaces as a D1 error, not a schema mismatch caught here). Shared implementation:
`src/rpg/utils/dynamic-fields.ts`'s `applyDynamicFields()`.

**Known Behavior (#420):** `entity_manage`'s `advance_stage` action now reacts when it detects
`is_terminal` — previously the terminal stage was reported in the response but nothing else

**Known Behavior (#441):** `entity_manage`'s `advance_stage` action applies **Phase 0 dissolution primitives** when advancing through a staged-death cycle. Each stage (1–5) writes cumulative sensory-mutation fields to KV entity text (`Dissolution-Scent`, `Dissolution-Thermal`, `Dissolution-Texture`, `Dissolution-Visual`, `Dissolution-Sound`) plus mechanical flags (`Movement-Locked`, `Communication-Penalty`, `Knowledge-Leakage`). On terminal stage, the action resolves the conversion pathway from the character's `dissolution_terminal` field and writes the conversion outcome (`Dissolution-Conversion`, `Dissolution-Conversion-Label`). HP drain (per-tick from mechanical effects table) is applied atomically via D1 `db.batch` alongside the stage mirror update. The resolved/flagged split from #440 Gap 3 is **not yet implemented** — stage transitions auto-advance when called; the narrator calls `advance_stage` explicitly.

**Known Behavior (#472, config-driven dissolution beyond stage 5):** the 5-stage cap from #441 is no longer hardcoded. `advance_stage` resolves a `DissolutionConfig` for the entity before applying mutations, in this order: a per-instance config at KV key `dissolution:config:<dissolution_id>` (keyed by the linked D1 character's `dissolution_id` column — write one directly to KV the same way any other narrator-authored content is written, no admin tool exists for this yet) → the seeded default config at `dissolution:config:phase0-5` (written by `seedDissolutionConfigKV`, not yet run automatically on deploy) → the in-memory 5-stage default. This means Subject #12-style proximity-gated stage counts, or any narrator-authored N-stage transformation (e.g. a 20-stage human→living-statue arc), actually get real sensory/mechanical mutations applied at every stage — previously (#471) any stage past 5 silently produced nothing at all, with no error and no indication in the response. If an entity's own tracked stage total (KV `State-Total`) exceeds what its resolved config actually defines — a mismatched or too-short config, not expected steady-state — the response now includes `dissolution.stage_exceeds_config: true` instead of silently doing nothing.

**Known Behavior (#429):** `rpg{sub:"travel"}`'s `move_hex` action accepts an optional `mode`
(`foot`/`horse`/`carriage`/`car`/`aircraft`, defaults `foot`) and now enforces terrain passability —
previously it moved the party to any hex regardless of biome. Passability and speed come from the
destination hex's biome (the existing per-world dynamic registry from `rpg{sub:"biome"}`, #274), via
a new optional `modeCosts` field on `biome.register`/`biome.update` — a JSON object of per-mode cost
overrides using the *same semantics* as the pre-existing `movementCost` field (higher = slower,
`0` = impassable; **not** the inverse speed-fraction convention some proposals use). A mode absent
from `modeCosts` falls back to `movementCost`, so every existing biome/world is unaffected until a
narrator opts a mode in. `move_hex` returns `effectiveSpeedKmPerDay` (mode's base km/day ÷ effective
cost) and rejects the move with an error (party position unchanged) when the effective cost is `0`
for the requested mode. Deliberately **no hardcoded biome-name matrix and no river-depth-threshold
system** — biomes are per-world freeform data (a Gotland world's `pine`/`marsh`/`ravine` don't exist
on an Accord States world), and there is no real depth data anywhere to hang meter thresholds on
(`hexes.moisture` is a generic 0–100 terrain-generation value, not literal water depth; the old
`rivers` table is dead — square-grid coordinates, zero code references, retired before the hex-grid
rewrite). Rivers are modeled the same way as any other terrain: a narrator registers a `river`-style
biome with per-mode costs (e.g. `carriage`/`car` → `0`, `foot`/`horse` → a slower-but-passable value)
— no new schema, no fabricated numbers. Consumables tracking is out of scope, per the issue's own
scope note. Mode base speeds (`TRAVEL_MODE_BASE_SPEED_KM_PER_DAY` in `travel-manage.ts`) are
hardcoded game-balance constants, not per-world narrative data — reused by `world_map.distance`
(#430) for multi-hex ETA estimates.

**Known Behavior (#431):** the "no river-depth-threshold system" call above was revisited — the
maintainer explicitly requested a `water_depth` column and the `≤0.6m`/`0.6–1.2m`/`>1.2m` fording
table as an *additional* opt-in layer, not a replacement for #429's biome mechanism, resolving the
data-provenance objection (these are now maintainer-specified game-balance thresholds, not guessed
narrative data). `hexes` gained a nullable `water_depth` (meters) column, settable via
`world_map.patch`/`batch`'s `waterDepth` field (`null` = no explicit fording rule, defers entirely to
the hex's biome cost — every existing hex/world unaffected by default). When set, `water_depth`
**overrides** the biome cost for that hex on `move_hex` for `foot`/`horse`/`carriage`/`car`
(`fordingCost()` in `travel-manage.ts`): `≤1.2m` is fordable by `foot`/`horse` at half speed
(`swimRisk: true` in the response once past `0.6m`, signaling the narrator should call a CON check),
`>1.2m` or any depth at all for `carriage`/`car` is impassable. `aircraft` always ignores
`water_depth` entirely ("irrelevant" per both issues) and falls through to the normal biome cost.
A hex can carry both a `river`-style biome (coarse, always-on passability) and an explicit
`water_depth` (fine-grained, opt-in per hex) — when both are present, `water_depth` wins.

**Known Behavior (#430):** `world_map` gains `distance` and `pathfind` actions — `distance` takes
`worldId`/`from`/`to`/`mode` and computes hex-axial `hexDistance` (always available), plus, only when
the world is geo-calibrated (`waypoint.calibrate`), `straightLineKm` (exact hex-to-pixel Euclidean
geometry, reusing the same formula as `hexToLatLon`/`hexToPixel` — **not** `hexDistance × kmPerHex`,
which is a coarser approximation), a per-biome `terrainBreakdown` (hex counts, and km once
calibrated) sampled along the direct hex line between `from`/`to`, and `estimatedTravelDays` (`null`
if uncalibrated, or if any hex on the direct line is impassable for `mode` — flagged in `warnings`
rather than silently averaged into a misleading day estimate). `pathfind` adds `avoid` (an array of
strings matched against **dynamic** biome names or `zone_type` values — not a hardcoded taxonomy,
per #429's design note) and runs a real A* over hex neighbors, bounded to a padded bounding box around
`from`/`to` (capped search, `routable: false` with a `reason` if the search space is exhausted or no
route exists) rather than scanning an entire world's hex table. Returns `path` (array of
`{q,r,biome}`), `totalHexSteps`, `totalKm`/`totalDays` (same geo-calibration gating as `distance`,
summed per-step along the actual path — not the straight line), and `warnings` for any zone the path
crosses (reusing this file's own `parseZoneShape`/`pointInZone`, queried once per call rather than
per-node via `resolveZonesAt`, to avoid a query-per-A*-node storm). Both actions reuse #429/#431's
per-hex effective cost (biome `movementCost`/`modeCosts`, overridden by an explicit `water_depth`
fording rule when set) rather than reimplementing terrain math — one cost function, three consumers
(`move_hex`, `distance`, `pathfind`).

---

### 6. **NPC & Personality Systems** (Making NPCs Feel Alive)

Tools for creating consistent, believable NPC behavior and dialogue.

| Tool | Used By | Purpose |
|------|---------|---------|
| `npc_manage` | Narrator | Create NPCs with personality, goals, fears, allies |
| `aura_manage` | Narrator | Track ongoing spells, abilities, or effects on NPCs/locations |
| `get_sensory_profile` | Narrator | What does an NPC sense/perceive in their location? |

**Example Use:**

```
Narrator creates an NPC with personality:
  npc_manage({ action: "create", name: "Orm", 
               personality_traits: ["gruff", "protective", "shrewd"],
               goals: ["protect the Old Mill", "profit from travelers"],
               fears: ["losing the tavern"] })

Narrator checks what Orm might sense when danger approaches:
  get_sensory_profile("npc:orm", "oldmill_tavern")
  → { hears: "hoofbeats, shouting outside", 
       smells: "smoke and blood", sees: "commotion through window" }
```

---

### 7. **Memory & Relationships** (Continuity & Depth)

Track character knowledge, relationships, and how they change.

| Tool | Used By | Purpose |
|------|---------|---------|
| `get_relationship` | Narrator | How do two characters feel about each other? (friendly, hostile, romantic, business) |
| `get_entity_knowledge` | Narrator | What does a character know about a topic/location/person? |
| `secret_manage` | Narrator | Hide information from players until the reveal moment |
| `find_by_tag` | Narrator | Find all lore entries tagged with a theme (e.g., "all prophecies", "all treasures") |

**Example Use:**

```
Narrator checks Orm's relationship with Aldric:
  get_relationship("npc:orm", "player:aldric")
  → { disposition: "cautious_cooperation", history: ["shared rumors about bandits"] }

Narrator adds a hidden secret (revealed later):
  secret_manage({ action: "create", worldId: "world:holmgard", name: "Orm's Brother",
                  publicDescription: "Orm has a brother he never speaks of.",
                  secretDescription: "Orm's brother leads the bandit gang; internal conflict",
                  linkedEntityId: "npc:orm" })
```

---

### 8. **World Events & Continuity** (Keeping the Timeline)

Manage the passage of time, events that ripple across the world, and long-term consequences.

| Tool | Used By | Purpose |
|------|---------|---------|
| `thread_tick` | Narrator | Advance the world one time step (1 hour, 1 day, 1 week) and resolve queued events |
| `recent_changes` | Narrator | What's changed in the world recently? (NPC moved, location was damaged, quest resolved) |
| `append_event` | Narrator | Log a major world event for the historical record |
| `check_convergence` | Narrator | Do two separate story threads (party A and party B) ever meet? Where and when? |

**Example Use:**

```
Narrator advances time at the end of a session:
  thread_tick("main_timeline", duration: "1_day")
  → Resolves: bandits patrol the roads, NPCs move around, rumors spread

Narrator checks what changed in the world:
  recent_changes(since: "6_hours_ago")
  → [ "Bandits robbed a caravan near the bridge",
       "Orm closed the tavern temporarily", 
       "A mysterious stranger arrived at the inn" ]
```

**Known Behavior (#311):** `continuity_manage[get_event_log]` accepts an optional `tier` param
(e.g. `"high"` or `"high,medium"`) that filters events against the D1 `event_verb_taxonomy` table
instead of (or alongside) an explicit `verbs` list — useful when a second agent generates high
event volume and you only want the narratively significant ones. Requires D1: unlike this tool's
other filters, an explicit `tier` request **errors** rather than silently returning unfiltered
results if `RPG_DB` is unavailable. The taxonomy itself is runtime-mutable via three new actions —
`taxonomy_list`, `taxonomy_set` (upsert, no code deploy needed to classify a new verb),
`taxonomy_delete` — so either narrator agent can extend the seeded 63-verb list as new
domain-specific vocabulary comes up in actual sessions.

**Known Behavior (#312):** `rpg{sub:"time"}`'s `advance` action accepts an optional `owner`
param — a caller self-identifier string (e.g. `"archisector"`, `"calder-architect"`) — that
guards against two narrator agents advancing the same world's clock underneath each other. If
the world's clock is unowned, an identified caller implicitly claims it (`time_owner` on
`world_state`); if owned by a *different* identified caller, `advance` is rejected with no state
change. `set_owner` (pass `owner: null` to release) and `get_owner` manage this explicitly.
**Callers that omit `owner` advance unguarded, same as before this existed** — the lock is
opt-in, not enforced globally, since most existing callers (including all pre-#312 tests) never
identify themselves. This exists for the real dual-agent case confirmed via narrator Q&A:
Archisector (early eras, hours/days/consumption-stage ticks) and the Calder Architect (later
eras, quarters/Judicial-Council sessions) both call this MCP against the same world's timeline —
not a hypothetical narrative-vs-tactical split.

---

### 9. **Scene & Narrative Tools** (Structuring the Story)

Manage scenes, player choices, and narrative pacing.

| Tool | Used By | Purpose |
|------|---------|---------|
| `scene_brief` | Narrator | Get a quick summary of a scene: who's there, what's happening, what's at stake |
| `activate_scene` | Narrator | Formally start a scene (locks time, sets stakes) |
| `present_choices` | Narrator | Offer multiple options to players and track which they choose |
| `commit_choice` | Narrator | Log player choice and resolve its consequences |

**Example Use:**

```
Narrator starts a scene:
  activate_scene({ name: "Confrontation at the Crossroads", 
                   location: "location:crossroads", 
                   participants: ["player:aldric", "bandit_leader"] })

Narrator offers choices:
  present_choices({ scene_id: "scene_crossroads", 
                    options: ["Fight!", "Negotiate", "Run"] })

Player chooses "Negotiate":
  commit_choice({ scene_id: "scene_crossroads", player_choice: "Negotiate" })
  → Triggers dialogue with bandit leader, reputation changes, quest updates
```

**Known Behavior (#350):** `commit_choice` additionally writes a best-effort `"chose"` row to D1
`timeline_events` whenever `entity_key` resolves to a real D1 character with a `world_id` set (via
the same `meta.d1_id` / name-match lookup `get_inventory` uses). The response's `timeline_event_id`
field carries the new event's id, or `null` when no D1 character/world_id could be resolved — this
is silent and never blocks or errors the KV choice commit itself. `scene_manage` (this KV-backed
tool) and the D1-backed `rpg scene` sub remain otherwise separate systems; this is a narrow bridge
for committed-choice visibility only, not a full unification — see the open architecture question
on #350.

**Known Behavior (#316):** The D1-backed `rpg scene` sub can tag a scene with a `conflict_type`
(`set_conflict_type`/`get_conflict_type` actions) from the global `conflict_types` taxonomy
(`rpg{sub:"conflict_type"}` — seeded `physical`/`social`/`hybrid`, runtime-extensible). Each type
has a `resolver` (`combat`/`drama`/`both`) indicating which agent should act on the scene — but
this MCP only records that label; it cannot enforce which agent actually resolves a scene. Routing
is a convention the calling agent(s) honor, the same way #312's time-mode coordination works.

---

### 10. **AI Agent Tools** (Semi-Autonomous NPCs)

For advanced campaigns, spawn AI-driven NPCs that act autonomously with goals and memory.

| Tool | Used By | Purpose |
|------|---------|---------|
| `agent_manage` | Narrator | Create an NPC with semi-autonomous goal-driven behavior |
| `invoke` (agent action) | Narrator | Ask the agent "What would you do in this situation?" and get AI-generated intent |
| `get_journal` | Narrator | Read the agent NPC's internal thoughts/observations |

**Example Use:**

```
Narrator creates an autonomous bandit leader agent, then adds its prompt slices
(slices are set individually via `set_slice`, not passed inline to `create`):
  agent_manage({ action: "create", characterId: "bandit_leader" })
  agent_manage({ action: "set_slice", agentId: "<returned agent id>",
                 kind: "persona", content: "ruthless, intelligent, protective of gang" })
  agent_manage({ action: "set_slice", agentId: "<returned agent id>",
                 kind: "directive", content: "expand territory, avoid direct confrontation with adventurers" })

Narrator asks what the bandit leader does when alone:
  agent_manage({ action: "invoke", agentId: "<returned agent id>",
                 situation: "Your scouts report the adventurers are asking about you in the tavern." })
  → "I move camp further north and send a scout to watch them. Too risky to be seen yet."
```

---

### 11. **Utility & Meta Tools** (Tools About Tools)

| Tool | Used By | Purpose |
|------|---------|---------|
| `search_tools` | Narrator | Find a specific tool by name or description |
| `load_tool_schema` | Narrator | Get detailed documentation of a tool (parameters, examples) |
| `math_manage` (dice rolls, etc.) | Narrator | Roll dice, generate random numbers, handle probability |

#### Dice Notation Reference

`math_manage` isn't directly callable — invoke it via `rpg({ sub: "math", action: "roll", expression: "..." })`. Full parameter docs are available via `load_tool_schema({ toolName: "math_manage" })`.

**Grammar:** `[count]d(sides|%|F)[r1][dl|dh|kl|kh N][!][+/-N][>N]`

| Piece | Meaning |
|---|---|
| `count` | Number of dice (default 1) |
| `d100` / `d6` / etc. | Normal die with that many faces |
| `d%` | Percentile die (equivalent to `d100`) |
| `dF` | Fudge/Fate die — each die shows `-1`, `0`, or `+1` |
| `r1` | Reroll any natural 1 once (the new value is kept even if it's also a 1) |
| `dlN` / `dhN` | Drop the lowest/highest `N` dice |
| `klN` / `khN` | Keep only the lowest/highest `N` dice — **this is also how advantage/disadvantage are expressed**, e.g. `2d20kh1` (advantage) / `2d20kl1` (disadvantage). There's no separate `adv`/`dis` keyword. Only one of `dl`/`dh`/`kl`/`kh` may appear per expression. |
| `!` | Exploding dice — a natural max face rerolls and adds, chaining while max keeps coming up |
| `+N` / `-N` | Flat modifier |
| `>N` | Count successes instead of summing — kept dice rolling greater than `N` become the result (response has `successes` instead of a plain total). Cannot combine with a flat modifier (ambiguous), and isn't meaningful on percentile/Fudge dice. |

**Worked examples:**

| Expression | Meaning |
|---|---|
| `2d6+3` | Two d6 plus 3 |
| `4d6dl1` | Classic ability-score roll: 4d6, drop the lowest |
| `2d20kh1+5` | Attack roll with advantage, +5 to hit |
| `2d20kl1` | Disadvantage |
| `d%` | Percentile roll, 1-100 |
| `4dF` | Four Fudge dice, total -4 to +4 |
| `2d6r1` | Reroll any 1s once |
| `5d10>7` | Dice-pool success count (World of Darkness/Shadowrun style) |
| `1d20!` | Exploding d20 |

**Critical hit/fumble:** `roll`'s response includes a `critical: "success" | "failure" | null` field, but **only** when the expression is a single d20 check (`1d20`, with or without `!`/modifier) or an advantage/disadvantage pair (`2d20kh1` / `2d20kl1`). The field is **omitted entirely** (not even `null`) for anything else — dice pools (`8d20`), non-d20 dice, percentile/Fudge dice, and success-counting rolls — so a caller can safely check `"critical" in result` to know whether the roll was crit-eligible at all. `"success"` = natural 20, `"failure"` = natural 1, `null` = neither.

**Roll history:** every `roll` and `probability` call is persisted. Pass a `sessionId` when rolling to tag it, then retrieve past calculations with `rpg({ sub: "math", action: "get_history", sessionId, kind: "roll" | "probability", limit, calculationId })`.

**A note on `seed`:** the `roll`/`probability` actions accept an optional `seed` string, but it is currently **cosmetic only** — it's stored alongside the calculation for record-keeping but does not make the roll reproducible. Randomness is otherwise cryptographically backed (`crypto.getRandomValues`) rather than `Math.random()`.

**Known Behavior:** as of #210, the dice engine is now used by `combat_action.attack` (1d20 hit check + configurable `damageExpression` for damage, with critical hit doubling), `combat_manage.death_save` (1d20, native nat-1/nat-20 logic preserved), `perception_manage` (assess/stealth_check/perception_contested all use 1d20), `aura_manage.check_save` (1d20 concentration save), and `travel_manage` (1d100 encounter flag, 1d3 loot count). The weighted loot table in `travel_manage.rollLoot` and the weighted probability/selection rolls in `entity_manage`'s `resolve_interaction`/`roll_encounter` remain `Math.random()`-based — these are weighted random choice mechanics, not die rolls, and forcing them through dice notation would be unnatural.

---

## For the AI Narrator (Shapes.inc Chatbot)

### Guidelines for Effective Tool Usage

1. **Read First, Act Second**
   - Always fetch relevant lore before generating a response
   - Check character knowledge before having an NPC reveal something
   - Verify location state before describing NPCs present

2. **When Unsure of a Tool's Parameters, Ask the Server — Don't Guess**
   - Every tool's exact parameter schema (including per-`action` variants for dispatcher tools like `continuity_manage` and `world_manage`) is available via `load_tool_schema({ toolName: "..." })`. Use `search_tools` first if you don't know the exact tool name.
   - "Invalid params" means the action exists but your payload shape is wrong — call `load_tool_schema` rather than trial-and-error guessing. See [Roleplay Test Run — Corrected Findings](#roleplay-test-run--corrected-findings-2026-07-02) below for a case study of this.
   - `world_manage` and `continuity_manage` actions that take an entity/key parameter (`entity_a`, `entity_b`, `entity_key`, `key`, etc.) expect the **full lore key**, e.g. `character:eira-holt`, not the bare name `eira-holt`.

3. **Update After Narrative**
   - After each significant interaction, update the lore
   - Mark dialogue as having happened
   - Update relationships when trust changes
   - Add entries to NPC journals when they learn something

4. **Use Secrets to Control Pacing**
   - Hide information from players using `secret_manage`
   - Reveal at dramatic moments, not randomly
   - Build tension with mystery

5. **Respect Character Knowledge**
   - NPCs should only know what they've experienced
   - Avoid letting NPCs know about events they weren't present for (unless rumor/hearsay is explicitly noted)
   - Use `get_entity_knowledge` to ground NPC dialogue

6. **Keep Time Coherent**
   - Use `thread_tick` at scene breaks or session ends
   - Check `recent_changes` to see what the world did while players were elsewhere
   - Avoid contradicting timeline facts

---

## For the Roleplayers (Human Players)

### What to Expect

1. **Your Actions Matter** — Every interaction you describe (talking to NPCs, moving locations, examining objects) is tracked in the lore. The world remembers what you did.

2. **NPCs Remember You** — NPCs track their relationship with you. Be kind to a tavern keeper and they'll give you discounts and rumors. Betray someone and they'll tell their allies.

3. **The World Changes** — When you complete a quest, locations change. When you defeat bandits, the roads become safer. When you resolve a conflict, NPCs have new goals.

4. **Consequences Are Real** — The lore engine tracks cause-and-effect. Your choices ripple outward — affects quests, relationships, world events, and future encounters.

5. **Continuity** — Between sessions, the world doesn't pause. NPCs move around, rumors spread, and time passes. When you return, things have changed.

6. **You Can't Break the Game** — The narrator has tools to handle unexpected player choices. There's always a way forward, and your character's agency is respected.

---

## Example Campaign Flow

**Session Start:**

- Narrator calls `thread_tick` to see what happened since last session
- Narrator fetches player character data via `character_manage`
- Narrator checks `recent_changes` to brief players on world events

**During Play:**

- Player: "Aldric goes to the tavern"
  - Narrator calls `get_location_occupants("location:tavern")` to see who's there
  - Narrator calls `get_relationship("npc:orm", "player:aldric")` to set NPC tone
  - Narrator calls `character_manage` to check Aldric's inventory and status
  - Narrator generates response using this context
  - Narrator calls `patch_lore("npc:orm", ...)` to log the interaction

- Combat Breaks Out:
  - Narrator calls `combat_manage` to create encounter
  - Narrator tracks actions with `combat_action`
  - Updates character HP via `character_manage`

- Quest Progresses:
  - Narrator calls `quest_manage` to mark steps complete
  - Narrator updates NPC knowledge via `secret_manage` reveals

**Session End:**

- Narrator calls `thread_tick` to advance world time
- Narrator calls `append_event` to log major story beats
- Narrator updates all character states with final `patch_lore` calls

---

## Quick Reference: Common Scenarios

| Scenario | Tools Used |
|----------|-----------|
| NPC greets player | `get_relationship`, `get_entity_knowledge`, `get_lore` → respond with context |
| Player defeats enemy | `patch_lore` (mark enemy defeated), `character_manage` (update XP), `quest_manage` (mark step) |
| Player asks NPC about rumor | `search_lore` (find all relevant rumors), `secret_manage` (decide what to reveal) |
| Long rest/time passage | `thread_tick` (advance world), `recent_changes` (what happened?) |
| Mystery reveal | `secret_manage` (fetch hidden info), `patch_lore` (update world state with consequences) |
| NPC betrays player | `get_relationship` (change disposition), `patch_lore` (update both characters' knowledge) |
| Player discovers treasure | `item_manage` or `inventory_manage` (add to inventory), `patch_lore` (update location state) |
| New NPC joins party | `character_manage` (create/link NPC), `party_manage` (add to party) |
| World-changing decision | `append_event` (log in history), `thread_tick` (cascade effects through world) |

---

## Narrative Flow Test Results (2026-06-11)

A full end-to-end narrative flow test was executed against the live MCP server. 22 tool operations were tested across all 12 tool categories.

### ✅ Passing (20/22)

| Tool | Result | Notes |
|------|--------|-------|
| `ping_tool` | ✅ | "pong" |
| `check_authentication` | ✅ | "Authenticated" |
| `list_topics` | ✅ | ~200 topics across archetypes, characters, locations, archives |
| `get_lore` | ✅ | Full 8k-word character profile with state machine, inventory, relationships |
| `search_lore` | ✅ | Substring search across all entries |
| `get_reachable_locations` | ✅ | Directions and distances returned |
| `get_location_occupants` | ✅ | Entity keys returned per location |
| `get_relationship` | ✅ | Affinity (0.85), debt (0.80), threat-level (0.00) |
| `get_sensory_profile` | ✅ | Scent, sound, textural descriptors |
| `scene_brief` | ✅ | Entity presence, setups, relationships — respects location scope |
| `math_manage` | ✅ | 2d6+3 → 13, Monte Carlo capable |
| `combat_manage` (list) | ✅ | Empty encounter list returned cleanly |
| `append_event` | ✅ | Timestamped event persisted to chronicle |
| `get_event_log` | ✅ | Filterable by verb, thread, date range |
| `patch_lore` | ✅ | Appended to ## Inventory section |
| `move_entity` | ✅ | Location field updated atomically, old/new indexes synced |
| `advance_state_stage` | ✅ | State machine advanced one step |
| `get_lore_section` | ✅ | Section extraction by heading name |
| `restore_lore` | ✅ | Restored to previous snapshot (20 history frames available) |
| `check_continuity` | ✅ | No dangling references or contradictions |

### ❌ Failing (2/22)

| Tool | Result | Issue | Severity |
|------|--------|-------|----------|
| `combat_manage` (create_encounter) | ❌ | `D1_ERROR: FOREIGN KEY constraint failed` — the `regionId` parameter triggers `SQLITE_CONSTRAINT_FOREIGNKEY`. Encounter table likely references a `regions` table that lacks a matching row. | **HIGH** — Blocks all combat initialization |
| `thread_tick` | ⚠️ | Reports "No entities with **Timeline-Value:** found" even for entities that explicitly have `**Timeline-Value:** N` and `**Thread:** <id>` fields (e.g., character:kavissa-crowmark has `Timeline-Value: 5` and `Thread: thornwood-journey`). Parser likely expects raw YAML frontmatter instead of markdown `**Key:** Value` notation. | **HIGH** — Blocks automatic timeline advancement |

### Summary

**The lore engine is production-ready for reading and writing narrative state.** All 20 data-access tools pass. The two failures are in procedural systems (combat init, timeline tick) that have schema-level or parser-level defects rather than logic bugs.

---

## Roleplay Test Run — Corrected Findings (2026-07-02)

A follow-up roleplay test run reported 11 of 25 `continuity_manage`/`world_manage`/`entity_manage`/`character_manage` operations failing with "Invalid params" or "not found." Investigation of the actual handler source (`src/tools/meta.ts`, `src/tools/world.ts`, `src/tools/definitions.ts`) found **no code defects in these tools** — every failure traced back to one of three usage issues. Filed as GitHub issues [#178](https://github.com/FrozenRegister/holmgard-lore-mcp/issues/178), [#179](https://github.com/FrozenRegister/holmgard-lore-mcp/issues/179), [#181](https://github.com/FrozenRegister/holmgard-lore-mcp/issues/181) and closed as not-a-bug with the corrected payloads below.

### Root cause 1 — wrong parameter names

The test payloads used plausible-but-incorrect field names instead of the tool's actual schema.

| Action | ❌ Tested (fails) | ✅ Correct |
|---|---|---|
| `continuity_manage[append_event]` | `{ entity_key, date, description, source }` | `{ entity_key, verb, object?, location?, thread?, detail?, at? }` |
| `continuity_manage[plant_setup]` | `{ setup_id, description, payoff_type }` | `{ id, description, planted_in?, tension?, expected_in?, actors? }` |
| `continuity_manage[set_goal]` | `{ entity_name, goal_name, goal_description }` | `{ entity_key, goal_id, description, parent?, status?, obstacle? }` |
| `world_manage[get_faction_standing]` | `{ faction_name }` | `{ entity_key, faction_key }` |
| `world_manage[get_entity_knowledge]` | `{ entity_name, topic }` | `{ entity_key, topic }` |
| `world_manage[get_location_occupants]` | `{ location_id }` | `{ location_key }` |
| `world_manage[sense_environment]` | `{ entity_name, radius }` | `{ location_key, entity_key }` (no `radius` param) |

### Root cause 2 — enum value mismatch

`continuity_manage[check_continuity]`'s `severity_floor` only accepts `info` \| `warn` \| `error`. The test payload passed `severity_floor: "medium"`, which doesn't exist in any tool's severity vocabulary in this codebase — it fails Zod validation and returns "Invalid params."

### Root cause 3 — bare names instead of full lore keys

`world_manage[get_relationship]` (and every other `world_manage`/`continuity_manage` action taking an entity reference) does a direct KV lookup on the key you pass — it does **not** resolve short names. Passing `entity_a: "eira-holt"` looks up a KV key literally named `eira-holt`, which doesn't exist; the actual entry is `character:eira-holt`. Always pass the full, prefixed lore key:

```json
{ "action": "get_relationship", "entity_a": "character:eira-holt", "entity_b": "character:gerent" }
```

### Discovery tooling already exists — use it before guessing params

`search_tools` and `load_tool_schema({ toolName })` are registered MCP tools that return the exact JSON Schema for any tool, including the full `oneOf` per-`action` schema for dispatcher tools like `continuity_manage` and `world_manage`. Calling `load_tool_schema({ toolName: "continuity_manage" })` before attempting an action would have surfaced all three root causes above without any trial-and-error. Any narrator/agent prompt (including "Pre-Render Gate" style shape definitions) that calls these tools should call `load_tool_schema` first for any action it hasn't used before.

**Every `continuity_manage`/`world_manage` "Invalid params" response now points at `load_tool_schema` directly.** As of the fix that shipped alongside this section, every Zod validation failure across both tools returns a `message` naming the specific field(s) wrong, a `data.example` worked payload for that action, and a `data.schema_hint` of the exact form `load_tool_schema({ toolName: "world_manage" })` to call for the full schema. This only applies to requests that actually reach the server, though — see the note on client-side pre-validation immediately below.

**Caveat — this can't help if your MCP client validates arguments locally before sending.** Some clients (e.g. Cline) check `arguments` against the tool's declared JSON Schema — `additionalProperties: false`, per-action `required` fields — *before* making the `tools/call` request. If a payload fails that local check, the request never reaches this server at all, and none of the above (better message, example, schema hint) can run; the client shows its own generic rejection instead. The only fix for that class of failure is making the JSON Schema itself tolerant of the wrong field name (see the parameter-alias list below) — there is no way to inject a hint into a request that was never sent.

### Architecture note: two parallel entity systems (by design, not a bug)

`character_manage` (and the rest of the `rpg { sub: "...", action: "..." }` dispatcher — `src/rpg/`) is a **separate, D1-backed system** from `lore_manage`/`world_manage`/`entity_manage`/`continuity_manage` (`src/tools/`), which all read/write the same KV-backed lore store. A character created via `lore_manage[set]` as `character:eira-holt` will never appear in `character_manage[get]`, and vice versa — these are two intentionally distinct subsystems, not a bug (tracked as [#180](https://github.com/FrozenRegister/holmgard-lore-mcp/issues/180)). For a KV-lore-based world (like Fen-Surgeon), stick to `lore_manage`/`world_manage`/`entity_manage`/`continuity_manage` and full `character:<id>`-style keys throughout — don't mix in `character_manage` or `rpg{sub:"character",...}` calls for the same entities.

### Known Behavior: `rpg` sub routing/init fixes (#330, #335, #336)

- **`world.create`/`world.generate` now seed a `world_state` row automatically** (#330), matching the existing biome/zone-type auto-seed pattern. Previously `time.get_date`/`get_age`/`advance` all failed with `"No world_state found"` for any newly-created world until `time.set_date` was called once first. A one-time migration (`0022_backfill_world_state.sql`) backfilled the row for worlds created before this fix.
- **`rpg{sub:"stealth"}` now works** (#335) — it's an alias for `rpg{sub:"perception"}`'s `stealth_check` action, not a separate handler. There is no dedicated `stealth-manage.ts`; stealth mechanics live in `perception-manage.ts` alongside `perception_contested`.
- **`time.get_date`/`timeline.get_events` now accept camelCase `worldId`** as well as their original snake_case `world_id` (#336) — every other `rpg` sub already used `worldId`; these two were the last snake_case-only outliers. Both keys work; `world_id` wins if both are somehow supplied.
- **`world`, `weather`, and `corpse` subs now accept `world_id` (snake_case) as an alias for `worldId`** (#377) — extends the #336 bridge to the remaining RPG subs that lacked it. `world.get_state` also fixed: was crashing when called with only `worldId` (used `a.id` instead of `targetId` for sub-queries). See [Parameter Naming Conventions](./parameter-naming-conventions.md) for the full cross-tool reference.
- **Corpse sub `id` parameter documented** (#377) — `id` is the corpse UUID (primary key of the `corpses` table), NOT a character ID. `characterId` is the dead character's UUID (required for `create`/`register` only). `looterCharacterId` and `observerCharacterId` are living characters acting on the corpse. The schema `required` array was fixed to only require `action` (not `id`, since `create`/`register`/`list` don't need it).
- **#331/#332/#333/#334 (D1_ERROR: missing table/column for encounter/resource/broadcast/biome) were found already fixed** by unrelated prior work when investigated for this fix — closed as stale rather than re-fixed. If you hit a `D1_ERROR` on any `rpg` sub today, it's worth double-checking against a fresh `world.create` before assuming it's the same root cause.
- **Cross-sub action aliases (#404).** Three more sub-level aliases (same handler as their canonical sub, matching the existing `stealth` → `perception` pattern): `characters` → `character`, `maps` → `world_map`, `npc_dialogue` → `npc`. More importantly, a new **action-level** alias layer transparently rewrites a handful of actions callers naturally reach for on the wrong sub: `character.place_character` and `party.place_character` both route to `spawn.place_character`; `character.move_hex` and `world_map.move_hex` both route to `travel.move_hex`. The target handler never sees the alias — it's rewritten before dispatch, so the response looks identical to calling the canonical sub directly (`actionType` reflects the canonical action name, not the alias path). See `src/rpg/action-aliases.ts` for the full table.

### Known Behavior: numeric parameters over this MCP connection

Independently discovered while verifying the fixes above: at least one connected MCP client in this project's toolchain stringifies numeric arguments before they reach the Worker (e.g. `{ q: 50 }` arrives as `{ q: "50" }`), tripping every handler's `z.number()` validation with `"Expected number, received string"`. This reproduces on plain integer literals across unrelated subs (`character.list`'s `limit`, `encounter.resolve`'s `q`/`r`, `waypoint.calibrate`'s `kmPerHex`), so it's a transport/client-side serialization issue, not a per-handler bug — there is currently no server-side workaround (coercing every numeric field to also accept a numeric string would silently mask real type errors from other, correctly-serializing clients). If you hit this, omit the optional numeric param or pass it through a client that serializes numbers correctly.

---

## Tips for Immersion

- **Consistency** — Use the lore engine to stay true to character history. If an NPC hates elves, remember it.
- **Surprise** — Use secrets to keep even the narrator surprised. Plant clues, reveal them dramatically.
- **Scale** — Small interactions (a conversation) and large events (a war) are both tracked. Both matter.
- **Failure** — The tools track setbacks too. Failed quests, broken relationships, dangerous enemies. These create the best stories.

---

## Performance Notes for Slow AI Systems

The Holmgard MCP is used by an AI narrator (Shapes.inc chatbot) that can be slow and token-constrained. The following strategies reduce round-trips and token burn:

- **`scene_brief` replaces 6–10 individual reads** — One call fetches location text, present entities, open setups, and relationships. Prefer this over calling `get_lore` + `get_relationship` + `get_location_occupants` separately.
- **`get_lore_batch` replaces N × `get_lore`** — Fetch up to 20 entries in one round-trip instead of serially.
- **`batch_set_lore` replaces N × `set_lore`** — Bulk write up to 20 entries.
- **`batch_mutate` replaces N × `patch_lore` + `increment_topic_field`** — Apply multiple mutations across keys in one call.
- **`get_event_log` with `limit`** — Cap results to the most recent N events instead of fetching the full chronicle.
- **`search_lore` with `max_results`** — Limit search results to 10 instead of the default 50.
- **`list_topics` with pagination** — Use `limit` and `offset` to page through topics rather than dumping everything.
- **`check_continuity` with `severity_floor`** — Set to `warn` or `error` to skip informational findings.
- **`render_pov`** — One call that filters a scene through a character's senses and knowledge, replacing the need for separate perception checks.

---

**The Holmgard lore engine is a living notebook for collaborative storytelling. Use it to build a world that's rich, consistent, and responsive to player choice.**
