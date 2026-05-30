# Holmgard Lore MCP

A Cloudflare Worker implementing a JSON-RPC 2.0 / MCP interface for narrative worldbuilding. Stores and retrieves lore entries (characters, locations, factions, items, events, choices) with advanced indexing, state machines, and interactive story pathways.

## Overview

This project exposes:
- `/mcp` — JSON-RPC 2.0 endpoint with **57 MCP tools** for narrative management
- `/admin/set-lore` and `/admin/delete-lore` — HTTP endpoints protected by `ADMIN_SECRET`
- Cloudflare KV storage with **index-on-write optimization** and fallback in-memory storage
- Features: versioned entries, event logs, choice tracking, faction standing, state machines, sensory profiles, and multi-thread timeline management

## Requirements

- Node.js 18+
- npm
- Cloudflare Wrangler CLI
- Cloudflare account with a KV namespace bound as `LORE_DB`
- `ADMIN_SECRET` environment variable for admin endpoints (set via `wrangler secret put`)

## Installation

```bash
npm install
```

## Development & Testing

```bash
npm run dev                        # Start local dev server with wrangler
npm test                           # Run vitest suite in Workers runtime
npm test -- --reporter=verbose     # Verbose output with per-test names
npm test -- src/__tests__/worker.test.ts  # Run single test file
```

## Build & Deploy

```bash
npm run build                      # Bundle with esbuild → dist/index.js
npm run deploy                     # Deploy to Cloudflare Workers
```

## Configuration

Binding and secrets are defined in `wrangler.jsonc`:

```jsonc
{
  "kv_namespaces": [
    { "binding": "LORE_DB", "id": "67b47914eb094043ab777f4f34da8bfc" }
  ]
}
```

Set secrets via:
```bash
wrangler secret put ADMIN_SECRET  # local dev: "test-secret-123" (configured in vitest.config.ts)
```

## Storage Format

Entries are stored in KV as JSON with versioning and metadata:

```json
{
  "text": "Character description, lore content, etc.",
  "meta": {
    "version": 1,
    "createdAt": "2026-05-23T00:00:00.000Z",
    "updatedAt": "2026-05-30T12:34:56.000Z"
  }
}
```

Plain-string values (legacy format) are automatically parsed and upgraded on read.

## Index-on-Write System

Three types of indexes maintain read performance:

- `_idx:prefix:<prefix>` — All keys starting with a prefix (e.g., `character:`, `location:`, `setup:`)
- `_idx:location:<location-key>` — All entities currently at a location
- `_idx:thread:<thread-id>` — All entities in a timeline thread

Indexes are rebuilt automatically when entries are created, modified, or deleted. They are read-through: if an index doesn't exist, tools fall back to KV scanning and filtering.

**Excluded from listing**: Index keys (`_idx:*`), history (`_history:*`), changelog, events, and snapshots are automatically filtered from `kvList()` results.

## JSON-RPC 2.0 Endpoint

### `POST /mcp`

All requests must be JSON-RPC 2.0 with a `method` field. Three types of methods are supported:

**Standard MCP methods:**
- `initialize` — returns server metadata and tool discovery capability
- `ping` — returns an empty success response
- `tools/list` — returns all available tools and their input schemas
- `tools/call` — invokes a tool by `params.name` and `params.arguments`

**Legacy methods (also work via `tools/call`):**
- `list_topics` — returns all lore topic keys
- `get_lore` — retrieves a single lore entry by `key` or `query`

## 57 MCP Tools

### Core Lore Management

- **`list_topics`** — list all topic keys
- **`get_lore`** `key` or `query` — retrieve a single entry
- **`get_lore_batch`** `keys` (array) — retrieve multiple entries in parallel
- **`get_lore_section`** `key`, `sections` (array) — retrieve specific ## sections from an entry
- **`set_lore`** `key`, `text` — create or overwrite a lore entry
- **`delete_lore`** `key` — permanently delete an entry
- **`batch_set_lore`** `entries` (array of {key, text}) — write multiple entries
- **`patch_lore`** `key`, `operation` (replace|append|delete_field), `target`, `value` — surgically modify text
- **`batch_mutate`** `mutations` (array) — apply increment or patch operations sequentially
- **`restore_lore`** `key` — restore an entry to its previous version (up to 5 deep)

### Searching & Discovery

- **`search_lore`** `query`, `max_results` — full-text search across all entries
- **`validate_topic_exists`** `query_string` — check if a topic exists with suggestions
- **`find_by_tag`** `tags` (array), `mode` (any|all), `with_excerpt` — search by thematic tags
- **`list_unpaid_setups`** `actor`, `scope`, `min_tension` — find open story promises by tension level

### Versioning & History

