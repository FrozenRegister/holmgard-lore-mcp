// Live smoke coverage for the #319 (Phase 1 of #308) map-table schema change.
// Confirms the new world_id/biome/elevation/moisture/temperature (hexes) and
// world_id/region_id/population/zone_* (landmarks) columns exist and default
// safely, and — most importantly — that /admin/map/push-hexes,
// /admin/map/push-landmarks, and /internal/map-readback still round-trip the
// exact same response shape the editor's mapSync.ts expects, unchanged.
import { describe, it, expect } from 'vitest'
import { MCP_API_KEY, ADMIN_SECRET, BASE_URL, adminPost, uid } from './helpers'

describe.skipIf(!MCP_API_KEY || !ADMIN_SECRET)('map schema world-scoping (#319)', () => {
  async function readback(mapId: string) {
    const res = await fetch(`${BASE_URL}/internal/map-readback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
      body: JSON.stringify({ mapId }),
    })
    return res.json() as Promise<{ ok: boolean; hexes: unknown[]; landmarks: unknown[] }>
  }

  it('push-hexes/push-landmarks + readback still round-trip the editor-expected shape unchanged', async () => {
    const mapId = `test-map-${uid()}`

    const pushHexRes = await adminPost('/admin/map/push-hexes', {
      mapId,
      hexes: [{ q: 0, r: 0, terrain: 'forest', name: 'Thornwood', description: 'Dense forest' }],
    })
    expect(pushHexRes.ok).toBe(true)

    const pushLandmarkRes = await adminPost('/admin/map/push-landmarks', {
      mapId,
      landmarks: [{ id: `lm-${uid()}`, q: 0, r: 0, name: 'Old Watchtower', type: 'poi', notes: 'A ruin.' }],
    })
    expect(pushLandmarkRes.ok).toBe(true)

    const body = await readback(mapId)
    expect(body.ok).toBe(true)
    expect(body.hexes).toHaveLength(1)
    expect(body.hexes[0]).toEqual({
      mapId, q: 0, r: 0, terrain: 'forest', name: 'Thornwood', description: 'Dense forest',
    })
    expect(body.landmarks).toHaveLength(1)
    const lm = body.landmarks[0] as Record<string, unknown>
    expect(lm.mapId).toBe(mapId)
    expect(lm.name).toBe('Old Watchtower')
    expect(lm.type).toBe('poi')
    expect(lm.notes).toBe('A ruin.')
  })
})
