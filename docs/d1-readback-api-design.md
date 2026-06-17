# D1 Readback API Design & Implementation Guide

**Status:** Planning phase  
**Scope:** Worker-side GET endpoints for reading hexes & landmarks from D1  
**Branches:** Both repos use `claude/holmgard-d1-readback-0p3b5t`

---

## Overview

This document specifies the GET endpoints that will be added to `src/admin/routes.ts` to enable the client to read map data back from D1. It covers:
- API contract (request/response format)
- D1 queries & performance
- Field mapping (D1 schema → client types)
- Error handling & edge cases
- Implementation checklist

**Related:** See `holmgard-lore-editor/docs/d1-readback-plan.md` for client-side context.

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

## Endpoint Specifications

### 1. GET /map/{mapId}/hexes

**Purpose:** Fetch all hexes for a given map  
**Authentication:** None (read-only, public or user-scoped in future)  
**Rate Limiting:** None initially (monitor for abuse)

#### Request
```
GET /map/main/hexes
GET /map/main/hexes?mapId=custom-map
```

#### Response (Success)
```json
{
  "ok": true,
  "mapId": "main",
  "hexes": [
    {
      "q": 0,
      "r": 0,
      "terrain": "grassland",
      "name": "Heartwood",
      "description": "A fertile plain"
    },
    {
      "q": 1,
      "r": -1,
      "terrain": "forest",
      "name": "Silverwood",
      "description": "Ancient timberland"
    }
  ],
  "count": 2,
  "lastUpdated": "2025-01-15T10:30:00Z"
}
```

#### Response (Error)
```json
{
  "ok": false,
  "error": "Map not found"
}
```

#### Status Codes
- `200 OK` — Successful fetch (may be empty)
- `400 Bad Request` — Invalid mapId
- `503 Service Unavailable` — D1 unavailable

#### Implementation Notes

**Query:**
```sql
SELECT q, r, terrain, label, data, updated_at
FROM hexes
WHERE map_id = ?
ORDER BY q, r
```

**Field Mapping (D1 → Response):**
| D1 Field | Response Field | Transformation |
|----------|---|---|
| `q, r` | `q, r` | No change |
| `terrain` | `terrain` | No change |
| `label` | `name` | Direct mapping |
| `data` | Extract `description` | Parse JSON, extract `description` field |
| (not in D1) | `elevation` | Omit if not in schema |
| `updated_at` | (in top-level response) | Include as `lastUpdated` for entire map |

**Data Structure Conversion:**
```typescript
interface HexRow {
  q: number
  r: number
  terrain: string | null
  label: string | null
  data: string  // JSON: { description: "..." }
  updated_at: string
}

interface HexResponse {
  q: number
  r: number
  terrain: string
  name: string
  description: string
}

// Conversion function
function hexFromD1(row: HexRow): HexResponse {
  let data = {}
  try {
    data = row.data ? JSON.parse(row.data) : {}
  } catch {
    data = {}
  }
  return {
    q: row.q,
    r: row.r,
    terrain: row.terrain || '',
    name: row.label || '',
    description: (data as Record<string, any>).description || ''
  }
}
```

**Considerations:**
- Empty maps return `hexes: []` (not an error)
- Pagination not included in Phase 1; add if maps exceed ~50k hexes
- No auth required (consider adding optional token in future)

---

### 2. GET /map/{mapId}/landmarks

**Purpose:** Fetch all landmarks for a given map  
**Authentication:** None (read-only)  
**Rate Limiting:** None initially

#### Request
```
GET /map/main/landmarks
GET /map/main/landmarks?mapId=custom-map
```

#### Response (Success)
```json
{
  "ok": true,
  "mapId": "main",
  "landmarks": [
    {
      "id": "landmark-1",
      "q": 5,
      "r": -3,
      "name": "Crowkeep",
      "type": "settlement",
      "notes": "A fortified town",
      "attributes": "{}",
      "linkedMapId": null,
      "visible": true,
      "linkedLoreKey": "location:crowkeep"
    }
  ],
  "count": 1,
  "lastUpdated": "2025-01-15T10:30:00Z"
}
```

#### Response (Error)
```json
{
  "ok": false,
  "error": "D1 unavailable"
}
```

#### Status Codes
- `200 OK` — Successful fetch (may be empty)
- `400 Bad Request` — Invalid mapId
- `503 Service Unavailable` — D1 unavailable

#### Implementation Notes

