// src/internal/routes.ts
// Internal API for editor ↔ worker operational calls (e.g., map readback)
// Protected by ADMIN_SECRET same as /admin/* routes

import { Hono } from 'hono'
import type { AppBindings } from '../types'

const internal = new Hono<{ Bindings: AppBindings }>()

/** Verify the admin secret from request context. Returns true if authorized. */
async function checkSecret(c: any): Promise<boolean> {
  const ADMIN_SECRET = c.env.ADMIN_SECRET as string | undefined
  if (!ADMIN_SECRET) return false

  const headerSecret = c.req.header('X-Api-Key') ?? c.req.header('X-Admin-Secret')
  return headerSecret === ADMIN_SECRET
}

/** Safely parse JSON from body, returning null on error. */
async function safeJson(c: any): Promise<Record<string, unknown> | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

// ── Map readback ─────────────────────────────────────────────────────────────

interface HexRecord {
  mapId: string
  q: number
  r: number
  terrain: string
  name: string
  description: string
  // #321 — RPG-owned fields, additive so the editor's biome-assignment panel
  // can show a hex's current biome without a separate round-trip. Absent on
  // hexes with no world_id set yet (null, not omitted, so older/typed
  // clients see a stable shape).
  worldId: string | null
  biome: string | null
}

interface LandmarkRecord {
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

/** Convert D1 hex row to client HexRecord. */
function rowToHex(row: Record<string, unknown>): HexRecord {
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

/** Convert D1 landmark row to client LandmarkRecord. */
function rowToLandmark(row: Record<string, unknown>): LandmarkRecord {
  const data = row.data ? JSON.parse(String(row.data)) : {}
  // data.attributes is already a string from push-landmarks; ensure it's JSON stringified
  const attributesValue = data.attributes ?? '{}'
  const attributes = typeof attributesValue === 'string' ? attributesValue : JSON.stringify(attributesValue)
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

internal.post('/map-readback', async (c) => {
  try {
    if (!(await checkSecret(c))) {
      return c.json({ ok: false, error: 'unauthorized' }, 401)
    }

    const body = await safeJson(c)
    if (!body || typeof body.mapId !== 'string') {
      return c.json({ ok: false, error: 'mapId must be a non-empty string' }, 400)
    }

    const mapId = body.mapId.trim()
    if (!mapId) {
      return c.json({ ok: false, error: 'mapId must be a non-empty string' }, 400)
    }

    const db = c.env.RPG_DB as any
    const [hexesResult, landmarksResult] = await Promise.all([
      db.prepare('SELECT q, r, map_id, terrain, label, data, world_id, biome FROM hexes WHERE map_id = ? ORDER BY q, r')
        .bind(mapId)
        .all(),
      db.prepare('SELECT id, map_id, q, r, name, category, data FROM landmarks WHERE map_id = ? ORDER BY name')
        .bind(mapId)
        .all(),
    ])

    const hexes = (hexesResult.results as Array<Record<string, unknown>>).map(rowToHex)
    const landmarks = (landmarksResult.results as Array<Record<string, unknown>>).map(rowToLandmark)

    return c.json({ ok: true, hexes, landmarks }, 200)
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

export default internal
