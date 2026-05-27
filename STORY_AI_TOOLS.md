# Holmgard Lore MCP — Story AI Tool Guide

This document covers the 14 narrative tools added beyond the core lore CRUD set. Each section explains **when** to reach for the tool, what it gives back, and how to use it well.

---

## Key Concepts

**Keys** follow a `type:name` convention: `character:aldric`, `location:eastgate`, `item:iron_crown`, `faction:ironseal`, `scene:prologue`, `setup:crown_prophecy`.

**Markdown fields** inside lore text use `**FieldName:** value` syntax. Many tools read and write these fields directly.

**`events:` namespace** — separate from lore text, stores a per-entity action log. Use `append_event` to write; `get_event_log` to read. Never appears in `list_topics`.

**`setup:` keys** — visible in `list_topics`. These are narrative setups (Chekhov's guns). They have their own lifecycle: planted → open → paid/abandoned/deferred.

---

## Phase 1 — Event Log & Causality

### `append_event`

Record that something happened to an entity — a character act, a location change, an item use. This is your primary tool for maintaining a causal record during play.

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
- `verb` — required. Keep it a lowercase past-tense verb: `"attacked"`, `"fled"`, `"betrayed"`, `"revealed"`.
- `object` — what or whom the verb was directed at.
- `location` — where it happened (use a location key if possible).
- `thread` — narrative thread or subplot name. Useful for later filtering.
- `detail` — one sentence of context that won't fit in verb+object.
- `at` — override timestamp (ISO 8601). Omit to use server time.

**Deduplication:** Events with the same `verb` + `object` within 1 second are silently skipped. You don't need to guard against double-calls.

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

## Phase 2 — Tags & Bookmarks

### `tag_topic`

Add or remove classification tags on any lore key. Tags are written into the key's lore text as a `**Tags:**` field and are also indexed in a fast reverse lookup.

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
- Calling `tag_topic` with no `add` or `remove` is a no-op (returns current tags).
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
  "changed": [{ "key": "character:aldric", "from_version": 3, "to_version": 7, ... }]
}
```

---

## Phase 3 — Setup Ledger

This trio tracks narrative plants (Chekhov's guns): things introduced to be paid off later.

### `plant_setup`

Register a narrative setup — a promise to the reader that this element will matter.

**When to call it:** When you introduce an object, secret, threat, or relationship that you intend to pay off later. Plant it immediately so it doesn't get forgotten.

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

## Phase 4 — Intent & Continuity

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
- `scope` — narrow to keys starting with this string, or containing it.
- `checks` — subset of `["dangling", "occupancy", "knowledge", "inventory"]`. Default: all four.
  - `dangling` — finds `type:key` references in text that point to nonexistent keys.
  - `occupancy` — finds characters whose `**Location:**` field points to a nonexistent location key.
  - `inventory` — finds item/weapon/armor refs in `**Inventory:**` / `**Items:**` fields that don't exist.
  - `knowledge` — reserved for future use (currently a no-op check).
- `severity_floor` — `"info"`, `"warn"`, or `"error"`. Filters findings below this level.

**Response:** List of findings, each with `key`, `check` type, `severity`, and `message`. Up to 20 findings shown in the summary text; full list in `findings` array.

---

## Phase 5 — Scene Composition

### `scene_brief`

Pull a composite scene brief for a location: the location's lore text, occupants (characters/entities with a matching `**Location:**` field), their active goals and recent events, open setups relevant to those characters, and pairwise relationship fields.

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
      "events": [ { "verb": "threatened", "object": "character:sera", ... } ]
    }
  ],
  "open_setups": [ { "id": "crown_prophecy", "description": "...", "tension": 4 } ],
  "relationships": [ { "entity_a": "...", "entity_b": "...", "affinity": "-3", "threat_level": "high" } ]
}
```

---

### `render_pov`

Render a scene filtered through one character's perceptual access. Lines tagged `[hidden]` or `[concealed]` in the location text are suppressed if the character's perception is below 0.7; `[threat]` and `[danger]` lines are suppressed below 0.4. Entities tagged `[hidden]`, `[concealed]`, or `[invisible]` in their lore are excluded from the visible list at the same threshold.

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
  "visible_entities": [
    { "key": "character:aldric", "status": "armed", "known": true }
  ],
  "voice_hints": { "diction": "clipped, formal", "register": "cold", "fixations": "exits, weapons" },
  "knowledge_scope": ["character:aldric", "faction:ironseal"]
}
```

`known: true` means this entity appears in the POV character's `**Knows:**` or `**Knowledge:**` field.

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
