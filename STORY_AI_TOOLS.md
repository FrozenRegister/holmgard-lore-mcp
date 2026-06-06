# Holmgard Lore MCP — Complete Tool Reference

This document covers every MCP tool exposed by the Holmgard worker. Tools are grouped by function, with guidance on when to reach for each one and how to use it well.

---

## Key Concepts

**Keys** follow a `type:name` convention: `character:aldric`, `location:eastgate`, `item:iron_crown`, `faction:ironseal`, `scene:prologue`, `setup:crown_prophecy`, `archetype:guard`.

**Markdown fields** inside lore text use `**FieldName:** value` syntax. Many tools read and write these fields directly.

**`events:` namespace** — separate from lore text, stores a per-entity action log. Use `append_event` to write; `get_event_log` to read. Never appears in `list_topics`.

**`setup:` keys** — visible in `list_topics`. These are narrative setups (Chekhov's guns). They have their own lifecycle: planted → open → paid/abandoned/deferred.

**History stack** — every `set_lore` / `patch_lore` / `increment_topic_field` write snapshots the previous version (up to 5 deep). Use `restore_lore` to undo.

---

## Table of Contents

1. [Utilities](#utilities)
2. [Core Lore CRUD](#core-lore-crud)
3. [Section & Field Operations](#section--field-operations)
4. [Batch & History](#batch--history)
5. [Search & Discovery](#search--discovery)
6. [Event Log & Causality](#event-log--causality)
7. [Tags & Bookmarks](#tags--bookmarks)
8. [Setup Ledger](#setup-ledger)
9. [Intent & Continuity](#intent--continuity)
10. [Scene Composition](#scene-composition)
11. [World & Location](#world--location)
12. [Relationships & Factions](#relationships--factions)
13. [Inventory & Items](#inventory--items)
14. [Timeline & Threads](#timeline--threads)
15. [Entity State Machines](#entity-state-machines)
16. [Entity Generation & Encounters](#entity-generation--encounters)
17. [Interaction Resolution](#interaction-resolution)
18. [Recommended Workflow Patterns](#recommended-workflow-patterns)

---

## Utilities

### `ping_tool`

Trivial connectivity check. Returns `"pong"`.

**When to call it:** Integration smoke tests. Verify the MCP connection is live before a session.

```json
{}
```

---

### `check_authentication`

Returns whether the current request is authenticated with a valid API key.

**When to call it:** Before any write operation in an untrusted environment. Useful to confirm MCP client configuration is correct.

```json
{}
```

**Response:** Plain text `"Authenticated."` or `"Not authenticated — request was made without a valid API key."` plus `metadata.authenticated` boolean.

---

## Core Lore CRUD

### `get_lore`

Retrieve a single lore entry by exact key.

**When to call it:** Any time you need the current state of one entity, location, faction, item, or system entry.

```json
{ "query": "character:aldric" }
```

**Parameters:**

- `query` — required. Exact topic key.

---

### `list_topics`

Return all available lore topic keys.

**When to call it:** At session start to get oriented. Before a `search_lore` when you need the full keyspace. To check what namespaces exist.

```json
{}
```

**Response:** Comma-separated list of all keys plus `metadata.count`.

---

### `set_lore`

Write or overwrite a lore entry. Snapshots the previous version to the history stack before writing.

**When to call it:** When creating a new entry or replacing the full text of an existing one. For surgical edits, prefer `patch_lore` or `append_to_section`.

```json
{
  "key": "character:aldric",
  "text": "**Status:** Wounded\n**Location:** location:throne_room\n..."
}
```

**Parameters:**

- `key` — lowercase, no spaces.
- `text` — complete lore body. Existing content is fully replaced.

---

### `delete_lore`

Permanently delete a lore entry by key. This is irreversible (does not push to history).

**When to call it:** Removing obsolete entries, cleaning up test data. Confirm you don't need `restore_lore` first.

```json
{ "key": "character:old_npc" }
```

---

### `get_lore_batch`

Retrieve multiple lore entries in one round-trip.

**When to call it:** Any time you need 2+ entries — assembling a scene, comparing characters, loading a faction's members. Prefer this over repeated `get_lore` calls.

```json
{
  "keys": ["character:aldric", "character:sera", "location:throne_room"]
}
```

**Response:** Array of `{ key, text, found }` objects. Missing keys have `found: false` and no `text`.

---

## Section & Field Operations

### `get_lore_section`

Retrieve one or more named `##` sections from a lore entry without fetching the full text.

**When to call it:** When you only need a specific section — e.g., just `Goals` or `Personality` — and the full entry is long. More token-efficient than `get_lore`.

```json
{
  "key": "character:aldric",
  "sections": ["Goals", "Personality"],
  "mode": "loose"
}
```

**Parameters:**

- `sections` — array of section heading names.
- `mode` — `"loose"` (default): case-insensitive, whitespace-normalized, trailing-colon-stripped. `"strict"`: case-insensitive, exact otherwise.

**Response:** `sections` map of heading → body text; `not_found` list; `warnings` for duplicate or empty sections.

---

### `patch_lore`

Surgically modify a lore entry without full overwrite. Supports exact-substring `replace`, `append`, and `delete_field` operations.

**When to call it:** When you need to change one field or one sentence and don't want to rewrite the whole entry. Safer than `set_lore` for targeted edits.

```json
{
  "key": "character:aldric",
  "operation": "replace",
  "target": "**Status:** Alive",
  "value": "**Status:** Wounded"
}
```

**Parameters:**

- `operation` — `"replace"`, `"append"`, or `"delete_field"`.
- `target` — exact substring to match. Required for `replace` and `delete_field`. Optional for `append` (omit to append at end of text).
- `value` — new text. Required for `replace` and `append`.

**Notes:**

- Rejects ambiguous targets (>1 occurrence) with a descriptive message rather than an error.
- Response is always `result`, never `error`, even for user mistakes — read the message.

---

### `increment_topic_field`

Atomically increment a numeric markdown field (`**FieldName:** 10`) without rewriting the full entry.

**When to call it:** Tracking countable state — days remaining, supply count, reputation score, version number. Avoids read-modify-write race conditions.

```json
{
  "key": "character:aldric",
  "field_path": "Days-Remaining",
  "increment": -1,
  "reason": "daily-decrement"
}
```

**Parameters:**

- `field_path` — field name as it appears in `**FieldName:**` syntax.
- `increment` — positive or negative integer (default 1).
- `reason` — logged with the change.

**Notes:** Non-numeric fields return a JSON-RPC error.

---

### `append_to_section`

Surgically append or prepend text to a named `##` section within a lore entry. Auto-creates missing sections by default.

**When to call it:** When you want to add to a specific section without touching the rest — add a new goal entry, extend a history log, insert a relationship note. Prefer this over `patch_lore` for additive section changes.

```json
{
  "key": "character:aldric",
  "section": "Goals",
  "text": "- **seize_throne:** Claim the Iron Crown before House Calder consolidates.",
  "position": "end"
}
```

**Parameters:**

- `section` — heading name, case-insensitive, trailing colon stripped.
- `text` — content to insert. A leading newline preserves paragraph separation.
- `position` — `"end"` (default) or `"start"`.
- `auto_create` — if `true` (default), creates the section at end of entry if missing. If `false`, returns `section_not_found`.

---

## Batch & History

### `batch_set_lore`

Write or overwrite multiple lore entries in one call. Writes run in parallel — not transactional.

**When to call it:** Seeding a new arc, importing a batch of NPCs, resetting multiple entries at once.

```json
{
  "entries": [
    { "key": "character:zira", "text": "Zira lore..." },
    { "key": "character:vex", "text": "Vex lore..." }
  ]
}
```

**Response:** `results` array with per-key `success` and `error` fields. Partial success is possible — check each entry.

---

### `batch_mutate`

Apply multiple `increment` or `patch` mutations across multiple keys in one call. Mutations run sequentially (same key may appear twice; order matters).

**When to call it:** End-of-scene updates — decrement timers, replace statuses, and patch locations across several characters in a single call.

```json
{
  "mutations": [
    { "key": "character:aldric", "action": "patch", "operation": "replace", "target": "**Status:** Alive", "value": "**Status:** Wounded" },
    { "key": "character:aldric", "action": "increment", "field_path": "Days-Remaining", "increment": -1 }
  ]
}
```

**Notes:** Each mutation records its outcome. A failure on one mutation does not stop the rest.

---

### `restore_lore`

Restore a lore entry to its previous state by popping the history stack (up to 5 versions deep).

**When to call it:** When a `set_lore` or `patch_lore` produced an unintended result and you want to roll it back.

```json
{ "key": "character:aldric" }
```

---

## Search & Discovery

### `search_lore`

Full-text search across all lore entry bodies. Returns matching keys with excerpt snippets.

**When to call it:** When you don't know the exact key but remember a phrase, name, or detail from the content. Also useful for finding all entries that mention a given topic.

```json
{
  "query": "iron crown",
  "max_results": 10
}
```

**Parameters:**

- `query` — case-insensitive substring match against lore text bodies.
- `max_results` — 1–50 (default 10).

**Response:** Array of `{ key, excerpt }` matches.

---

### `validate_topic_exists`

Check if a topic exists and return namespace suggestions if it doesn't.

**When to call it:** Before dereferencing a key you're uncertain about. Useful for user-supplied input or fuzzy references.

```json
{ "query_string": "molly" }
```

**Response:** `exists: true/false`, the matched key if found, and candidate keys in related namespaces when not found.

---

## Event Log & Causality

### `append_event`

Record that something happened to an entity — a character act, a location change, an item use. Primary tool for maintaining a causal record during play.

**When to call it:** After any significant in-fiction action: a character attacks, speaks a consequential line, enters a location, acquires an item, makes a deal.

```json
{
  "entity_key": "character:aldric",
  "verb": "threatened",
  "object": "character:sera",
  "location": "location:throne_room",
  "thread": "succession_crisis",
  "detail": "Claimed the crown belongs to House Vael by blood"
}
```

**Parameters:**

- `verb` — required. Lowercase past-tense verb: `"attacked"`, `"fled"`, `"betrayed"`, `"revealed"`.
- `object` — what or whom the verb was directed at.
- `location` — where it happened (use a location key if possible).
- `thread` — narrative thread or subplot name. Useful for later filtering.
- `detail` — one sentence of context that won't fit in verb+object.
- `at` — override timestamp (ISO 8601). Omit to use server time.

**Deduplication:** Events with the same `verb` + `object` within 1 second are silently skipped.

**Cap:** The log stores the 200 most recent events per entity.

---

### `get_event_log`

Retrieve the recorded history for one or more entities, with optional filtering.

**When to call it:** Before writing a scene involving a character — pull their recent events for continuity. Before resolving a consequence — check what actually happened. Before summarising a chapter.

```json
{
  "entity_key": ["character:aldric", "character:sera"],
  "thread": "succession_crisis",
  "limit": 10
}
```

**Parameters:**

- `entity_key` — a single key or array of keys.
- `since` / `until` — ISO timestamps to bound the window.
- `thread` — filter to one narrative thread.
- `verbs` — array of verbs to include, e.g. `["attacked", "fled"]`.
- `limit` — max events returned (default 50, max 500).

**Response shape:**

```json
{
  "events": [
    { "at": "...", "entity_key": "character:aldric", "verb": "threatened", "object": "character:sera", "detail": "..." }
  ],
  "metadata": { "total": 12, "returned": 10 }
}
```

Events come back sorted newest-first.

---

### `recent_changes`

Read the global changelog — which lore keys were written and when.

**When to call it:** At the start of a session to catch up on what changed since last time. When you need to know whether a key was edited during the current thread.

```json
{
  "since": "2025-01-10T00:00:00Z",
  "key_prefix": "character:",
  "limit": 20
}
```

**Parameters:**

- `since` — only show entries newer than this timestamp.
- `key_prefix` — filter to keys starting with a namespace, e.g. `"setup:"`.
- `limit` — default 30, max 200.

**Response:** Chronological changelog entries, most-recent-first. Each entry includes key, operation, version, and timestamp.

---

## Tags & Bookmarks

### `tag_topic`

Add or remove classification tags on any lore key. Tags are written into the key's lore text as a `**Tags:**` field and indexed for fast reverse lookup.

**When to call it:** When you want to group keys for later retrieval — tag all keys involved in a plot arc, mark items as `cursed`, flag characters as `suspect`.

```json
{
  "key": "character:aldric",
  "add": ["antagonist", "succession_crisis", "house_vael"],
  "remove": ["neutral"]
}
```

**Notes:**

- Tags are case-sensitive in storage; normalise to lowercase for consistency.
- Calling `tag_topic` with no `add` or `remove` returns current tags without modifying.
- The key must already exist.

---

### `find_by_tag`

Look up all keys that carry one or more tags.

**When to call it:** To assemble a scene — find all characters tagged `faction:ironseal`. To audit — find all items tagged `cursed`. To pull a subset for a batch read.

```json
{
  "tags": ["antagonist", "succession_crisis"],
  "mode": "all",
  "with_excerpt": true,
  "limit": 20
}
```

**Parameters:**

- `tags` — one or more tags to search.
- `mode` — `"any"` (union) or `"all"` (intersection). Default: `"any"`.
- `with_excerpt` — if true, return the first 120 characters of each matching key's lore text.
- `limit` — default 20, max 100.

---

### `bookmark_state`

Snapshot the current version manifest of all keys (or a filtered subset) under a named bookmark. Does **not** copy full text — it records key names, version numbers, and update timestamps.

**When to call it:** At chapter boundaries, before a major decision point, or before a destructive change. Lets you `world_diff` against it later.

```json
{
  "name": "chapter_3_start",
  "key_prefix": "character:",
  "note": "Before the siege begins"
}
```

**Parameters:**

- `name` — bookmark identifier. Reusing a name overwrites the old bookmark.
- `key_prefix` — scope the snapshot to keys starting with this string. Omit to snapshot everything.
- `note` — optional human-readable annotation stored with the snapshot.

---

### `world_diff`

Compare two bookmarks, or a bookmark against the current state, to see what changed.

**When to call it:** At the end of a session to summarise what happened. After a time-skip to determine what needs narrative reconciliation. During chapter review.

```json
{
  "from": "chapter_3_start",
  "detail": "summary"
}
```

To compare two bookmarks:

```json
{
  "from": "chapter_3_start",
  "to": "chapter_4_start",
  "detail": "fields"
}
```

**Parameters:**

- `from` — required. Bookmark name.
- `to` — optional bookmark name. Omit to compare against current live state.
- `detail` — `"summary"` (counts only), `"fields"` (versions + timestamps), `"text"` (includes first 500 chars of current text for changed keys).
- `key_prefix` — narrow the diff to a namespace.

**Response:**

```json
{
  "added": ["character:new_npc"],
  "removed": ["item:old_sword"],
  "changed": [{ "key": "character:aldric", "from_version": 3, "to_version": 7 }]
}
```

---

## Setup Ledger

This trio tracks narrative plants (Chekhov's guns): things introduced to be paid off later.

### `plant_setup`

Register a narrative setup — a promise to the reader that this element will matter.

**When to call it:** When you introduce an object, secret, threat, or relationship you intend to pay off later. Plant it immediately so it doesn't get forgotten.

```json
{
  "id": "crown_prophecy",
  "description": "The court seer declared the next king will die by iron. Aldric heard it.",
  "planted_in": "scene:prologue",
  "tension": 4,
  "expected_in": "chapter",
  "actors": ["character:aldric", "character:seer_maris"]
}
```

**Parameters:**

- `id` — short slug, becomes `setup:crown_prophecy`.
- `description` — what was planted and what the implicit promise is.
- `planted_in` — scene or chapter key where it appeared.
- `tension` — 1 (low stakes) to 5 (critical). Used by `list_unpaid_setups` to sort urgency.
- `expected_in` — `"scene"`, `"chapter"`, or `"story"` — rough horizon for payoff.
- `actors` — character or entity keys involved.

---

### `pay_off_setup`

Mark a setup as resolved, abandoned, or deferred, and record how it was paid off.

**When to call it:** Immediately after the payoff happens in the narrative.

```json
{
  "id": "crown_prophecy",
  "resolution": "Aldric was struck by Sera's iron blade at the coronation — the prophecy fulfilled.",
  "paid_in": "scene:coronation",
  "status": "paid"
}
```

**Parameters:**

- `id` — the setup id (without the `setup:` prefix).
- `resolution` — one sentence describing what happened.
- `paid_in` — scene or chapter key where the payoff occurred.
- `status` — `"paid"` (resolved as intended), `"abandoned"` (dropped), or `"deferred"` (pushed to a later arc).

---

### `list_unpaid_setups`

Retrieve all open setups, sorted by tension descending and age ascending (oldest high-tension setups surface first).

**When to call it:** At the start of any scene or chapter to see what promises are outstanding. Before ending an arc, to confirm nothing is dangling.

```json
{
  "min_tension": 3,
  "scope": "chapter",
  "actor": "character:aldric"
}
```

**Parameters (all optional):**

- `min_tension` — only return setups at this tension level or higher.
- `scope` — filter to setups with `expected_in` matching `"scene"`, `"chapter"`, or `"story"`.
- `actor` — only return setups involving this key (substring match on actors list).

**Response:** Array sorted by tension (high→low), then creation time (old→new). Each entry includes `id`, `description`, `tension`, `planted_in`, `expected_in`, and `actors`.

---

## Intent & Continuity

### `set_goal`

Write or update a named goal on any entity's lore entry. Goals are stored as `**Goal:id:** status | description | obstacle: X | parent: Y` fields.

**When to call it:** When a character's intent becomes clear or shifts. At the start of each major arc per character. After an obstacle or achievement changes what they're pursuing.

```json
{
  "entity_key": "character:aldric",
  "goal_id": "seize_throne",
  "description": "Claim the Iron Crown before House Calder consolidates power",
  "status": "active",
  "obstacle": "Sera controls the city gates",
  "parent": "restore_house_vael"
}
```

**Parameters:**

- `goal_id` — short slug. Multiple goals can coexist on one entity.
- `status` — `"active"`, `"blocked"`, `"achieved"`, or `"abandoned"`.
- `obstacle` — what's currently in the way (optional).
- `parent` — id of a higher-level goal this one serves (optional, for goal hierarchies).

Calling `set_goal` again with the same `goal_id` overwrites the existing goal line.

---

### `check_continuity`

Scan lore keys for broken references, occupancy mismatches, and inventory ghosts.

**When to call it:** After a batch of edits. Before a session to catch drift. Periodically during long campaigns.

```json
{
  "scope": "character:",
  "checks": ["dangling", "occupancy"],
  "severity_floor": "warn"
}
```

**Parameters:**

- `scope` — narrow to keys starting with or containing this string.
- `checks` — subset of `["dangling", "occupancy", "knowledge", "inventory"]`. Default: all four.
  - `dangling` — finds `type:key` references in text that point to nonexistent keys.
  - `occupancy` — finds characters whose `**Location:**` field points to a nonexistent location key.
  - `inventory` — finds item/weapon/armor refs in `**Inventory:**` / `**Items:**` fields that don't exist.
  - `knowledge` — reserved (currently a no-op).
- `severity_floor` — `"info"`, `"warn"`, or `"error"`. Filters findings below this level.

**Response:** List of findings, each with `key`, `check` type, `severity`, and `message`.

---

## Scene Composition

### `scene_brief`

Pull a composite scene brief for a location: the location's lore text, occupants (characters with a matching `**Location:**` field), their active goals and recent events, open setups relevant to those characters, and pairwise relationship fields.

**When to call it:** At the start of any scene. This is the primary scene-entry tool — call it before writing narrative.

```json
{
  "location_key": "location:throne_room",
  "include": {
    "events": 5,
    "open_setups": true,
    "relationships": true
  }
}
```

**Parameters:**

- `location_key` or `scene_key` — one is required.
- `include.events` — how many recent events to fetch per occupant (default 5). Set to 0 to skip.
- `include.open_setups` — include open setups involving scene occupants (default true).
- `include.relationships` — include pairwise `Affinity`, `Debt`, `Threat-Level` fields for up to 4 occupant pairs (default true).

**Response structure:**

```json
{
  "location": { "key": "...", "text": "..." },
  "entities": [
    {
      "key": "character:aldric",
      "status": "wounded",
      "top_goal": "seize_throne: Claim the Iron Crown...",
      "events": [{ "verb": "threatened", "object": "character:sera" }]
    }
  ],
  "open_setups": [{ "id": "crown_prophecy", "description": "...", "tension": 4 }],
  "relationships": [{ "entity_a": "...", "entity_b": "...", "affinity": "-3", "threat_level": "high" }]
}
```

---

### `render_pov`

Render a scene filtered through one character's perceptual access. Lines tagged `[hidden]` or `[concealed]` are suppressed if perception < 0.7; `[threat]` and `[danger]` lines are suppressed below 0.4.

**When to call it:** When writing from a specific character's point of view, especially for mystery, stealth, or limited-information scenes.

```json
{
  "pov_entity_key": "character:sera",
  "location_key": "location:throne_room",
  "include_voice_hints": true,
  "reveal_threshold": 0.6
}
```

**Parameters:**

- `pov_entity_key` — the character whose senses and knowledge apply.
- `location_key` or `scene_key` — override location. If omitted, uses the entity's `**Location:**` field.
- `reveal_threshold` — 0–1 float. Overrides the entity's `**Perception:**` field. Higher = more is visible.
- `include_voice_hints` — if true, returns the entity's `**Diction:**`, `**Register:**`, and `**Fixations:**` fields as writing style hints.

**Response structure:**

```json
{
  "location": { "key": "...", "filtered_text": "..." },
  "visible_entities": [{ "key": "character:aldric", "status": "armed", "known": true }],
  "voice_hints": { "diction": "clipped, formal", "register": "cold", "fixations": "exits, weapons" },
  "knowledge_scope": ["character:aldric", "faction:ironseal"]
}
```

`known: true` means this entity appears in the POV character's `**Knows:**` or `**Knowledge:**` field.

---

### `activate_scene`

Set a scene as active in `system:active-scene` and hydrate all related entities and the location in a single call.

**When to call it:** When transitioning to a new scene. Returns everything needed to start writing immediately.

```json
{ "scene_key": "scene:tavern-confrontation" }
```

**Response:** Scene description, present entities, available choices, and the previously active scene key.

---

### `present_choices`

Read a scene's choice lines and filter against an entity's current inventory and `Weight-1` field. Returns valid and blocked choices.

**Choice format in lore:** `- id: description [requires: item] [min-weight: N]`

**When to call it:** When a decision point is reached and you need to know what options are actually available to the acting character given their current state.

```json
{
  "scene_key": "scene:tavern-confrontation",
  "entity_key": "character:player"
}
```

**Response:** `valid_choices` array (available), `blocked_choices` array (with reason per blocked choice).

---

### `commit_choice`

Apply all consequences of a committed choice: reads `Outcome-Seed`, `State-Change`, and `Next-Choices` fields from the choice entry, updates entity `Status`, and appends to `Choice-History`.

**When to call it:** When a player or character makes a binding decision. This is the write step after `present_choices`.

```json
{
  "choice_id": "choice:accept-quest",
  "entity_key": "character:player"
}
```

**Response:** Outcome seed text, state changes applied, and newly unlocked choices.

---

### `get_choice_history`

Return the entity's logged path through branching narratives, parsed into choice IDs and timestamps.

**When to call it:** To recap a character's decision history. To audit continuity across sessions. To determine what branches are open.

```json
{ "entity_key": "character:player" }
```

---

## World & Location

### `get_location_occupants`

Scan all lore entries for a `**Location:**` field matching the given key. Returns entity keys currently at that location with status summaries.

**When to call it:** When you need to know who is at a location without going through `scene_brief`. Lighter-weight for simple "who's here" checks.

```json
{ "location_key": "location:market-square" }
```

---

### `get_reachable_locations`

Read an origin location's `**Exits:**` or `**Connections:**` field and return all reachable location keys with danger level, travel cost, and requirements.

**When to call it:** When planning character movement or presenting travel options. Before a chase or escape sequence.

```json
{ "origin_key": "location:town-gate" }
```

**Response:** Array of `{ location_key, danger_level, travel_cost, requirements }`.

---

### `sense_environment`

Read location lore and filter environmental details through an entity's sensory attributes (`Perception`, `Night-Vision`, `Tracking`). Low Perception hides `[hidden]`/`[concealed]` and `[threat]`/`[danger]` tagged lines.

**When to call it:** A lighter alternative to `render_pov` focused purely on environmental perception rather than full scene rendering. Good for scouting, tracking, or ambush detection.

```json
{
  "location_key": "location:dark-cavern",
  "entity_key": "character:scout"
}
```

**Response:** Filtered location text plus any sensory-attribute-specific observations from `Night-Vision` and `Tracking` fields.

---

## Relationships & Factions

### `get_relationship`

Scan two entity lore entries for relationship fields (`Affinity`, `Debt`, `Threat-Level`, `Faction`) and bidirectional cross-references.

**When to call it:** When writing any interaction between two entities. Before a negotiation, confrontation, or reunion scene. When `scene_brief` is overkill and you only need the dyad.

```json
{
  "entity_a": "character:aldric",
  "entity_b": "character:sera"
}
```

**Response:** Structured relationship data including affinity score, debt, threat level, and any shared faction memberships. Returns `null` with a creation suggestion if no data exists.

---

### `get_faction_standing`

Query an entity's standing within a faction: membership status, rank, reputation score, outstanding obligations, and current threat-level.

**When to call it:** Before any faction-related scene — guild hall, court audience, criminal syndicate encounter. Reads both entity and faction entries.

```json
{
  "entity_key": "character:aldric",
  "faction_key": "faction:ironseal"
}
```

**Response:** `membership_status`, `rank`, `reputation`, `obligations`, `threat_level`, and any relevant notes from the faction entry.

---

### `get_entity_knowledge`

Return what one entity canonically knows about a topic. Checks `**Knows:**`, `**Knowledge:**`, and `**Awareness:**` fields on the entity entry.

**When to call it:** Critical for preventing narrators from having entities reference things they should not know. Check this before writing any dialogue or action that requires specific knowledge.

```json
{
  "entity_key": "character:scout",
  "topic": "location:hidden-base"
}
```

**Response:** `knows: true/false`, the relevant knowledge excerpt if found, and the field it came from.

---

## Inventory & Items

### `get_inventory`

Return a structured inventory from an entity lore entry, parsing the `**Inventory:**` / `**Items:**` field into item keys and quantities.

**When to call it:** Before a `present_choices` call (implicitly used there), before a trade or combat scene, or when auditing what an entity is carrying.

```json
{ "entity_key": "character:merchant" }
```

**Response:** Array of `{ item_key, quantity }` objects.

---

### `transfer_item`

Move one or more units of an item between two entity inventories. Validates availability in the source entity, then updates both entries.

**Inventory format:** `item-key×qty, item-key×qty`

**When to call it:** After a trade, theft, gift, or loot event. This is the canonical way to move items — it validates and updates both sides atomically.

```json
{
  "from_entity": "character:merchant",
  "to_entity": "character:aldric",
  "item_key": "item:iron-crown",
  "quantity": 1
}
```

**Parameters:**

- `from_entity` — lore key of the giving entity.
- `to_entity` — lore key of the receiving entity.
- `item_key` — identifier of the item.
- `quantity` — number of units (default 1).

---

## Timeline & Threads

### `list_active_threads`

Return all active consumption/predation threads with current status.

**When to call it:** At session start to see what narrative threads are in progress. When deciding which thread to advance next.

```json
{}
```

---

### `list_consumption_timelines`

Return all prey-characters with current consumption status and timeline remaining. Scans all `character:*` keys for `**Consumption-Timeline:**` fields.

**When to call it:** To triage which characters have imminent timeline changes. Used for pacing decisions in consumption/predation narrative arcs.

```json
{ "status_filter": "imminent" }
```

**Parameters:**

- `status_filter` — `"all"` / `"imminent"` / `"days-to-weeks"` / `"weeks-to-months"` / `"consumed"`. Default: `"all"`.

---

### `thread_tick`

Advance a named timeline thread by one tick. Decrements the `**Timeline-Value:**` field on every entity whose lore contains `**Thread:** <thread_id>`. Then performs a global sync: finds entities on other threads that share a `Current-Date` and returns their status.

**When to call it:** To advance time within a specific narrative thread. Use this to drive parallel storyline progression without touching other threads.

```json
{ "thread_id": "thread-alpha" }
```

**Response:** List of entities ticked (with old/new timeline values) and any cross-thread entities at the same current date.

---

### `get_thread_comparison`

Compare two named timeline threads: return entity counts, average `Timeline-Value` per thread, timeline offset, and overlap of shared `Current-Date` and `Location` values.

**When to call it:** When managing parallel storylines that need to converge. Before deciding whether to advance one thread or both.

```json
{
  "thread_a": "thread-alpha",
  "thread_b": "thread-beta"
}
```

---

### `check_convergence`

Determine whether two timeline threads can currently intersect by checking for shared `Current-Date` or `Location` values across their entities.

**When to call it:** Before writing a crossover scene between two parallel storylines. Returns `can_converge: true/false` with framing text and overlap lists.

```json
{
  "thread_a": "thread-alpha",
  "thread_b": "thread-beta"
}
```

---

## Entity State Machines

### `advance_state_stage`

Advance an entity to the next stage in its configured state machine. Increments `**State-Stage:**`, decrements `**Stage-Timer:**` if present, and returns the new stage, remaining stages, and `**Stage-N-Description:**` text for narrator use.

**When to call it:** When a single entity moves to its next narrative/transformation stage — a prisoner's conditioning progressing, a metamorphosis advancing, a ritual completing its next step.

```json
{ "entity_key": "character:transforming-entity" }
```

**Response:** `new_stage`, `stages_remaining`, `stage_description`, and whether the entity has reached terminal stage.

---

### `process_stage_batch`

Tick ALL entities at a given location that have a `**State-Stage:**` field. Skips entities already at terminal stage.

**When to call it:** When time passes at a location and all in-progress processes should advance simultaneously — a holding cell where multiple captives are at different stages, a laboratory with several ongoing procedures.

```json
{ "location_key": "location:processing-chamber" }
```

**Response:** Array of stage changes per entity plus a `skipped` list (already terminal or no stage field).

---

## Entity Generation & Encounters

### `generate_entity`

Create a new entity instance from a named archetype lore entry. Populates fields from the template, applies a location modifier (danger-level → `Weight-1` boost), and persists to a timestamped key.

**When to call it:** When spawning an NPC from a template. Archetypes live under `archetype:` keys and define base fields; `generate_entity` creates a unique instance.

```json
{
  "archetype_key": "archetype:guard",
  "location_key": "location:market-square"
}
```

**Response:** The new entity key and its full generated lore text.

---

### `roll_encounter`

Read a location's `**Encounter-Table:**` field (`archetype:weight, archetype:weight`), roll against a threat-level modifier, and return a generated entity instance at that location.

**When to call it:** When a random encounter should occur at a location. Biases toward higher-weight archetypes as threat level increases.

```json
{
  "location_key": "location:dark-forest",
  "threat_level": 7
}
```

**Parameters:**

- `threat_level` — 1 (trivial) to 10 (extreme). Biases rolls toward higher-weight entries.

**Response:** The generated entity key, archetype used, and lore text of the new instance.

---

### `get_sensory_profile`

Return structured sensory data for an entity: temperature, scent, texture, sound signature, and visual descriptors. Reads entity fields first, then falls back to the species/type lore entry.

**When to call it:** When writing sensory-rich narrative — a character detecting another, a predator tracking prey, describing physical presence. Provides concrete sensory details without hallucinating them.

```json
{ "entity_key": "character:hunter" }
```

**Response:** `temperature`, `scent`, `texture`, `sound_signature`, `visual`, each as a short descriptor string.

---

### `get_compatibility`

Check whether two entities can interact via a given interaction type. Validates size ratio (`**Size:**` field), `Weight-1`/`Weight-2` thresholds, and environment overlap.

**When to call it:** Before writing an interaction that has physical or mechanical constraints. Returns `compatible: true/false`, `constraints` list (what prevents or limits the interaction), and `risk_level`.

```json
{
  "entity_a": "character:predator",
  "entity_b": "character:prey",
  "interaction_type": "consume"
}
```

---

## Interaction Resolution

### `resolve_interaction`

Determine the outcome of an entity interaction via weighted probability. Reads `**Weight-1:**` from `entity_a` and `**Weight-2:**` from `entity_b`, computes P(success) = (W1×0.7)−(W2×0.3), clamps to [0,1], rolls against it, and returns a boolean outcome with delta value. If successful and `entity_a` has a numeric `**State-Level:**` field, increments it by `delta_value`.

**When to call it:** When a contested action needs a mechanically grounded outcome — hunts, combat, persuasion, seduction, any roll-against scenario.

```json
{
  "entity_a_id": "character:predator",
  "entity_b_id": "character:prey",
  "action_type": "consume"
}
```

**Response:** `success: true/false`, `probability`, `delta_value`, and any state-level change applied.

---

### `analyze_utility`

Quantify an entity's suitability for a specific narrative pathway. Scans all numeric lore fields, applies vector-specific weighting, and returns a per-field breakdown, composite score (0–100), grade (S/A/B/C/D/F), and projected yield narrative.

**When to call it:** When selecting between candidate entities for a specific role. When characterizing an entity's narrative potential in a given context.

```json
{
  "entity_id": "character:target",
  "utility_vector": "GASTRIC",
  "entity_role": "subject"
}
```

**Parameters:**

- `utility_vector` — `GASTRIC`, `BUTCHERY`, `INCUBATION`, `SCULPTURE`, `PARASITISM`, `THRALL`, or `DISTRIBUTED`.
- `entity_role` — `"subject"` (prey-oriented fields) or `"actor"` (predator-drive fields: `Weight-1`, `Aggression`, `Hunger`).

**Response:** Per-field scores, composite 0–100, letter grade, and a narrative yield summary.

---

### `map_integration`

Permanently transfer `[Transferable]`-tagged traits from a source entity to a target entity on a state-merge event. `integration_depth` controls the fraction of available traits transferred.

**When to call it:** When two entities merge, one absorbs the other, or a transformation transfers characteristics. This is the write step for irreversible trait absorption.

```json
{
  "source_id": "character:donor",
  "target_id": "character:recipient",
  "integration_depth": 0.75
}
```

**Parameters:**

- `source_id` — lore key of the source entity (traits are read from here).
- `target_id` — lore key of the target entity (traits are written here).
- `integration_depth` — 0.0 (none) to 1.0 (all available `[Transferable]` traits).

**Response:** List of traits transferred, traits skipped, and updated target lore.

---

## Recommended Workflow Patterns

### Opening a scene

1. `scene_brief` — get location + occupants + open setups + relationships
2. `render_pov` (if writing close-third or first person) — filter for POV character
3. `list_unpaid_setups` with relevant actor — confirm what tension is due

### After a significant action

1. `append_event` on the acting character (and target if applicable)
2. `set_goal` if the action changes intent or status
3. `pay_off_setup` if a setup was resolved

### Chapter boundary

1. `bookmark_state` with `name: "chapter_N_end"`
2. `list_unpaid_setups` to triage what must be paid off next chapter
3. `check_continuity` to catch any broken references from the session's edits

### Finding characters for a scene

1. `find_by_tag` with relevant arc or faction tags
2. Cross-reference with `get_event_log` on candidates to see where they were last

### Time-skip recap

1. `world_diff` from last bookmark to now, `detail: "fields"`
2. `recent_changes` with `since` set to the skip-start timestamp
3. Update affected characters' goals and locations as needed

### Contested action

1. `get_compatibility` — confirm the interaction is physically/mechanically valid
2. `resolve_interaction` — roll the outcome
3. `append_event` on both entities with the result verb
4. `batch_mutate` — apply stat/status changes from the outcome

### Spawning an encounter

1. `roll_encounter` at the location — generates a random entity from the encounter table
2. `get_compatibility` with the player entity if relevant
3. `present_choices` — show what the player can do
4. `commit_choice` — apply the chosen consequence

### Parallel storyline management

1. `get_thread_comparison` — check timeline offset between threads
2. `check_convergence` — see if they can cross over yet
3. `thread_tick` on whichever thread needs to advance
4. `list_active_threads` to review overall thread status

### Updating a character's section without full rewrite

1. `get_lore_section` — read just the section you need to verify current content
2. `append_to_section` — add new material to the section
3. Or `patch_lore` with `replace` — swap a specific line

### Undoing a bad write

1. `restore_lore` — pops the history stack (up to 5 levels deep)