**Query:**
```sql
SELECT id, q, r, name, category, data, updated_at
FROM landmarks
WHERE map_id = ?
ORDER BY q, r
```

**Field Mapping (D1 → Response):**
| D1 Field | Response Field | Transformation |
|----------|---|---|
| `id` | `id` | No change |
| `q, r` | `q, r` | No change |
| `name` | `name` | No change |
| `category` | `type` | Direct rename |
| `data` | Extract fields | Parse JSON: `notes`, `attributes`, `linkedMapId`, `visible`, `linkedLoreKey` |
| `updated_at` | (in top-level response) | Include as `lastUpdated` |

**Data Structure Conversion:**
```typescript
interface LandmarkRow {
  id: string
  q: number
  r: number
  name: string
  category: string | null
  data: string  // JSON: { notes, attributes, linkedMapId, visible, linkedLoreKey }
  updated_at: string
}

interface LandmarkResponse {
  id: string
  q: number
  r: number
  name: string
  type: string
  notes: string
  attributes: string
  linkedMapId: string | null
  visible: boolean
  linkedLoreKey: string | null
}

// Conversion function
function landmarkFromD1(row: LandmarkRow): LandmarkResponse {
  let data = {}
  try {
    data = row.data ? JSON.parse(row.data) : {}
  } catch {
    data = {}
  }
  return {
    id: row.id,
    q: row.q,
    r: row.r,
    name: row.name,
    type: row.category || '',
    notes: (data as any).notes || '',
    attributes: JSON.stringify((data as any).attributes || {}),
    linkedMapId: (data as any).linkedMapId || null,
    visible: (data as any).visible !== false,
    linkedLoreKey: (data as any).linkedLoreKey || null
  }
}
```

**Considerations:**
- `attributes` returned as stringified JSON (matches client `LandmarkRecord.attributes: string`)
- `visible` defaults to `true` if not in data
- Landmarks may link to lore entries via `linkedLoreKey` (informational)

---

### 3. GET /map/{mapId}

**Purpose:** Fetch map metadata (counts, last update)  
**Authentication:** None (read-only)

#### Request
```
GET /map/main
GET /map/main?mapId=custom-map
```

#### Response (Success)
```json
{
  "ok": true,
  "mapId": "main",
  "hexCount": 1024,
  "landmarkCount": 42,
  "lastUpdated": "2025-01-15T10:30:00Z",
  "estimatedSize": "~2.5 MB"
}
```

#### Response (Error)
```json
{
  "ok": false,
  "error": "Map does not exist"
}
```

#### Status Codes
- `200 OK` — Map exists
- `404 Not Found` — Map doesn't exist
- `503 Service Unavailable` — D1 unavailable

#### Implementation Notes

**Queries:**
```sql
SELECT COUNT(*) as hex_count, MAX(updated_at) as last_updated FROM hexes WHERE map_id = ?;
SELECT COUNT(*) as landmark_count, MAX(updated_at) as last_updated FROM landmarks WHERE map_id = ?;
```

**Return Format:**
```typescript
{
  ok: true,
  mapId: string,
  hexCount: number,
  landmarkCount: number,
  lastUpdated: string (ISO),
  estimatedSize?: string (human-readable)
}
```

