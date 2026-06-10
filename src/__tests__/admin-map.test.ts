import { describe, ADMIN_SECRET } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach, describe as innerDescribe } from 'vitest'
import { setupRpgDb } from './setup-d1'

describe('admin map routes', () => {
  beforeEach(async () => {
    // Initialize schema in both D1 contexts:
    // - test context (for direct env.RPG_DB reads in assertions)
    // - worker context (for SELF.fetch INSERT operations)
    await setupRpgDb(env.RPG_DB)
    await SELF.fetch('http://example.com/admin/map/setup-db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: ADMIN_SECRET }),
    })
  })
  async function mapPost(path: string, body: Record<string, unknown>, secret?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (secret) headers['X-Admin-Secret'] = secret
    return SELF.fetch(`http://example.com${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  }

  // ── /admin/map/push-hexes ──────────────────────────────────────────────────

  innerDescribe('/admin/map/push-hexes', () => {
    it('inserts hexes and returns ok:true with count', async () => {
      const res = await mapPost(
        '/admin/map/push-hexes',
        {
          mapId: 'test-map',
          hexes: [
            { q: 0, r: 0, terrain: 'forest', name: 'Thornwood', description: 'Dense forest' },
            { q: 1, r: 0, terrain: 'plains', name: 'Greenfield', description: 'Open plains' },
          ],
        },
        ADMIN_SECRET,
      )
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(true)
      expect(body.count).toBe(2)
    })

    it('upserts hexes on repeated push (INSERT OR REPLACE)', async () => {
      const hexes = [{ q: 0, r: 0, terrain: 'forest', name: 'Thornwood', description: 'v1' }]
      await mapPost('/admin/map/push-hexes', { mapId: 'test-map', hexes }, ADMIN_SECRET)

      const res = await mapPost(
        '/admin/map/push-hexes',
        { mapId: 'test-map', hexes: [{ q: 0, r: 0, terrain: 'mountains', name: 'Rockpeak', description: 'v2' }] },
        ADMIN_SECRET,
      )
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(true)
      expect(body.count).toBe(1)

      const row = await env.RPG_DB.prepare('SELECT terrain, label FROM hexes WHERE q=0 AND r=0 AND map_id=?')
        .bind('test-map').first<{ terrain: string; label: string }>()
      expect(row?.terrain).toBe('mountains')
      expect(row?.label).toBe('Rockpeak')
    })

    it('defaults map_id to "main" when mapId is absent', async () => {
      const res = await mapPost(
        '/admin/map/push-hexes',
        { hexes: [{ q: 2, r: 3, terrain: 'swamp', name: 'Bogmire', description: '' }] },
        ADMIN_SECRET,
      )
      expect(res.status).toBe(200)
      const row = await env.RPG_DB.prepare('SELECT map_id FROM hexes WHERE q=2 AND r=3 AND map_id="main"')
        .first<{ map_id: string }>()
      expect(row?.map_id).toBe('main')
    })

    it('returns ok:true with count 0 for empty hexes array', async () => {
      const res = await mapPost('/admin/map/push-hexes', { mapId: 'test-map', hexes: [] }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(true)
      expect(body.count).toBe(0)
    })

    it('stores description in the data JSON column', async () => {
      await mapPost(
        '/admin/map/push-hexes',
        { mapId: 'test-map', hexes: [{ q: 5, r: 5, terrain: 'tundra', name: 'Frostfield', description: 'Very cold' }] },
        ADMIN_SECRET,
      )
      const row = await env.RPG_DB.prepare('SELECT data FROM hexes WHERE q=5 AND r=5 AND map_id=?')
        .bind('test-map').first<{ data: string }>()
      expect(JSON.parse(row!.data).description).toBe('Very cold')
    })

    it('accepts auth via X-Admin-Secret header', async () => {
      const res = await mapPost(
        '/admin/map/push-hexes',
        { mapId: 'test-map', hexes: [{ q: 0, r: 0 }] },
        ADMIN_SECRET,
      )
      expect(res.status).toBe(200)
    })

    it('accepts auth via body secret field', async () => {
      const res = await SELF.fetch('http://example.com/admin/map/push-hexes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapId: 'test-map', hexes: [{ q: 0, r: 0 }], secret: ADMIN_SECRET }),
      })
      expect(res.status).toBe(200)
    })

    it('returns 401 with wrong secret', async () => {
      const res = await mapPost('/admin/map/push-hexes', { mapId: 'test-map', hexes: [] }, 'wrong-secret')
      expect(res.status).toBe(401)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(false)
    })

    it('returns 401 when secret is omitted', async () => {
      const res = await mapPost('/admin/map/push-hexes', { mapId: 'test-map', hexes: [] })
      expect(res.status).toBe(401)
    })
  })

  // ── /admin/map/push-landmarks ──────────────────────────────────────────────

  innerDescribe('/admin/map/push-landmarks', () => {
    it('inserts landmarks and returns ok:true with count', async () => {
      const res = await mapPost(
        '/admin/map/push-landmarks',
        {
          mapId: 'test-map',
          landmarks: [
            { id: 'lm-1', q: 0, r: 0, name: 'Thornkeep', type: 'castle', notes: 'Old fortress', attributes: '{}', linkedMapId: null, visible: true, linkedLoreKey: 'location:thornkeep' },
            { id: 'lm-2', q: 1, r: 1, name: 'Saltwell', type: 'well', notes: '', attributes: '{}', linkedMapId: null, visible: true, linkedLoreKey: null },
          ],
        },
        ADMIN_SECRET,
      )
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(true)
      expect(body.count).toBe(2)
    })

    it('upserts landmarks on repeated push (INSERT OR REPLACE)', async () => {
      const base = { id: 'lm-1', q: 0, r: 0, name: 'Thornkeep', type: 'castle', notes: '', attributes: '{}', linkedMapId: null, visible: true, linkedLoreKey: null }
      await mapPost('/admin/map/push-landmarks', { mapId: 'test-map', landmarks: [base] }, ADMIN_SECRET)

      const updated = { ...base, name: 'Thornkeep Ruins', type: 'ruin' }
      const res = await mapPost('/admin/map/push-landmarks', { mapId: 'test-map', landmarks: [updated] }, ADMIN_SECRET)
      expect(res.status).toBe(200)

      const row = await env.RPG_DB.prepare('SELECT name, category FROM landmarks WHERE id=?')
        .bind('lm-1').first<{ name: string; category: string }>()
      expect(row?.name).toBe('Thornkeep Ruins')
      expect(row?.category).toBe('ruin')
    })

    it('defaults map_id to "main" when mapId is absent', async () => {
      const res = await mapPost(
        '/admin/map/push-landmarks',
        { landmarks: [{ id: 'lm-x', q: 0, r: 0, name: 'Test', type: 'well', notes: '', attributes: '{}', linkedMapId: null, visible: true, linkedLoreKey: null }] },
        ADMIN_SECRET,
      )
      expect(res.status).toBe(200)
      const row = await env.RPG_DB.prepare('SELECT map_id FROM landmarks WHERE id=?')
        .bind('lm-x').first<{ map_id: string }>()
      expect(row?.map_id).toBe('main')
    })

    it('returns ok:true with count 0 for empty landmarks array', async () => {
      const res = await mapPost('/admin/map/push-landmarks', { mapId: 'test-map', landmarks: [] }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(true)
      expect(body.count).toBe(0)
    })

    it('stores extra fields in data JSON column', async () => {
      await mapPost(
        '/admin/map/push-landmarks',
        {
          mapId: 'test-map',
          landmarks: [{ id: 'lm-d', q: 0, r: 0, name: 'Hall', type: 'hall', notes: 'grand hall', attributes: '{"size":3}', linkedMapId: 'inner-map', visible: false, linkedLoreKey: 'location:hall' }],
        },
        ADMIN_SECRET,
      )
      const row = await env.RPG_DB.prepare('SELECT data FROM landmarks WHERE id=?')
        .bind('lm-d').first<{ data: string }>()
      const data = JSON.parse(row!.data)
      expect(data.notes).toBe('grand hall')
      expect(data.attributes).toBe('{"size":3}')
      expect(data.linkedMapId).toBe('inner-map')
      expect(data.visible).toBe(false)
      expect(data.linkedLoreKey).toBe('location:hall')
    })

    it('returns 401 with wrong secret', async () => {
      const res = await mapPost('/admin/map/push-landmarks', { mapId: 'test-map', landmarks: [] }, 'wrong')
      expect(res.status).toBe(401)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(false)
    })

    it('returns 401 when secret is omitted', async () => {
      const res = await mapPost('/admin/map/push-landmarks', { mapId: 'test-map', landmarks: [] })
      expect(res.status).toBe(401)
    })
  })
})
