# Holmgard Lore MCP

A Cloudflare Worker implementing the Model Context Protocol (MCP) for narrative worldbuilding and RPG engine operations. Stores and retrieves lore entries (characters, locations, factions, items, events, choices) with advanced indexing, state machines, interactive story pathways, and full D1 database-backed RPG mechanics.

## Overview

This project exposes:

- `/mcp` — JSON-RPC 2.0 / Streamable HTTP endpoint with **5 core tools + 2 RPG tools + 2 meta-tools** for narrative and RPG management
- Durable Object-backed MCP server with support for both legacy JSON-RPC and spec 2025-03-26 Streamable HTTP transport
- Cloudflare KV storage (`LORE_DB`) with **index-on-write optimization** and in-memory fallback
- Cloudflare D1 SQLite database (`RPG_DB`) for characters, combat, parties, quests, and session management
- Cloudflare Workers AI integration for agent-based NPC behavior
- Features: versioned entries, event logs, choice tracking, faction standing, state machines, sensory profiles, multi-thread timeline management, and full combat/encounter system

## Requirements

- Node.js 22+
- pnpm (package manager; see `packageManager` in `package.json`)
- Cloudflare Wrangler CLI
- Cloudflare account with:
  - KV namespace bound as `LORE_DB` (source of truth for lore entries)
  - D1 database bound as `RPG_DB` (character and campaign data)
  - Durable Object class `HolmgardMCP` configured
  - Workers AI binding (for agent NPC behavior)
- `ADMIN_SECRET` environment variable for admin endpoints (set via `wrangler secret put` in production; auto-injected in tests)
- `MCP_API_KEY` (optional) — if set, requests must include `X-Api-Key` header

## Installation

```bash
pnpm install
```

## Development & Testing

```bash
pnpm run dev                        # Start local dev server with wrangler
pnpm test                           # Run vitest suite in Workers runtime
pnpm test -- --reporter=verbose     # Verbose output with per-test names
pnpm test -- src/__tests__/crud.test.ts  # Run single test file
pnpm test:coverage                  # Generate coverage report (lcov)
pnpm test:live                      # Run smoke tests against production (requires MCP_API_KEY)
```

See [CLAUDE.md](CLAUDE.md) for complete testing & validation procedures, including the mandatory pre-commit hook setup.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how a request flows through the system, the KV/D1 storage split, and the index-fallback and history-snapshot patterns.

## Build & Deploy

```bash
pnpm run build                      # Dry-run deploy (generates dist/)
pnpm run deploy                     # Deploy to Cloudflare Workers
```

## Configuration

Bindings and secrets are defined in `wrangler.jsonc`:

```jsonc
{
  "kv_namespaces": [
    { "binding": "LORE_DB", "id": "...", "preview_id": "..." }
  ],
  "durable_objects": {
    "bindings": [
      { "name": "MCP_OBJECT", "class_name": "HolmgardMCP" }
    ]
  },
  "d1_databases": [
    { "binding": "RPG_DB", "database_name": "holmgard-rpg", "database_id": "...", "preview_database_id": "..." }
  ],
  "ai": { "binding": "AI" }
}
```

Set secrets via:

