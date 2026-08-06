// src/internal/routes.ts
// Internal API for editor ↔ worker operational calls (e.g., map readback)
// Protected by ADMIN_SECRET same as /admin/* routes

import { Hono } from 'hono'
import type { AppBindings } from '../types'
import { rowToHex, rowToLandmark } from '../lib/map-readback'

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
// #487 — row-shape conversion (rowToHex/rowToLandmark) now lives in
// ../lib/map-readback.ts, shared with the MCP-surface
// world_map.get_map_hexes/get_map_landmarks/get_map_meta actions so both
// callers (this admin-secret-gated REST route, and the unauthenticated MCP
// read path) stay byte-for-byte consistent.

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
      db
        .prepare(
          'SELECT q, r, map_id, terrain, label, data, world_id, biome FROM hexes WHERE map_id = ? ORDER BY q, r',
        )
        .bind(mapId)
        .all(),
      db
        .prepare(
          'SELECT id, map_id, q, r, name, category, data FROM landmarks WHERE map_id = ? ORDER BY name',
        )
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
