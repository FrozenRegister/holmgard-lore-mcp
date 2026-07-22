# D1 Readback API Design & Implementation Guide

**Status:** Planning phase
**Scope:** Worker-side read path for hexes & landmarks stored in D1
**Branches:** Both repos use `claude/holmgard-d1-readback-0p3b5t`

---

## Transport decision: MCP `/mcp`, not new REST routes

> **This supersedes the earlier draft of this doc, which proposed `GET /map/{mapId}/...` REST routes.**

The map **reads** are exposed as JSON-RPC methods on the existing **`POST /mcp`** endpoint — the same surface the editor already uses for `list_topics` and `get_lore`. We do **not** add ad-hoc REST GET routes.

The map **pushes** (`POST /admin/map/push-hexes`, `push-landmarks`) **stay on REST `/admin/*`**, gated by `ADMIN_SECRET`. They are privileged bulk writes and do not belong on the public MCP surface.

This follows the repo-wide convention (see `CLAUDE.md` → *API surface convention*):

| Operation | Surface | Why |
|-----------|---------|-----|
| Reads / queries (lore, **map readback**) | `POST /mcp` JSON-RPC | One discoverable, agent-usable read surface; client `rpc()` already speaks it |
| Privileged writes / bulk admin (set-lore, deletes, migrations, **map pushes**) | `POST /admin/*` REST | Gated by `ADMIN_SECRET`; must stay off the public MCP surface |

### Why MCP for reads, concretely

1. **The client read path already lives at `/mcp`.** `src/lib/sync.ts` `rpc()` posts `{ jsonrpc, id, method, params }` and reads `json.result`. `getTopicRemote` → `get_lore`, `listTopicsRemote` → `list_topics`. Map readback slots in with zero new client transport.
2. **Agent reuse.** Registering these as `tools/call` tools (discoverable via `tools/list`) means the Claude agent can answer spatial questions ("what landmarks are near Crowkeep?") through the same definitions — compare the existing `getMapContext` helper in the editor's `mapDb.ts`.
3. **Secrets stay server-side.** Reads need no `ADMIN_SECRET`; pushes keep it. Mixing a public bulk-read into the admin REST group would either over-expose admin auth or under-protect writes.

### Result shape: structured JSON in `result` (bare-method style)

MCP `tools/call` results are normally content blocks (`{ content: [{ type:'text', text }], metadata }`) tuned for LLM token efficiency — **awkward for bulk data sync**, because the client would have to parse arrays back out of a text blob.

`list_topics`/`get_lore` avoid this: they are also exposed as **bare JSON-RPC methods** that return clean structured JSON directly in `result`. We mirror that exactly. So each map read is registered **twice**:

- **Bare method** (`method: "get_map_hexes"`) → `result` **is** the structured payload (`{ mapId, hexes, count, lastUpdated }`). This is what the editor's bulk sync calls.
- **`tools/call` tool** (`name: "get_map_hexes"`, discoverable via `tools/list`) → standard `{ content: [{type:'text', text: <short summary>}], metadata: <same structured payload> }` for agent use.

Both paths share one handler; only the envelope differs.

---

## Current D1 Schema

### hexes table
```sql
CREATE TABLE hexes (
  q          INTEGER NOT NULL,
  r          INTEGER NOT NULL,
  map_id     TEXT NOT NULL DEFAULT 'main',
  terrain    TEXT,
  label      TEXT,
  data       TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (DATETIME('now')),
  PRIMARY KEY (q, r, map_id)
)
```

### landmarks table
```sql
CREATE TABLE landmarks (
  id         TEXT PRIMARY KEY,
  map_id     TEXT NOT NULL DEFAULT 'main',
  q          INTEGER NOT NULL,
  r          INTEGER NOT NULL,
  name       TEXT NOT NULL,
  category   TEXT,
  data       TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (DATETIME('now'))
)
```

---

## Method Specifications

All methods are called via `POST /mcp`. Authentication matches the existing read methods (`X-Api-Key` / `MCP_API_KEY` as the worker already enforces for `/mcp`); no `ADMIN_SECRET`.

### 1. `get_map_hexes`

**Purpose:** Fetch all hexes for a map.