```bash
wrangler secret put ADMIN_SECRET        # Production: set your secret. Local tests auto-inject "test-secret-123" (vitest.config.ts)
wrangler secret put MCP_API_KEY         # Optional: if set, all /mcp requests require X-Api-Key header
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

## MCP Tools & Actions

The server exposes tools via JSON-RPC 2.0 or Streamable HTTP. All tools use an **action-based architecture** where you call a tool with an `action` parameter specifying the operation.

### MCP Protocol Methods

- `initialize` — returns server metadata and tool list
- `ping` — health check
- `tools/list` — returns all available tools with schemas
- `tools/call` — invokes a tool by name with action parameters

### Core Tools (5)

#### 1. `lore_manage` — KV lore store operations

**Actions:** `get`, `get_batch`, `get_section`, `list`, `list_maps`, `get_map`, `search`, `validate`, `set`, `delete`, `patch`, `batch_set`, `batch_mutate`, `restore`, `history`, `increment`, `append_section`

Core lore management: read, write, search, and mutate entries with versioning and history.

#### 2. `entity_manage` — Entity lifecycle and interactions

**Actions:** `generate`, `move`, `roll_encounter`, `advance_stage`, `batch_stage`, `get_inventory`, `transfer_item`, `get_sensory_profile`, `get_compatibility`, `analyze_utility`, `map_integration`, `list_consumption_timelines`, `list_active_threads`, `resolve_interaction`, `destroy`

Entity creation, movement, inventory, encounters, and consumption timelines.

#### 3. `world_manage` — World state and relationships

**Actions:** `thread_tick`, `get_relationship`, `get_faction_standing`, `get_entity_knowledge`, `get_location_occupants`, `get_reachable_locations`, `sense_environment`, `get_thread_comparison`, `check_convergence`

Threads, relationships, factions, knowledge, locations, and convergence checks.

#### 4. `scene_manage` — Scene and choice management

**Actions:** `activate`, `present_choices`, `commit_choice`, `get_history`, `brief`, `render_pov`

Scene activation, choice presentation, and POV rendering.

#### 5. `continuity_manage` — Narrative continuity and tracking

**Actions:** `append_event`, `get_event_log`, `recent_changes`, `tag_topic`, `find_by_tag`, `list_tags`, `bookmark_state`, `world_diff`, `plant_setup`, `pay_off_setup`, `list_unpaid_setups`, `set_goal`, `check_continuity`

Events, tags, bookmarks, world diffs, setups, goals, and continuity checks.

### RPG Tools (2 primary + 24 sub-systems)

#### 6. `rpg` — RPG engine unified dispatch

**Sub-systems:** `math`, `world`, `character`, `party`, `quest`, `item`, `inventory`, `corpse`, `narrative`, `secret`, `theft`, `aura`, `improvisation`, `npc`, `session`, `combat`, `combat_action`, `combat_map`, `spawn`, `strategy`, `turn`, `spatial`, `world_map`, `batch`, `travel`, `perception`, `scene`

D1-backed RPG system with character management, combat, encounters, quests, and session tracking. Call with `{ sub: "character", action: "create", ... }`.

#### 7. `agent_manage` — NPC AI agent management

**Actions:** `create`, `get`, `list`, `update`, `delete`, `resume`, `health`, `budget`, `set_slice`, `remove_slice`, `toggle_slice`, `list_slices`, `narrate`, `broadcast`, `preview_prompt`, `add_secret`, `list_secrets`, `remove_secret`, `add_journal`, `get_journal`, `invoke`, `replay`

Cloudflare Workers AI-backed NPC behavior and intention system.

### Meta-Tools (2)

#### 8. `search_tools` — Tool discovery

Fuzzy-search the full tool catalog by name or description.

#### 9. `load_tool_schema` — Get tool input schema

Return the full JSON schema for a named tool to see all available parameters.

## Example JSON-RPC Request

Get a lore entry using `lore_manage` with action `get`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "lore_manage",
    "arguments": {
      "action": "get",
      "query": "character:zira"
    }
  }
}
```

Create a character using `rpg` with sub-system `character` and action `create`:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "rpg",
    "arguments": {
      "sub": "character",
      "action": "create",
      "name": "Aldric",
      "characterClass": "fighter",
      "race": "human",
      "level": 1
    }
  }
}
```

## Example Response

Response from `lore_manage` action `get`:

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

Response from `rpg` action `create` (character):

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "id": "char_6a9e2f1c",
    "name": "Aldric",
    "characterClass": "fighter",
    "race": "human",
    "level": 1,
    "hp": 10,
    "maxHp": 10,
    "createdAt": "2026-06-15T12:00:00.000Z"
  }
}
```

## HTTP Admin Endpoints

Protected by `ADMIN_SECRET` (passed as `X-Admin-Secret` header). Direct HTTP endpoints for admin operations outside JSON-RPC.

### `POST /admin/set-lore`

```bash
curl -X POST http://127.0.0.1:8787/admin/set-lore \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: your-admin-secret" \
  -d '{
    "key": "character:new-npc",
    "text": "NPC description, stats, relationships..."
  }'
```