- **`increment_topic_field`** `key`, `field_path`, `increment`, `reason` — increment numeric fields (e.g., days remaining)
- **`append_to_section`** `key`, `section`, `text`, `position` (start|end) — add text to a named ## section
- **`append_event`** `entity_key`, `verb`, `object`, `location`, `thread`, `detail`, `at` — log an event to an entity's chronicle
- **`get_event_log`** `entity_key`, `thread`, `since`, `until`, `verbs`, `limit` — retrieve event history
- **`recent_changes`** `key_prefix`, `since`, `limit` — KV mutation feed (what changed while you were out)
- **`bookmark_state`** `name`, `note`, `key_prefix` — snapshot the world state
- **`world_diff`** `from` (bookmark), `to` (bookmark), `key_prefix`, `detail` — compare snapshots

### Entities & Characters

- **`get_inventory`** `entity_key` — parse and return items an entity carries
- **`transfer_item`** `from_entity`, `to_entity`, `item_key`, `quantity` — move items between inventories
- **`get_entity_knowledge`** `entity_key`, `topic` — what does an entity know (prevent omniscience)
- **`get_sensory_profile`** `entity_key` — temperature, scent, texture, sound, visual descriptors
- **`get_choice_history`** `entity_key` — narrative path through branching choices
- **`set_goal`** `entity_key`, `goal_id`, `description`, `status`, `obstacle`, `parent` — define or track entity goals
- **`generate_entity`** `archetype_key`, `location_key` — spawn a new instance from an archetype

### Relationships & Factions

- **`get_relationship`** `entity_a`, `entity_b` — scan affinity, debt, threat-level, and cross-references
- **`get_faction_standing`** `entity_key`, `faction_key` — membership status, rank, reputation, threats
- **`get_compatibility`** `entity_a`, `entity_b`, `interaction_type` — validate interactions by size ratio and weight thresholds
- **`get_location_occupants`** `location_key` — scan for all entities at a location

### Environment & Perception

- **`sense_environment`** `location_key`, `entity_key` — render location details filtered by entity's perception
- **`get_reachable_locations`** `origin_key` — read Exits/Connections and return adjacent locations with costs
- **`render_pov`** `pov_entity_key`, `scene_key` or `location_key`, `reveal_threshold`, `include_voice_hints` — reproject a scene through one entity's senses and knowledge

### State Machines & Timelines

- **`advance_state_stage`** `entity_key` — tick an entity through its state machine stages
- **`process_stage_batch`** `location_key` — tick all entities at a location that have stages
- **`thread_tick`** `thread_id` — advance a timeline thread by one tick, then sync cross-thread convergences
- **`check_convergence`** `thread_a`, `thread_b` — determine if two threads can intersect
- **`get_thread_comparison`** `thread_a`, `thread_b` — compare entity counts, timeline values, and overlaps
- **`list_consumption_timelines`** `status_filter` (all|imminent|days-to-weeks|weeks-to-months|consumed) — all character consumption states

### Choices & Narrative

- **`present_choices`** `scene_key`, `entity_key` — filter valid choices against inventory and weight
- **`commit_choice`** `choice_id`, `entity_key` — apply choice consequences and unlock next choices
- **`plant_setup`** `id`, `description`, `actors`, `tension`, `planted_in`, `expected_in` — register a story promise (Chekhov's gun)
- **`pay_off_setup`** `id`, `resolution`, `status` (paid|abandoned|deferred), `paid_in` — close a setup debt

### Interactions & Combat

- **`resolve_interaction`** `entity_a_id`, `entity_b_id`, `action_type` — weighted probability outcome (Weight-1 vs Weight-2)
- **`roll_encounter`** `location_key`, `threat_level` — generate an entity instance from a location's encounter table
- **`get_compatibility`** `entity_a`, `entity_b`, `interaction_type` — validate size ratio, weight thresholds, and environment overlap

### Analysis & Utility Scoring

- **`analyze_utility`** `entity_id`, `utility_vector` (GASTRIC|BUTCHERY|INCUBATION|SCULPTURE|PARASITISM|THRALL|DISTRIBUTED), `entity_role` (subject|actor) — score suitability for a narrative pathway

### Scene & Location Tools

- **`activate_scene`** `scene_key` — set active scene and hydrate entities and location
- **`scene_brief`** `scene_key` or `location_key`, `include` — assemble location text, entities, setups, relationships, and sensory data
- **`get_location_occupants`** `location_key` — find all entities at a location

### Tags & Metadata

- **`tag_topic`** `key`, `add`, `remove` — attach thematic tags (cross-prefix) for discovery
- **`map_integration`** `source_id`, `target_id`, `integration_depth` — transfer [Transferable]-tagged traits on state merge

### Administrative

- **`check_authentication`** — verify API key validity
- **`check_continuity`** `checks`, `scope`, `severity_floor` — scan for dangling refs, occupancy conflicts, inventory ghosts
- **`ping_tool`** — trivial validation tool

## Example JSON-RPC Request

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_lore",
    "arguments": {
      "query": "character:zira"
    }
  }
}
```

## Example Response

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Full lore entry text for character:zira..."
      }
    ],
    "key": "character:zira",
    "text": "Full lore entry text...",
    "meta": {
      "version": 3,
      "createdAt": "2026-05-20T10:00:00.000Z",
      "updatedAt": "2026-05-30T15:22:30.000Z"
    }
  }
}
```