#### Request (bare method — what the client calls)
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "get_map_hexes",
  "params": { "mapId": "main" }
}
```

#### Response — `result`
```json
{
  "mapId": "main",
  "hexes": [
    { "q": 0, "r": 0, "terrain": "grassland", "name": "Heartwood", "description": "A fertile plain" },
    { "q": 1, "r": -1, "terrain": "forest", "name": "Silverwood", "description": "Ancient timberland" }
  ],
  "count": 2,
  "lastUpdated": "2025-01-15T10:30:00Z"
}
```

#### Request (`tools/call` — agent path, same handler)
```json
{
  "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "get_map_hexes", "arguments": { "mapId": "main" } }
}
```
→ `result` = `{ content: [{ type:"text", text:"2 hexes on map 'main' (last updated …)" }], metadata: { mapId, hexes, count, lastUpdated } }`

#### Errors
JSON-RPC errors (not HTTP status). Invalid params → `-32602`. D1 unavailable → application error in `result` (`{ ok:false, error:"RPG_DB unavailable" }`) or `-32000`, matching how existing tools degrade. Empty map → `hexes: []`, **not** an error.

#### Query & mapping
```sql
SELECT q, r, terrain, label, data, updated_at FROM hexes WHERE map_id = ? ORDER BY q, r
```

| D1 Field | `result` Field | Transformation |
|----------|---|---|
| `q, r` | `q, r` | none |
| `terrain` | `terrain` | none |
| `label` | `name` | **rename** |
| `data` (JSON) | `description` | parse JSON, read `data.description` |
| `updated_at` (max) | `lastUpdated` | aggregate at payload level |

```typescript
interface HexRow { q: number; r: number; terrain: string | null; label: string | null; data: string; updated_at: string }
interface HexOut { q: number; r: number; terrain: string; name: string; description: string }

function hexFromD1(row: HexRow): HexOut {
  let data: Record<string, unknown> = {}
  try { data = row.data ? JSON.parse(row.data) : {} } catch { data = {} }
  return {
    q: row.q, r: row.r,
    terrain: row.terrain ?? '',
    name: row.label ?? '',
    description: (data.description as string) ?? '',
  }
}
```

---

### 2. `get_map_landmarks`

**Purpose:** Fetch all landmarks for a map.

#### Request (bare method)
```json
{ "jsonrpc": "2.0", "id": 2, "method": "get_map_landmarks", "params": { "mapId": "main" } }
```

#### Response — `result`
```json
{
  "mapId": "main",
  "landmarks": [
    {
      "id": "landmark-1", "q": 5, "r": -3, "name": "Crowkeep", "type": "settlement",
      "notes": "A fortified town", "attributes": "{}",
      "linkedMapId": null, "visible": true, "linkedLoreKey": "location:crowkeep"
    }
  ],
  "count": 1,
  "lastUpdated": "2025-01-15T10:30:00Z"
}
```

#### Query & mapping
```sql
SELECT id, q, r, name, category, data, updated_at FROM landmarks WHERE map_id = ? ORDER BY q, r
```

| D1 Field | `result` Field | Transformation |
|----------|---|---|
| `id` | `id` | none |
| `q, r` | `q, r` | none |
| `name` | `name` | none |
| `category` | `type` | **rename** |
| `data` (JSON) | `notes, attributes, linkedMapId, visible, linkedLoreKey` | parse JSON, extract fields |
| `updated_at` (max) | `lastUpdated` | aggregate at payload level |

```typescript
interface LandmarkRow { id: string; q: number; r: number; name: string; category: string | null; data: string; updated_at: string }

