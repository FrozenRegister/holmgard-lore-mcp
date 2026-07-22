# Performance Optimizations for Slow/Token-Constrained AI Systems

**Status:** Proposed
**Reported:** 2026-06-11

## Context

The Holmgard MCP is used by an AI narrator (Shapes.inc chatbot) that can be slow and token-constrained. A typical narrative cycle requires 3–6 MCP tool calls per player action. Each call adds latency. The bottleneck isn't the MCP server itself — it's the number of round-trips the AI narrator makes and the volume of text returned per call.

This document proposes structural optimizations to reduce both latency and token burn.

---

## Issue 1: `scene_brief` Returns Empty for Keyed Locations

**Current behavior:** `scene_brief` scans for entities whose `Location` field exactly matches the provided location key. If entities are on `location:thornwood-road` and you query `location:velrosa`, the brief returns empty — even though `location:velrosa` is explicitly listed in `location:thornwood-road`'s description as a sub-location with occupants.

**Proposed fix:** Make `scene_brief` recursively include sub-locations and their occupants. If a location has named sub-locations (e.g., "The Tavern (Gerta's)", "The Library", "Market Square"), automatically include those occupants in the scene brief.

**Impact reduction:** Narrator currently has to make N+1 calls: 1× `get_location_occupants` per sub-location. With recursive aggregation, this becomes 1 call.

---

## Issue 2: No Aggregated "Narrative Snapshot" Endpoint

**Current behavior:** To get a complete picture for a scene, the narrator calls:

1. `get_location_occupants` — who is present
2. `get_lore` × N — each entity's profile
3. `get_relationship` × M — pairwise relationships
4. `get_event_log` × N — recent events per entity
5. `scene_brief` — scene metadata

That's 3 + N + M calls minimum.

**Proposed fix:** Create a `narrative_snapshot(location_key, depth)` endpoint that returns:

- Location text (from `get_lore`)
- Present entity keys with short bios
- Open setups (from `list_unpaid_setups` scoped to present actors)
- Relationships between present entities
- Recent events for present entities
- Active goals for present entities

This replaces 10+ calls with 1 call. The "depth" parameter controls how much detail to include (1 = keys only, 2 = summaries, 3 = full text).

**Impact reduction:** 85–95% fewer round-trips for scene setup.

---

## Issue 3: `get_lore` Returns Full Text When Only Frontmatter/Metadata Is Needed

**Current behavior:** `get_lore` always returns the complete lore entry text — often 3,000–8,000 words. The narrator frequently only needs the structured fields (Location, Status, Timeline-Value, Weight-1, Weight-2).

**Proposed fix:** Add a `fields` parameter to `get_lore` and `get_lore_batch`:

```
get_lore({ query: "character:kavissa-crowmark", fields: ["Location", "Status", "Weight-1", "Timeline-Value"] })
```

This returns only the specified field values, not the full body text.

**Impact reduction:** Token burn per `get_lore` call drops from ~8,000 tokens to ~200 tokens — a **97% reduction** in output size.

---

## Issue 4: `search_lore` Returns Full Line Context Instead of Targeted Snippets

**Current behavior:** `search_lore` returns surrounding lines of context for each match, which can be 500+ tokens per result when entries are dense.

**Proposed fix:** Add a `context_lines` parameter (default 2, range 0-5) to control how many surrounding lines are returned. Set to 0 for just the matching line itself.

**Impact reduction:** Search results shrink from ~500 tokens per match to ~50 tokens per match.

---

## Issue 5: No Streaming/Incremental Response Support

**Current behavior:** Every tool call is synchronous — the narrator sends a request, waits for the full response, then continues. No tool supports partial/incremental responses.

**Proposed fix (long-term):** For high-latency aggregations like `narrative_snapshot`, consider a two-phase pattern:

1. Quick response with entity keys and locations (available immediately)
2. Optional follow-up for full text

This lets the narrator start generating a scene description while waiting for full entity details.