**Considerations:**
- If both tables empty, return counts of 0 (don't treat as 404)
- `estimatedSize` is informational (rough estimate based on row count)
- Could be used for progress indication or sync decisions

---

## Field Clarifications & Open Decisions

### 1. Persistent vs. Transient Fields

**Current Status:** Unknown for Landmark type  
**Impact:** Determines whether to add fields to D1 or leave as client-computed

**Hypothesis** (to be verified):
- **Persistent** (belongs in D1): `id, name, type, q, r, notes, attributes, linkedMapId, visible, linkedLoreKey`
- **Transient/Rendering** (client-only): `style, icon, color, showLabel, labelPosition, size, hideTerrainIcon, gridLevel, created, detailAnchor*, detailDisplayMode, iconColor, isDungeonObject, linkedMapThumbnailUrl, iconScale, iconOffset*, allowIconOverflow, typeId, variantId, appearanceMode, labelFontSize`

**Decision Needed:** Review editor UI code; categorize Landmark fields.

### 2. Elevation Field

**Current Status:** Optional in types.ts, not in D1  
**Decision Needed:** Add to D1 schema or remove from types?

**If adding:** Migration script to add `elevation INTEGER DEFAULT 0` to hexes table  
**If removing:** Update client types to remove `Hex.elevation`

---

## Implementation Checklist

### Step 1: Create Conversion Helpers
- [ ] Add `hexFromD1(row)` function
- [ ] Add `landmarkFromD1(row)` function
- [ ] Add to `src/admin/routes.ts` or separate `src/lib/map-conversion.ts`
- [ ] Unit tests for conversions (edge cases: null fields, malformed JSON)

### Step 2: Implement GET Endpoints
- [ ] `GET /map/{mapId}/hexes` handler
- [ ] `GET /map/{mapId}/landmarks` handler
- [ ] `GET /map/{mapId}` handler
- [ ] Error handling (missing map, D1 unavailable)
- [ ] Logging (track readback requests)

### Step 3: Add Tests
- [ ] Test each endpoint with valid map
- [ ] Test with empty map
- [ ] Test with nonexistent map (404 or return empty)
- [ ] Test D1 unavailability (503)
- [ ] Test conversion edge cases (null terrain, malformed data JSON)
- [ ] Test large payload (1000+ hexes)

### Step 4: Update Schema (if needed)
- [ ] Decide on elevation field
- [ ] If adding: create migration in `schema/migrations/`
- [ ] Update `schema/rpg-schema.sql`
- [ ] Test migration on fresh database

### Step 5: Documentation
- [ ] Update `docs/d1-readback-api-design.md` with final implementation
- [ ] Add inline code comments for field mappings
- [ ] Document rate limiting strategy (if added later)

### Step 6: Performance & Billing Check
- [ ] Measure query time for 1000+ hex maps
- [ ] Estimate D1 cost (reads per sync)
- [ ] Consider pagination if needed

---

## API Design Principles

1. **Consistency:** Mirror push endpoint shapes where possible
2. **Clarity:** Include mapId in response (redundant but clear)
3. **Robustness:** Return empty arrays on empty maps, not 404
4. **Efficiency:** Single query per resource (hexes, landmarks, metadata)
5. **Future-proof:** Leave room for pagination, auth, rate limiting

---

## Related Code

- **Current push endpoints:** `src/admin/routes.ts` lines 565–658
- **D1 schema:** `schema/rpg-schema.sql` lines 842–866
- **Tests:** `src/__tests__/admin-map.test.ts`
- **Client consumer:** `holmgard-lore-editor/src/lib/mapSync.ts`

---

## Cloudflare D1 Performance Notes

### Query Patterns
- **Single SELECT with WHERE:** ~1 D1 read (counted as 1 statement)
- **COUNT(*) with WHERE:** Efficient, single read
- **ORDER BY:** No additional cost, executes on D1 side

### Typical Costs
| Scenario | Queries | D1 Reads | Cost |
|----------|---------|----------|------|
| Sync small map (100 hexes) | 2 | 2 | ~$0.0001 |
| Sync large map (5000 hexes) | 2 | 2 | ~$0.0001 |
| 1000 users, daily sync | 2000 | 2000 | ~$0.02/day |

**Conclusion:** Read endpoints are negligible cost; focus on user experience, not billing.

### Future Optimization (If Needed)
- **Pagination:** `LIMIT 500 OFFSET ?` to split large maps
- **Delta sync:** `WHERE updated_at > ?` for incremental updates
- **Compression:** gzip response payload for bandwidth
- **Caching:** Cache in Cloudflare Cache if read-only (unsafe for mutable data)

---

## Security Considerations

### Current
- No authentication on read endpoints (map data assumed public)
- No rate limiting (but D1 limits apply)

### Future (Out of scope for Phase 1)
- Optional bearer token auth if maps should be private
- Rate limiting per IP or user
- Audit logging for read access
- IP allowlist for admin operations

---

## Testing Strategy

### Unit Tests (vitest)
- Conversion functions (null handling, JSON parsing)
- Query result mapping

### Integration Tests (miniflare + D1)
- GET /map/main/hexes with seeded data
- GET /map/main/landmarks with seeded data
- GET /map/main metadata
- Error cases (nonexistent map, D1 error)
- Empty map handling

### Performance Tests (if needed later)
- 1000+ hex/landmark payloads
- Response time targets

---

## Success Criteria

- ✅ All three endpoints return correct data
- ✅ Field mappings handle D1 nulls gracefully
- ✅ Tests cover >80% of new code
- ✅ No performance regression vs. push endpoints
- ✅ Documentation clear for client consumption
- ✅ Ready for Phase 3 (client integration)