function landmarkFromD1(row: LandmarkRow) {
  let data: Record<string, unknown> = {}
  try { data = row.data ? JSON.parse(row.data) : {} } catch { data = {} }
  return {
    id: row.id, q: row.q, r: row.r, name: row.name,
    type: row.category ?? '',
    notes: (data.notes as string) ?? '',
    attributes: JSON.stringify(data.attributes ?? {}),
    linkedMapId: (data.linkedMapId as string) ?? null,
    visible: data.visible !== false,
    linkedLoreKey: (data.linkedLoreKey as string) ?? null,
  }
}
```

Notes: `attributes` is returned **stringified** to match the client `LandmarkRecord.attributes: string`; `visible` defaults to `true`.

---

### 3. `get_map_meta`

**Purpose:** Map metadata (counts, last update) — cheap precheck before a full pull (lets the client decide full vs. delta vs. skip).

#### Request (bare method)
```json
{ "jsonrpc": "2.0", "id": 3, "method": "get_map_meta", "params": { "mapId": "main" } }
```

#### Response — `result`
```json
{ "mapId": "main", "hexCount": 1024, "landmarkCount": 42, "lastUpdated": "2025-01-15T10:30:00Z" }
```

#### Queries
```sql
SELECT COUNT(*) AS hex_count, MAX(updated_at) AS last_updated FROM hexes WHERE map_id = ?;
SELECT COUNT(*) AS landmark_count, MAX(updated_at) AS last_updated FROM landmarks WHERE map_id = ?;
```
Both tables empty → counts of 0 (not an error).

---

## Registration checklist (where the wiring lives)

The worker dispatches `/mcp` methods through `src/lib/rpc.ts` + the tool handlers in `src/tools/*`. To add these:

- [ ] New handler module `src/tools/map.ts` (or extend `world.ts`) with `handle_get_map_hexes`, `handle_get_map_landmarks`, `handle_get_map_meta` using `ToolContext` and `makeResult`/`makeError`.
- [ ] Conversion helpers `hexFromD1` / `landmarkFromD1` (same module, unit-tested).
- [ ] Register each in the `tools/call` dispatch table **and** the bare-method dispatch (mirror how `get_lore` / `list_topics` are wired in `src/index.ts` / `src/lib/rpc.ts`).
- [ ] Add tool definitions to `toolDefinitions` (so `tools/list` advertises them with input schemas).
- [ ] Guard `c.env?.RPG_DB` — return a graceful error when D1 is unbound.
- [ ] **Update both test suites** (`src/__tests__/*` workers + `tests/live/*`), per repo policy.
- [ ] Add CHANGELOG `[Unreleased]` entry.
- [ ] Update the **15 MCP tools** list in `CLAUDE.md` (it becomes 18).

---

## Field Clarifications & Open Decisions

(unchanged from client plan — see `holmgard-lore-editor/docs/d1-readback-plan.md`)

### 1. Persistent vs. transient Landmark fields
The rich `Landmark` type (types.ts) has 40+ fields; D1 stores a base subset + JSON `data`. Which of the styling/positioning fields must round-trip is **TBD** — review editor UI before Phase 2.

### 2. Elevation
`Hex.elevation` is optional in types.ts and absent from D1. Decide: add `elevation INTEGER DEFAULT 0` (migration) or drop from the client type.

---

## Cloudflare D1 / billing notes

D1 bills per **statement**, not per row.

| Scenario | Statements | Notes |
|----------|-----------|-------|
| `get_map_hexes` (any size) | 1 SELECT | one read regardless of row count |
| `get_map_landmarks` | 1 SELECT | one read |
| `get_map_meta` | 2 COUNT | cheap precheck |
| Full pull = hexes + landmarks | 2 reads | ~$0.0001 |
| 1,000 users, daily full pull | ~2,000 reads/day | ~$0.02/day |

Read methods are negligible cost. The bigger lever is **how often the client pulls** and **how much it transfers** — see the strategy table in the client plan (full vs. paginated vs. delta). `get_map_meta` exists so the client can cheaply skip a pull when `lastUpdated`/counts are unchanged.

Future optimizations if maps grow large: `LIMIT/OFFSET` paging params, `WHERE updated_at > ?` delta reads, gzip. Not in Phase 1.

---

## Testing Strategy

### Unit (vitest)
- `hexFromD1` / `landmarkFromD1`: null fields, malformed `data` JSON, missing keys.

### Integration (miniflare + D1)
- Seed `hexes`/`landmarks`, call each method via `/mcp` (bare **and** `tools/call`), assert `result` shape.
- Empty map → empty arrays, count 0.
- D1 unbound → graceful error.
- `tools/list` advertises the three new tools.
- Large payload (1000+ rows) returns in one read.

### Live smoke (`tests/live/*`)
- Hit deployed `/mcp` with the new methods against a known map.

---

## Success Criteria

- ✅ Three read methods on `/mcp` (bare + `tools/call`), structured JSON in `result`
- ✅ Pushes remain REST `/admin/*` (unchanged)
- ✅ Field mappings handle D1 nulls gracefully
- ✅ Both test suites updated; 100% patch coverage in CI
- ✅ `CLAUDE.md` tool count + convention reflect the change
- ✅ Ready for client integration (editor Phase 3)

---

## Related Code

- **`/mcp` dispatch & result envelope:** `src/lib/rpc.ts`, `src/index.ts`
- **Existing read handlers to mirror:** both `get_lore` and `list_topics` are defined in `src/tools/system.ts` (not `lore.ts` — `lore.ts` holds the write/mutate handlers: `set_lore`, `delete_lore`, `patch_lore`, `batch_set_lore`, `batch_mutate`, `restore_lore`, etc.)
- **Map push endpoints (REST, unchanged):** `src/admin/routes.ts` lines 665–787 (`/map/push-hexes` ~665–725, `/map/push-landmarks` ~727–787)
- **D1 schema:** `schema/rpg-schema.sql` lines 1134–1174
- **Client read transport:** `holmgard-lore-editor/src/lib/sync.ts` (`rpc()`, `getTopicRemote`, `listTopicsRemote`)
- **Client plan:** `holmgard-lore-editor/docs/d1-readback-plan.md`