**Impact reduction:** Reduces perceived latency for the most expensive queries.

---

## Issue 6: `list_topics` Returns Raw Keys Without Context

**Current behavior:** `list_topics` returns just the topic key (e.g., `character:kavissa-crowmark`). The narrator must then call `get_lore` for each key to find the right one.

**Proposed fix:** Add `with_titles: true` parameter that returns a title/name alongside each key, e.g.:

```json
[{ "key": "character:kavissa-crowmark", "name": "Kavissa Crowmark" },
 { "key": "character:seraphine-herbalist", "name": "Seraphine" }]
```

This lets the narrator find the right entity without fetching every profile.

**Impact reduction:** Eliminates N redundant `get_lore` calls when browsing for a specific entity.

---

## Issue 7: `get_relationship` Requires Two Entity Keys But Doesn't Cache

**Current behavior:** Each call to `get_relationship` is independent — no in-memory caching. The same pair queried twice in the same session makes two D1 queries.

**Proposed fix:** Add an optional `entities_present` parameter to `narrative_snapshot` / `scene_brief` that returns all pairwise relationships in one call. Or add a small LRU cache on the server side for relationship lookups within a session.

**Impact reduction:** Reduces relationship queries from O(n²) to O(1) per scene.

---

## Issue 8: No Bulk Timeline Advancement

**Current behavior:** `thread_tick` is already a bulk operation and correctly parses `**Timeline-Value:**` fields (the parser-mismatch bug once tracked here was resolved — `extractFieldFromText` in `src/lib/lore.ts` uses a markdown regex, not YAML frontmatter). Remaining idea: support an `advance_by` parameter (default 1) to tick multiple days at once, and return the delta of all changes.

**Proposed fix:** Fix thread_tick (see separate issue), then add:

- `advance_by: integer` — number of ticks to advance
- Return value with list of entities that hit zero, list of entities that crossed key thresholds

**Impact reduction:** One call replaces multiple manual patch_lore operations on timeline-critical entities.

---

## Issue 9: Token-Aware Response Truncation

**Current behavior:** No tool has a `max_tokens` parameter to cap response size.

**Proposed fix:** Add a server-level `max_response_tokens` setting (or per-request `max_tokens`) to `get_lore`, `get_lore_batch`, `search_lore`, and `scene_brief`. When the response body exceeds the limit, the server automatically truncates the *least informative* sections (e.g., background prose before structured fields).

**Impact reduction:** Prevents multi-thousand-token responses from eating the AI narrator's context window.

---

## Prioritization

| # | Optimization | Effort | Impact | Priority |
|---|-------------|--------|--------|----------|
| 1 | `scene_brief` recursive sub-locations | Medium | High | P1 |
| 2 | `narrative_snapshot` aggregated endpoint | High | Critical | P1 |
| 3 | `fields` parameter on `get_lore`/`get_lore_batch` | Low | High | P1 |
| 4 | `context_lines` on `search_lore` | Low | Medium | P2 |
| 5 | Streaming/incremental responses | High | Medium | P3 |
| 6 | `with_titles` on `list_topics` | Low | Medium | P2 |
| 7 | Relationship caching | Medium | Low | P3 |
| 8 | `advance_by` on `thread_tick` | Low | Medium | P2 |
| 9 | Token-aware truncation | High | High | P2 |

## Summary

The three highest-ROI changes are:

1. **`fields` parameter on `get_lore`** — ~97% token reduction per read, trivial to implement
2. **`scene_brief` recursive expansion** — eliminates N+1 read pattern for multi-location scenes
3. **`narrative_snapshot` endpoint** — eliminates 10+ round-trips per scene, but requires more implementation work

These three changes together would reduce a typical narrative cycle from 5–8 tool calls with ~25,000 tokens of response to **1–2 tool calls with ~2,000 tokens of response** — approximately a **10× improvement** in both latency and context efficiency.