### `POST /admin/delete-lore`

```bash
curl -X POST http://127.0.0.1:8787/admin/delete-lore \
  -H "X-Admin-Secret: your-admin-secret" \
  -d '{"key": "character:new-npc"}'
```

### `GET /health`

```bash
curl http://127.0.0.1:8787/health
# Returns: { "status": "ok", "timestamp": 1234567890 }
```

## Notes

- **CORS** is enabled for all origins on `/mcp`, `/health`, and `/admin` endpoints
- **API Key Auth** (optional): If `MCP_API_KEY` is set, all `/mcp` requests must include `X-Api-Key` header
- **Streamable HTTP** (MCP spec 2025-03-26): Requests with `Mcp-Session-Id` header or `text/event-stream` Accept header are routed to the Durable Object
- **Legacy JSON-RPC** (POST /mcp): Still supported; falls through from streamable HTTP middleware
- **Batch JSON-RPC requests** are not supported
- **Rate limiting** is enforced (see `src/middleware/rate-limit.ts`)
- **Health endpoint** (`GET /health`) is unauthenticated for load balancers and monitoring
- The project bundles with `esbuild` (via `wrangler build`) → `dist/index.js` (generated, not edited)

## Project scripts

```bash
pnpm run dev           # Start local dev server (wrangler)
pnpm run build         # Dry-run deploy (generates dist/)
pnpm run deploy        # Deploy to Cloudflare Workers
pnpm test              # Run tests via vitest (Workers runtime)
pnpm test:coverage     # Tests + coverage report
pnpm test:live         # Smoke tests against production
pnpm run lint          # ESLint validation
pnpm run type-check    # TypeScript type checking
pnpm run fix:md        # Auto-fix markdown formatting
```

## Local testing

Start the local dev server:

```bash
pnpm run dev
```

The server runs on `http://127.0.0.1:8787` with KV and D1 handled by miniflare.

### Example requests

Get a lore entry:

```bash
curl -X POST http://127.0.0.1:8787/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "lore_manage",
      "arguments": {
        "action": "get",
        "query": "character:zira"
      }
    }
  }'
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

Run all tests:

```bash
pnpm test
```

Run tests with verbose output:

```bash
pnpm test -- --reporter=verbose
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
        "name": "lore_manage",
        "title": "Lore Manage",
        "description": "KV lore store — read, write, search, and mutate lore entries. Actions: get, get_batch, get_section, list, list_maps, ...",
        "inputSchema": {
          "type": "object",
          "properties": {
            "action": { "type": "string", "description": "Action to perform (get, set, list, etc.)" }
          },
          "required": ["action"],
          "additionalProperties": true
        }
      },
      {
        "name": "entity_manage",
        "title": "Entity Manage",
        "description": "Entity lifecycle — generate, move, inventory, encounters, ...",
        "inputSchema": { ... }
      }
      // ... 7 more tools (world_manage, scene_manage, continuity_manage, rpg, agent_manage, search_tools, load_tool_schema)
    ]
  }
}
```

## Environment Variables

### `ADMIN_SECRET`

Protect admin endpoints (`/admin/set-lore`, `/admin/delete-lore`) via `X-Admin-Secret` header.

**Production:** Set via `wrangler secret put ADMIN_SECRET`  
**Local tests:** Auto-injected as `test-secret-123` (see `vitest.config.ts`)

### `MCP_API_KEY` (optional)

If set, all `/mcp` requests must include `X-Api-Key: <value>` header.

**Production:** Set via `wrangler secret put MCP_API_KEY`  
**Local tests:** Leave unset (no auth required)

### `MCP_OBJECT` (Durable Object binding)

Configured in `wrangler.jsonc`. Routes requests to the HolmgardMCP Durable Object instance.

## Testing

Tests run inside the actual Cloudflare Workers runtime via `@cloudflare/vitest-pool-workers` with Miniflare for KV/D1 storage.

### Test Suites

1. **Unit/Integration tests** (`pnpm test`): Run full `src/__tests__/*.test.ts` suite in Workers runtime
2. **Coverage** (`pnpm test:coverage`): Generate LCOV report to `./coverage/lcov.info`
3. **Live smoke tests** (`pnpm test:live`): End-to-end tests against production worker (requires `MCP_API_KEY` env var)

**Key testing patterns:**

- Seed test data with `env.LORE_DB.put(key, JSON.stringify({ text, meta }))` (bypasses handlers for isolation)
- Seed D1 with direct `env.RPG_DB.prepare(...).run()`
- `reset()` from `cloudflare:test` wipes all storage between tests
- Both MCP tool logic and HTTP endpoints are tested

## Architecture Notes

- **Durable Object-backed MCP:** HolmgardMCP DO handles both legacy JSON-RPC and spec 2025-03-26 Streamable HTTP transport
- **Dual storage:**
  - `LORE_DB` (KV) — narrative lore entries (source of truth)
  - `RPG_DB` (D1) — characters, sessions, combat, quests (RPG system state)
- **Versioned KV entries:** All writes increment metadata (version, createdAt, updatedAt)
- **History tracking:** Up to 5 prior versions per KV entry, restorable via `restore` action in `lore_manage`
- **Index-on-write:** Automatic prefix, location, and thread indexes for fast lookups in KV
- **Workers AI integration:** `agent_manage` invokes Cloudflare AI for NPC behavior generation
- **Tool architecture:** Meta-tools accept `action` parameters (e.g., `{ name: "lore_manage", arguments: { action: "get", ... } }`)
- **CORS enabled:** `/mcp`, `/health`, and `/admin` accept cross-origin requests
- **Rate limiting:** Enforced via `src/middleware/rate-limit.ts`
- **No batch JSON-RPC:** Only single requests; use `batch_set_lore` or `batch_mutate` for bulk operations

## Storage Notes

### KV (`LORE_DB`)

- **Key format:** Lowercase with `:` namespacing (e.g., `character:zira`, `location:undercity`)
- **Entry format:** `{ text: string, meta: { version, createdAt, updatedAt } }`
- **Markdown automation:** Fields like `**Consumption-Timeline:** ...` are parsed for state machines, timelines, goals
- **Exact matching:** `patch` action requires exact substring matching; rejects ambiguous or missing targets
- **Reserved prefixes:** `_idx:*` (indexes), `_history:*` (version history), `_changelog`, `events:*`, `_snapshot:*`, `_tags:*`, `map:*`
- **Response format:** Always `{ content: [{ type: 'text', text: '...' }], key, text, meta }` for MCP compatibility

### D1 (`RPG_DB`)

- **Schema:** Character stats, sessions, combat encounters, quests, parties, NPCs
- **Migrations:** Managed in `schema/migrations/` directory
- **Access:** Via `env.RPG_DB.prepare(...).run()` or action parameters in `rpg` sub-tools

## Quick Start

1. **Clone & install:**

   ```bash
   pnpm install
   pnpm run build
   ```

2. **Run locally:**

   ```bash
   pnpm run dev
   ```

   The server runs at `http://127.0.0.1:8787` with:
   - MCP endpoint: `/mcp`
   - Health check: `/health`
   - Admin endpoints: `/admin/set-lore`, `/admin/delete-lore`

3. **Test it:**

   ```bash
   pnpm test                    # Run all tests
   pnpm test -- --reporter=verbose  # Verbose output
   ```

4. **Deploy:**

   ```bash
   wrangler secret put ADMIN_SECRET      # Set your secret
   wrangler secret put MCP_API_KEY       # Optional: set API key for auth
   pnpm run deploy
   ```

## Documentation

- **Architecture & patterns:** See [CLAUDE.md](CLAUDE.md)
- **Testing & validation:** See [docs/testing-and-linting-guide.md](docs/testing-and-linting-guide.md)
- **Issue resolution protocol:** See [ISSUE_RESOLUTION_PROTOCOL.md](ISSUE_RESOLUTION_PROTOCOL.md)
- **User guide:** See [docs/holmgard-user-guide.md](docs/holmgard-user-guide.md)