## HTTP Admin Endpoints

Protected by `ADMIN_SECRET`. Use the HTTP endpoints for direct admin operations (outside of JSON-RPC).

### `POST /admin/set-lore`

```json
{
  "key": "character:new-npc",
  "text": "NPC description, stats, relationships...",
  "secret": "your-admin-secret"
}
```

### `POST /admin/delete-lore`

```json
{
  "key": "character:new-npc",
  "secret": "your-admin-secret"
}
```

## Notes

- CORS is enabled for all origins on `/mcp`
- Batch JSON-RPC requests are not supported
- The project uses `esbuild` to bundle `src/index.ts` into `dist/index.js`
- `dist/` is generated output and should not be edited directly

## Project scripts

- `npm run build` — bundle the Worker
- `npm run dev` — run local Wrangler dev
- `npm run deploy` — deploy to Cloudflare
- `npm run clean` — remove `dist`

## Local testing

Run the Worker locally with:

```bash
npm run dev
```

Example `curl` request against the `/mcp` endpoint:

```bash
curl -X POST http://127.0.0.1:8787/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_lore","arguments":{"query":"lamia"}}}'
```

## Example MCP Method Responses

### `initialize`

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": { "tools": { "list": true, "call": true } },
    "serverInfo": {
      "name": "holmgard-lore-mcp",
      "version": "1.0.0"
    }
  }
}
```

### `tools/list` (excerpt)

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "get_lore",
        "title": "Get Lore",
        "description": "Retrieve lore by topic key or query.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "query": { "type": "string", "description": "Topic key to retrieve" }
          }
        }
      }
      // ... 56 more tools
    ]
  }
}
```

## Environment Variables

### `ADMIN_SECRET`
Protect admin endpoints (`/admin/set-lore`, `/admin/delete-lore`) with this secret.

**Production:** Set via `wrangler secret put ADMIN_SECRET`  
**Local tests:** Automatically injected as `test-secret-123` (see `vitest.config.ts`)

## Project Scripts

```bash
npm run build      # Bundle src/index.ts with esbuild → dist/index.js
npm run dev        # Start local Wrangler dev server
npm run deploy     # Deploy to Cloudflare Workers
npm test           # Run vitest suite in Workers runtime
npm run clean      # Remove dist/ directory
```

## Testing

Tests run inside the actual Cloudflare Workers runtime via `@cloudflare/vitest-pool-workers`. KV storage is in-memory (miniflare).

**Key testing patterns:**
- Use `env.LORE_DB.put()` to seed test data (bypasses `set_lore` to keep tests isolated)
- `reset()` from `cloudflare:test` wipes all KV between tests
- Both MCP tool logic and HTTP endpoints are tested

**Smoke tests:** Run `test-holmgard-mcp.ps1` (PowerShell) for end-to-end tests against a deployed worker.

## Architecture Notes

- **Single-file worker:** All logic in `src/index.ts` (Hono app)
- **KV-first:** `LORE_DB` is source of truth; `loreDB` module-level fallback for offline dev
- **Versioned entries:** All writes increment metadata version and store creation/update timestamps
- **History tracking:** Up to 5 prior versions per entry, restorable via `restore_lore`
- **Index-on-write:** Automatic prefix, location, and thread indexes for fast lookups
- **CORS enabled:** `/mcp` accepts cross-origin requests
- **No batch JSON-RPC:** Only single requests per call

## Notes

- All KV keys are **lowercase** with `:` namespacing (e.g., `character:zira`, `location:undercity`)
- Markdown-style fields (`**Field-Name:** value`) are parsed for automation (state machines, consumption timelines, goals, etc.)
- `patch_lore` requires exact substring matching and rejects ambiguous targets
- Indexes exclude system keys: `_idx:*`, `_history:*`, `_changelog`, `events:*`, `_snapshot:*`, `_tags:*`, `map:*`
- Response format is always `{ content: [{ type: 'text', text: '...' }], ... }` for MCP compatibility

## Quick Start

1. **Clone & install:**
   ```bash
   npm install
   npm run build
   ```

2. **Run locally:**
   ```bash
   npm run dev
   ```
   Access `/mcp` endpoint at `http://127.0.0.1:8787/mcp`

3. **Test it:**
   ```bash
   npm test
   ```

4. **Deploy:**
   ```bash
   wrangler secret put ADMIN_SECRET  # Set your secret
   npm run deploy
   ```

See [CLAUDE.md](CLAUDE.md) for detailed architecture, KV access patterns, and development guidelines.
