// #487 — shared row-shape + query logic for reading D1's hexes/landmarks
// tables by mapId. Used by both `/internal/map-readback` (REST, gated by
// ADMIN_SECRET, the editor's authenticated bulk-sync path) and the
// `world_map.get_map_hexes`/`get_map_landmarks`/`get_map_meta` MCP actions
// (no admin secret — the "reads via MCP" half of this repo's API surface
// convention, docs/d1-readback-api-design.md). One conversion, two callers.

export interface HexRecord {
  mapId: string
  q: number
  r: number
  terrain: string
  name: string
  description: string
  worldId: string | null
  biome: string | null
}

export interface LandmarkRecord {
  mapId: string
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

/** Convert a D1 hex row to the client-facing HexRecord shape. */
export function rowToHex(row: Record<string, unknown>): HexRecord {
  const data = row.data ? JSON.parse(String(row.data)) : {}
  return {
    mapId: String(row.map_id ?? 'main'),
    q: Number(row.q ?? 0),
    r: Number(row.r ?? 0),
    terrain: String(row.terrain ?? ''),
    name: String(row.label ?? ''),
    description: String(data.description ?? ''),
    worldId: (row.world_id as string | null) ?? null,
    biome: (row.biome as string | null) ?? null,
  }
}

/** Convert a D1 landmark row to the client-facing LandmarkRecord shape. */
export function rowToLandmark(row: Record<string, unknown>): LandmarkRecord {
  const data = row.data ? JSON.parse(String(row.data)) : {}
  const attributesValue = data.attributes ?? '{}'
  const attributes =
    typeof attributesValue === 'string' ? attributesValue : JSON.stringify(attributesValue)
  return {
    mapId: String(row.map_id ?? 'main'),
    id: String(row.id ?? ''),
    q: Number(row.q ?? 0),
    r: Number(row.r ?? 0),
    name: String(row.name ?? ''),
    type: String(row.category ?? ''),
    notes: String(data.notes ?? ''),
    attributes,
    linkedMapId: data.linkedMapId ?? null,
    visible: Boolean(data.visible ?? true),
    linkedLoreKey: data.linkedLoreKey ?? null,
  }
}

function maxUpdatedAt(rows: Array<{ updated_at?: unknown }>): string | null {
  let max: string | null = null
  for (const row of rows) {
    const value = row.updated_at as string | undefined
    if (value && (!max || value > max)) max = value
  }
  return max
}

export async function fetchMapHexes(
  db: D1Database,
  mapId: string,
): Promise<{ hexes: HexRecord[]; lastUpdated: string | null }> {
  const { results } = await db
    .prepare(
      'SELECT q, r, map_id, terrain, label, data, world_id, biome, updated_at FROM hexes WHERE map_id = ? ORDER BY q, r',
    )
    .bind(mapId)
    .all()
  const rows = results as Array<Record<string, unknown>>
  return { hexes: rows.map(rowToHex), lastUpdated: maxUpdatedAt(rows) }
}

export async function fetchMapLandmarks(
  db: D1Database,
  mapId: string,
): Promise<{ landmarks: LandmarkRecord[]; lastUpdated: string | null }> {
  const { results } = await db
    .prepare(
      'SELECT id, map_id, q, r, name, category, data, updated_at FROM landmarks WHERE map_id = ? ORDER BY name',
    )
    .bind(mapId)
    .all()
  const rows = results as Array<Record<string, unknown>>
  return { landmarks: rows.map(rowToLandmark), lastUpdated: maxUpdatedAt(rows) }
}

export async function fetchMapMeta(
  db: D1Database,
  mapId: string,
): Promise<{ hexCount: number; landmarkCount: number; lastUpdated: string | null }> {
  const [hexRow, landmarkRow] = await Promise.all([
    db
      .prepare('SELECT COUNT(*) as cnt, MAX(updated_at) as last FROM hexes WHERE map_id = ?')
      .bind(mapId)
      .first<{ cnt: number; last: string | null }>(),
    db
      .prepare('SELECT COUNT(*) as cnt, MAX(updated_at) as last FROM landmarks WHERE map_id = ?')
      .bind(mapId)
      .first<{ cnt: number; last: string | null }>(),
  ])
  const lastUpdated = [hexRow?.last ?? null, landmarkRow?.last ?? null]
    .filter((v): v is string => v !== null)
    .sort()
    .pop()
  return {
    hexCount: hexRow?.cnt ?? 0,
    landmarkCount: landmarkRow?.cnt ?? 0,
    lastUpdated: lastUpdated ?? null,
  }
}
