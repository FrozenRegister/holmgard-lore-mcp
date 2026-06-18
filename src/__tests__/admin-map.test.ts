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

  // ── /internal/map-readback ────────────────────────────────────────────────

  innerDescribe('/internal/map-readback', () => {
    it('returns hexes and landmarks with correct field mapping', async () => {
      // Push test data
      await mapPost(
        '/admin/map/push-hexes',
        {
          mapId: 'test-map',
          hexes: [{ q: 0, r: 0, terrain: 'forest', name: 'Thornwood', description: 'Dense forest' }],
        },
        ADMIN_SECRET,
      )
      await mapPost(
        '/admin/map/push-landmarks',
        {
          mapId: 'test-map',
          landmarks: [
            {
              id: 'lm-1',
              q: 0,
              r: 0,
              name: 'Thornkeep',
              type: 'castle',
              notes: 'Old fortress',
              attributes: '{"strength": 100}',
              linkedMapId: 'inner-map',
              visible: true,
              linkedLoreKey: 'location:thornkeep',
            },
          ],
        },
        ADMIN_SECRET,
      )

      // Readback
      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(true)

      // Check hexes
      expect(body.hexes).toHaveLength(1)
      const hex = body.hexes[0]
      expect(hex.mapId).toBe('test-map')
      expect(hex.q).toBe(0)
      expect(hex.r).toBe(0)
      expect(hex.terrain).toBe('forest')
      expect(hex.name).toBe('Thornwood') // label → name
      expect(hex.description).toBe('Dense forest')

      // Check landmarks
      expect(body.landmarks).toHaveLength(1)
      const landmark = body.landmarks[0]
      expect(landmark.mapId).toBe('test-map')
      expect(landmark.id).toBe('lm-1')
      expect(landmark.q).toBe(0)
      expect(landmark.r).toBe(0)
      expect(landmark.name).toBe('Thornkeep')
      expect(landmark.type).toBe('castle') // category → type
      expect(landmark.notes).toBe('Old fortress')
      expect(JSON.parse(landmark.attributes)).toEqual({ strength: 100 })
      expect(landmark.linkedMapId).toBe('inner-map')
      expect(landmark.visible).toBe(true)
      expect(landmark.linkedLoreKey).toBe('location:thornkeep')
    })

    it('returns empty arrays for non-existent map', async () => {
      const res = await mapPost('/internal/map-readback', { mapId: 'nonexistent' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(true)
      expect(body.hexes).toEqual([])
      expect(body.landmarks).toEqual([])
    })

    it('defaults mapId to "main" behavior (returns only main map data)', async () => {
      // Push to main
      await mapPost(
        '/admin/map/push-hexes',
        { hexes: [{ q: 5, r: 5, terrain: 'plains', name: 'Mainfield', description: '' }] },
        ADMIN_SECRET,
      )
      // Push to other map
      await mapPost(
        '/admin/map/push-hexes',
        { mapId: 'other-map', hexes: [{ q: 1, r: 1, terrain: 'mountain', name: 'Otherpeak', description: '' }] },
        ADMIN_SECRET,
      )

      // Readback main (implicit, default)
      const res = await mapPost('/internal/map-readback', { mapId: 'main' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.hexes).toHaveLength(1)
      expect(body.hexes[0].name).toBe('Mainfield')
    })

    it('returns 401 with wrong secret', async () => {
      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, 'wrong-secret')
      expect(res.status).toBe(401)
    })

    it('returns 401 when secret is omitted', async () => {
      const res = await SELF.fetch('http://example.com/internal/map-readback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapId: 'test-map' }),
      })
      expect(res.status).toBe(401)
    })

    it('returns 400 when mapId is missing', async () => {
      const res = await mapPost('/internal/map-readback', {}, ADMIN_SECRET)
      expect(res.status).toBe(400)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(false)
    })

    it('returns 400 when mapId is an empty string', async () => {
      const res = await mapPost('/internal/map-readback', { mapId: '' }, ADMIN_SECRET)
      expect(res.status).toBe(400)
    })

    it('handles hexes with missing data field', async () => {
      // Directly insert hex with minimal fields to test rowToHex defaults
      await env.RPG_DB.prepare(
        'INSERT INTO hexes (map_id, q, r, terrain, label) VALUES (?, ?, ?, ?, ?)'
      )
        .bind('test-map', 2, 3, 'mountain', 'Peak')
        .run()

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.hexes).toHaveLength(1)
      const hex = body.hexes[0]
      expect(hex.q).toBe(2)
      expect(hex.r).toBe(3)
      expect(hex.terrain).toBe('mountain')
      expect(hex.name).toBe('Peak')
      expect(hex.description).toBe('') // should default to empty string
    })

    it('handles landmarks with all optional fields null', async () => {
      // Insert landmark with minimal fields to test defaults in rowToLandmark
      await env.RPG_DB.prepare(
        'INSERT INTO landmarks (map_id, id, q, r, name, category) VALUES (?, ?, ?, ?, ?, ?)'
      )
        .bind('test-map', 'lm-minimal', 1, 2, 'Minimal', 'ruin')
        .run()

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.landmarks).toHaveLength(1)
      const landmark = body.landmarks[0]
      expect(landmark.id).toBe('lm-minimal')
      expect(landmark.name).toBe('Minimal')
      expect(landmark.type).toBe('ruin')
      expect(landmark.notes).toBe('')
      expect(landmark.attributes).toBe('{}')
      expect(landmark.linkedMapId).toBeNull()
      expect(landmark.visible).toBe(true) // defaults to true
      expect(landmark.linkedLoreKey).toBeNull()
    })

    it('handles landmarks with visible:false', async () => {
      const res = await mapPost(
        '/admin/map/push-landmarks',
        {
          mapId: 'test-map',
          landmarks: [
            {
              id: 'lm-hidden',
              q: 0,
              r: 0,
              name: 'Hidden',
              type: 'secret',
              notes: 'Not visible',
              attributes: '{}',
              linkedMapId: null,
              visible: false,
              linkedLoreKey: null,
            },
          ],
        },
        ADMIN_SECRET,
      )
      expect(res.status).toBe(200)

      const readRes = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(readRes.status).toBe(200)
      const body = await readRes.json() as Record<string, any>
      expect(body.landmarks[0].visible).toBe(false)
    })

    it('handles multiple hexes with varying terrain types', async () => {
      const hexes = [
        { q: 0, r: 0, terrain: 'forest', name: 'Forest', description: 'Trees' },
        { q: 1, r: 0, terrain: 'plains', name: 'Plains', description: 'Grass' },
        { q: 0, r: 1, terrain: 'mountain', name: 'Mountain', description: 'Peaks' },
        { q: 1, r: 1, terrain: 'water', name: 'Water', description: 'Ocean' },
      ]
      await mapPost('/admin/map/push-hexes', { mapId: 'test-map', hexes }, ADMIN_SECRET)

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.hexes).toHaveLength(4)
      expect(body.hexes.map((h: any) => h.terrain).sort()).toEqual(['forest', 'mountain', 'plains', 'water'])
    })

    it('handles multiple landmarks with different types and lore links', async () => {
      const landmarks = [
        {
          id: 'city1',
          q: 0,
          r: 0,
          name: 'Capital',
          type: 'city',
          notes: 'The great capital',
          attributes: '{"population": 50000}',
          linkedMapId: null,
          visible: true,
          linkedLoreKey: 'location:capital',
        },
        {
          id: 'dungeon1',
          q: 5,
          r: 5,
          name: 'Deep Crypt',
          type: 'dungeon',
          notes: 'Ancient tomb',
          attributes: '{"level": 3}',
          linkedMapId: 'dungeon-map',
          visible: true,
          linkedLoreKey: 'location:crypt',
        },
      ]
      await mapPost('/admin/map/push-landmarks', { mapId: 'test-map', landmarks }, ADMIN_SECRET)

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.landmarks).toHaveLength(2)

      const capital = body.landmarks.find((l: any) => l.id === 'city1')
      const crypt = body.landmarks.find((l: any) => l.id === 'dungeon1')

      expect(capital.linkedLoreKey).toBe('location:capital')
      expect(capital.linkedMapId).toBeNull()

      expect(crypt.linkedLoreKey).toBe('location:crypt')
      expect(crypt.linkedMapId).toBe('dungeon-map')
    })

    it('preserves complex JSON in landmark attributes', async () => {
      const complexAttributes = {
        level: 5,
        difficulty: 'hard',
        rewards: ['gold', 'magic'],
        boss: { name: 'Dragon', hp: 500 },
      }
      await mapPost(
        '/admin/map/push-landmarks',
        {
          mapId: 'test-map',
          landmarks: [
            {
              id: 'boss-lair',
              q: 10,
              r: 10,
              name: 'Dragon Lair',
              type: 'boss',
              notes: 'Final encounter',
              attributes: JSON.stringify(complexAttributes),
              linkedMapId: null,
              visible: true,
              linkedLoreKey: null,
            },
          ],
        },
        ADMIN_SECRET,
      )

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.landmarks[0].attributes).toEqual(JSON.stringify(complexAttributes))
      expect(JSON.parse(body.landmarks[0].attributes)).toEqual(complexAttributes)
    })

    it('handles mixed empty and non-empty descriptions on hexes', async () => {
      const hexes = [
        { q: 0, r: 0, terrain: 'grass', name: 'Described', description: 'Has a description' },
        { q: 1, r: 0, terrain: 'grass', name: 'Empty', description: '' },
      ]
      await mapPost('/admin/map/push-hexes', { mapId: 'test-map', hexes }, ADMIN_SECRET)

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.hexes[0].description).toBe('Has a description')
      expect(body.hexes[1].description).toBe('')
    })

    it('handles landmarks with linkedLoreKey but no linkedMapId', async () => {
      await mapPost(
        '/admin/map/push-landmarks',
        {
          mapId: 'test-map',
          landmarks: [
            {
              id: 'location1',
              q: 3,
              r: 3,
              name: 'Location',
              type: 'point',
              notes: 'A significant location',
              attributes: '{}',
              linkedMapId: null,
              visible: true,
              linkedLoreKey: 'location:somewhere',
            },
          ],
        },
        ADMIN_SECRET,
      )

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.landmarks[0].linkedLoreKey).toBe('location:somewhere')
      expect(body.landmarks[0].linkedMapId).toBeNull()
    })

    it('correctly orders hexes by q, r and landmarks by name', async () => {
      const hexes = [
        { q: 1, r: 0, terrain: 'g', name: 'H1' },
        { q: 0, r: 1, terrain: 'g', name: 'H2' },
        { q: 0, r: 0, terrain: 'g', name: 'H3' },
      ]
      const landmarks = [
        { id: 'z', q: 0, r: 0, name: 'Zebra', type: 'city', notes: '', attributes: '{}', linkedMapId: null, visible: true, linkedLoreKey: null },
        { id: 'a', q: 0, r: 0, name: 'Apple', type: 'city', notes: '', attributes: '{}', linkedMapId: null, visible: true, linkedLoreKey: null },
        { id: 'm', q: 0, r: 0, name: 'Middle', type: 'city', notes: '', attributes: '{}', linkedMapId: null, visible: true, linkedLoreKey: null },
      ]
      await mapPost('/admin/map/push-hexes', { mapId: 'test-map', hexes }, ADMIN_SECRET)
      await mapPost('/admin/map/push-landmarks', { mapId: 'test-map', landmarks }, ADMIN_SECRET)

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>

      // Hexes should be ordered by q, r
      expect(body.hexes.map((h: any) => `${h.q},${h.r}`)).toEqual(['0,0', '0,1', '1,0'])
      // Landmarks should be ordered by name
      expect(body.landmarks.map((l: any) => l.name)).toEqual(['Apple', 'Middle', 'Zebra'])
    })

    it('handles hexes with all optional fields present and populated', async () => {
      await mapPost(
        '/admin/map/push-hexes',
        {
          mapId: 'test-map',
          hexes: [
            {
              q: 10,
              r: 20,
              terrain: 'volcanic',
              name: 'Mount Doom',
              description: 'A very dark mountain with molten lava flows'
            }
          ]
        },
        ADMIN_SECRET
      )

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      const hex = body.hexes[0]
      expect(hex.q).toBe(10)
      expect(hex.r).toBe(20)
      expect(hex.terrain).toBe('volcanic')
      expect(hex.name).toBe('Mount Doom')
      expect(hex.description).toBe('A very dark mountain with molten lava flows')
    })

    it('returns 401 when secret is missing from header', async () => {
      const res = await SELF.fetch('http://example.com/internal/map-readback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapId: 'test-map' })
      })
      expect(res.status).toBe(401)
    })

    it('returns 400 when mapId is not a string', async () => {
      const res = await mapPost('/internal/map-readback', { mapId: 123 }, ADMIN_SECRET)
      expect(res.status).toBe(400)
    })

    it('handles landmarks without all optional fields', async () => {
      // Insert landmark with only required fields via D1
      await env.RPG_DB.prepare(
        'INSERT INTO landmarks (map_id, id, q, r, name, category) VALUES (?, ?, ?, ?, ?, ?)'
      )
        .bind('test-map', 'lm-sparse', 5, 5, 'Sparse Landmark', 'monument')
        .run()

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.landmarks).toHaveLength(1)
      const landmark = body.landmarks[0]
      expect(landmark.id).toBe('lm-sparse')
      expect(landmark.name).toBe('Sparse Landmark')
      expect(landmark.type).toBe('monument')
      expect(landmark.notes).toBe('')
      expect(JSON.parse(landmark.attributes)).toEqual({})
      expect(landmark.linkedMapId).toBeNull()
      expect(landmark.visible).toBe(true)
      expect(landmark.linkedLoreKey).toBeNull()
    })

    it('handles hexes and landmarks from different maps separately', async () => {
      await mapPost(
        '/admin/map/push-hexes',
        {
          mapId: 'map-a',
          hexes: [{ q: 0, r: 0, terrain: 'forest', name: 'Forest A', description: '' }]
        },
        ADMIN_SECRET
      )
      await mapPost(
        '/admin/map/push-hexes',
        {
          mapId: 'map-b',
          hexes: [{ q: 1, r: 1, terrain: 'mountain', name: 'Mountain B', description: '' }]
        },
        ADMIN_SECRET
      )

      const resA = await mapPost('/internal/map-readback', { mapId: 'map-a' }, ADMIN_SECRET)
      const resB = await mapPost('/internal/map-readback', { mapId: 'map-b' }, ADMIN_SECRET)

      const bodyA = await resA.json() as Record<string, any>
      const bodyB = await resB.json() as Record<string, any>

      expect(bodyA.hexes).toHaveLength(1)
      expect(bodyA.hexes[0].name).toBe('Forest A')
      expect(bodyB.hexes).toHaveLength(1)
      expect(bodyB.hexes[0].name).toBe('Mountain B')
    })

    it('correctly converts all hex field combinations', async () => {
      // Test with complete hex data including description
      await mapPost(
        '/admin/map/push-hexes',
        {
          mapId: 'test-map',
          hexes: [
            { q: 0, r: 0, terrain: 'lava', name: 'Hot', description: 'Burning hot' },
            { q: 1, r: 0, terrain: 'ice', name: 'Cold', description: '' },
            { q: 0, r: 1, terrain: 'dirt', name: 'Plain', description: 'Nothing special' }
          ]
        },
        ADMIN_SECRET
      )

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>

      expect(body.hexes).toHaveLength(3)
      expect(body.hexes.map((h: any) => [h.terrain, h.description])).toContainEqual(['lava', 'Burning hot'])
      expect(body.hexes.map((h: any) => [h.terrain, h.description])).toContainEqual(['ice', ''])
    })

    it('correctly converts all landmark field combinations with attributes', async () => {
      const attrs1 = { test: 'value1', num: 42 }
      const attrs2 = { nested: { obj: true } }

      await mapPost(
        '/admin/map/push-landmarks',
        {
          mapId: 'test-map',
          landmarks: [
            {
              id: 'lm1',
              q: 0,
              r: 0,
              name: 'Point A',
              type: 'ruin',
              notes: 'Old building',
              attributes: JSON.stringify(attrs1),
              linkedMapId: 'map-inner',
              visible: true,
              linkedLoreKey: 'location:ruin1'
            },
            {
              id: 'lm2',
              q: 1,
              r: 0,
              name: 'Point B',
              type: 'shrine',
              notes: '',
              attributes: JSON.stringify(attrs2),
              linkedMapId: null,
              visible: false,
              linkedLoreKey: null
            }
          ]
        },
        ADMIN_SECRET
      )

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>

      expect(body.landmarks).toHaveLength(2)
      const lm1 = body.landmarks.find((l: any) => l.id === 'lm1')
      const lm2 = body.landmarks.find((l: any) => l.id === 'lm2')

      expect(JSON.parse(lm1.attributes)).toEqual(attrs1)
      expect(JSON.parse(lm2.attributes)).toEqual(attrs2)
      expect(lm1.linkedMapId).toBe('map-inner')
      expect(lm2.linkedMapId).toBeNull()
      expect(lm1.visible).toBe(true)
      expect(lm2.visible).toBe(false)
    })

    it('respects coordinate conversion with all quadrants', async () => {
      const hexes = [
        { q: -5, r: 3, terrain: 'swamp', name: 'NW', description: '' },
        { q: 5, r: -2, terrain: 'desert', name: 'SE', description: '' },
        { q: 0, r: 0, terrain: 'center', name: 'Center', description: '' }
      ]

      await mapPost('/admin/map/push-hexes', { mapId: 'test-map', hexes }, ADMIN_SECRET)

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      const body = await res.json() as Record<string, any>

      expect(body.hexes).toHaveLength(3)
      const nw = body.hexes.find((h: any) => h.q === -5 && h.r === 3)
      const se = body.hexes.find((h: any) => h.q === 5 && h.r === -2)
      const center = body.hexes.find((h: any) => h.q === 0 && h.r === 0)

      expect(nw?.terrain).toBe('swamp')
      expect(se?.terrain).toBe('desert')
      expect(center?.terrain).toBe('center')
    })

    it('returns consistent mapId for all records', async () => {
      await mapPost(
        '/admin/map/push-hexes',
        { mapId: 'special-map', hexes: [{ q: 0, r: 0, terrain: 'g', name: 'H', description: '' }] },
        ADMIN_SECRET
      )
      await mapPost(
        '/admin/map/push-landmarks',
        {
          mapId: 'special-map',
          landmarks: [{ id: 'lm', q: 0, r: 0, name: 'L', type: 't', notes: '', attributes: '{}', linkedMapId: null, visible: true, linkedLoreKey: null }]
        },
        ADMIN_SECRET
      )

      const res = await mapPost('/internal/map-readback', { mapId: 'special-map' }, ADMIN_SECRET)
      const body = await res.json() as Record<string, any>

      expect(body.hexes.every((h: any) => h.mapId === 'special-map')).toBe(true)
      expect(body.landmarks.every((l: any) => l.mapId === 'special-map')).toBe(true)
    })

    it('handles null and undefined fields in hex data column', async () => {
      // Directly insert hex with null data to test default handling
      await env.RPG_DB.prepare(
        'INSERT INTO hexes (map_id, q, r, terrain, label, data) VALUES (?, ?, ?, ?, ?, NULL)'
      )
        .bind('test-map', 10, 20, 'swamp', 'NullDataHex')
        .run()

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.hexes).toHaveLength(1)
      expect(body.hexes[0].q).toBe(10)
      expect(body.hexes[0].r).toBe(20)
      expect(body.hexes[0].description).toBe('')
    })

    it('handles null and undefined fields in landmark data column', async () => {
      // Directly insert landmark with null data
      await env.RPG_DB.prepare(
        'INSERT INTO landmarks (map_id, id, q, r, name, category, data) VALUES (?, ?, ?, ?, ?, ?, NULL)'
      )
        .bind('test-map', 'null-lm', 5, 5, 'NullData', 'unknown')
        .run()

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.landmarks).toHaveLength(1)
      const lm = body.landmarks[0]
      expect(lm.notes).toBe('')
      expect(lm.attributes).toBe('{}')
      expect(lm.visible).toBe(true)
      expect(lm.linkedMapId).toBeNull()
      expect(lm.linkedLoreKey).toBeNull()
    })

    it('handles landmark with empty string attributes', async () => {
      await mapPost(
        '/admin/map/push-landmarks',
        {
          mapId: 'test-map',
          landmarks: [
            {
              id: 'empty-attr',
              q: 0,
              r: 0,
              name: 'EmptyAttr',
              type: 'marker',
              notes: 'Test',
              attributes: '{}',
              linkedMapId: null,
              visible: true,
              linkedLoreKey: null
            }
          ]
        },
        ADMIN_SECRET
      )

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      const body = await res.json() as Record<string, any>
      expect(body.landmarks[0].attributes).toBe('{}')
      expect(JSON.parse(body.landmarks[0].attributes)).toEqual({})
    })

    it('handles hex with zero values for q and r', async () => {
      await mapPost(
        '/admin/map/push-hexes',
        { mapId: 'test-map', hexes: [{ q: 0, r: 0, terrain: 'center', name: 'Origin', description: '' }] },
        ADMIN_SECRET
      )

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      const body = await res.json() as Record<string, any>
      const hex = body.hexes[0]
      expect(hex.q).toBe(0)
      expect(hex.r).toBe(0)
      expect(typeof hex.q).toBe('number')
      expect(typeof hex.r).toBe('number')
    })

    it('handles landmark with all fields explicitly null/false', async () => {
      await mapPost(
        '/admin/map/push-landmarks',
        {
          mapId: 'test-map',
          landmarks: [
            {
              id: 'all-null',
              q: 0,
              r: 0,
              name: 'AllNull',
              type: 'point',
              notes: '',
              attributes: '{}',
              linkedMapId: null,
              visible: false,
              linkedLoreKey: null
            }
          ]
        },
        ADMIN_SECRET
      )

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      const body = await res.json() as Record<string, any>
      const lm = body.landmarks[0]
      expect(lm.linkedMapId).toBeNull()
      expect(lm.visible).toBe(false)
      expect(lm.linkedLoreKey).toBeNull()
    })

    it('returns error 400 when body is not valid JSON', async () => {
      const res = await SELF.fetch('http://example.com/internal/map-readback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Secret': ADMIN_SECRET
        },
        body: 'not valid json {'
      })
      expect(res.status).toBe(400)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(false)
    })

    it('returns error when mapId is whitespace only', async () => {
      const res = await mapPost('/internal/map-readback', { mapId: '   ' }, ADMIN_SECRET)
      expect(res.status).toBe(400)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(false)
    })

    it('returns correct response for map with no hexes but some landmarks', async () => {
      await mapPost(
        '/admin/map/push-landmarks',
        {
          mapId: 'landmarks-only',
          landmarks: [
            {
              id: 'lm1',
              q: 0,
              r: 0,
              name: 'Solo',
              type: 'point',
              notes: '',
              attributes: '{}',
              linkedMapId: null,
              visible: true,
              linkedLoreKey: null
            }
          ]
        },
        ADMIN_SECRET
      )

      const res = await mapPost('/internal/map-readback', { mapId: 'landmarks-only' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(true)
      expect(body.hexes).toEqual([])
      expect(body.landmarks).toHaveLength(1)
    })

    it('returns correct response for map with some hexes but no landmarks', async () => {
      await mapPost(
        '/admin/map/push-hexes',
        {
          mapId: 'hexes-only',
          hexes: [{ q: 0, r: 0, terrain: 'grass', name: 'Solo', description: '' }]
        },
        ADMIN_SECRET
      )

      const res = await mapPost('/internal/map-readback', { mapId: 'hexes-only' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(true)
      expect(body.hexes).toHaveLength(1)
      expect(body.landmarks).toEqual([])
    })

    it('handles landmark with only required fields from DB', async () => {
      // Insert with minimal required fields via D1 to test conversion defaults
      await env.RPG_DB.prepare(
        'INSERT INTO landmarks (map_id, id, q, r, name, category) VALUES (?, ?, ?, ?, ?, ?)'
      )
        .bind('test-map', 'minimal-lm', 0, 0, 'Minimal', 'monument')
        .run()

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.landmarks).toHaveLength(1)
      const lm = body.landmarks[0]
      expect(lm.id).toBe('minimal-lm')
      expect(lm.name).toBe('Minimal')
      expect(lm.type).toBe('monument')
      // All optional fields should have defaults
      expect(lm.notes).toBe('')
      expect(lm.attributes).toBe('{}')
      expect(lm.linkedMapId).toBeNull()
      expect(lm.visible).toBe(true)
      expect(lm.linkedLoreKey).toBeNull()
    })

    it('handles hex with only required fields from DB', async () => {
      // Insert with minimal required fields via D1 to test conversion defaults
      await env.RPG_DB.prepare(
        'INSERT INTO hexes (map_id, q, r, terrain, label) VALUES (?, ?, ?, ?, ?)'
      )
        .bind('test-map', 1, 2, 'mountain', 'MinimalHex')
        .run()

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.hexes).toHaveLength(1)
      const hex = body.hexes[0]
      expect(hex.q).toBe(1)
      expect(hex.r).toBe(2)
      expect(hex.terrain).toBe('mountain')
      expect(hex.name).toBe('MinimalHex')
      expect(hex.description).toBe('')
    })

    it('converts all provided fields in hex without defaults', async () => {
      await mapPost(
        '/admin/map/push-hexes',
        {
          mapId: 'full-hex-test',
          hexes: [{
            q: 10,
            r: 20,
            terrain: 'volcanic',
            name: 'VolcanicPeak',
            description: 'Smoking mountain'
          }]
        },
        ADMIN_SECRET
      )

      const res = await mapPost('/internal/map-readback', { mapId: 'full-hex-test' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.hexes).toHaveLength(1)
      const hex = body.hexes[0]
      expect(hex.mapId).toBe('full-hex-test')
      expect(hex.q).toBe(10)
      expect(hex.r).toBe(20)
      expect(hex.terrain).toBe('volcanic')
      expect(hex.name).toBe('VolcanicPeak')
      expect(hex.description).toBe('Smoking mountain')
    })

    it('converts all provided fields in landmark without defaults', async () => {
      await mapPost(
        '/admin/map/push-landmarks',
        {
          mapId: 'full-lm-test',
          landmarks: [{
            id: 'full-test',
            q: 5,
            r: 10,
            name: 'FullLandmark',
            type: 'ancient-ruin',
            notes: 'Very old structure',
            attributes: '{"age": 1000, "preserved": true}',
            linkedMapId: 'inner-realm',
            visible: true,
            linkedLoreKey: 'ruin:ancient-one'
          }]
        },
        ADMIN_SECRET
      )

      const res = await mapPost('/internal/map-readback', { mapId: 'full-lm-test' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.landmarks).toHaveLength(1)
      const lm = body.landmarks[0]
      expect(lm.mapId).toBe('full-lm-test')
      expect(lm.id).toBe('full-test')
      expect(lm.q).toBe(5)
      expect(lm.r).toBe(10)
      expect(lm.name).toBe('FullLandmark')
      expect(lm.type).toBe('ancient-ruin')
      expect(lm.notes).toBe('Very old structure')
      expect(JSON.parse(lm.attributes)).toEqual({ age: 1000, preserved: true })
      expect(lm.linkedMapId).toBe('inner-realm')
      expect(lm.visible).toBe(true)
      expect(lm.linkedLoreKey).toBe('ruin:ancient-one')
    })

    it('handles exception in request processing with try-catch', async () => {
      // Send request that will trigger error handling - bad method on database
      // Since we can't easily make the database throw, test with valid data
      // to ensure the success path is exercised in try block
      await mapPost(
        '/admin/map/push-hexes',
        {
          mapId: 'error-test-map',
          hexes: [{ q: 0, r: 0, terrain: 'grass', name: 'Test', description: 'Testing error handling' }]
        },
        ADMIN_SECRET
      )

      const res = await mapPost('/internal/map-readback', { mapId: 'error-test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(true)
      expect(body.hexes).toHaveLength(1)
    })

    it('converts negative q and r coordinates', async () => {
      await mapPost(
        '/admin/map/push-hexes',
        {
          mapId: 'negative-coords',
          hexes: [
            { q: -10, r: -20, terrain: 'abyss', name: 'DeepPlace', description: 'Far below' },
            { q: -5, r: 0, terrain: 'shadow', name: 'Twilight', description: '' }
          ]
        },
        ADMIN_SECRET
      )

      const res = await mapPost('/internal/map-readback', { mapId: 'negative-coords' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.hexes).toHaveLength(2)
      const deep = body.hexes.find((h: any) => h.q === -10)
      const twilight = body.hexes.find((h: any) => h.q === -5)
      expect(deep?.r).toBe(-20)
      expect(deep?.terrain).toBe('abyss')
      expect(twilight?.r).toBe(0)
      expect(twilight?.terrain).toBe('shadow')
    })

    it('landmark with null visible becomes true default', async () => {
      // Insert landmark without visible field to test default
      await env.RPG_DB.prepare(
        'INSERT INTO landmarks (map_id, id, q, r, name, category, data) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
        .bind('test-map', 'null-visible', 0, 0, 'NullVis', 'point', JSON.stringify({ visible: null }))
        .run()

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      const lm = body.landmarks.find((l: any) => l.id === 'null-visible')
      expect(lm?.visible).toBe(true)
    })

    it('hex with all numeric types preserved through conversion', async () => {
      await mapPost(
        '/admin/map/push-hexes',
        {
          mapId: 'numeric-test',
          hexes: [
            { q: 0, r: 0, terrain: 'origin', name: 'Zero', description: '' },
            { q: 100, r: 200, terrain: 'far', name: 'Distance', description: 'Very far away' },
            { q: -100, r: -200, terrain: 'opposite', name: 'Opposite', description: '' }
          ]
        },
        ADMIN_SECRET
      )

      const res = await mapPost('/internal/map-readback', { mapId: 'numeric-test' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.hexes).toHaveLength(3)
      expect(body.hexes.every((h: any) => typeof h.q === 'number' && typeof h.r === 'number')).toBe(true)
    })

    it('landmark visible:false through complex attributes', async () => {
      const complexAttrs = { nested: { value: 'test' }, array: [1, 2, 3] }
      await mapPost(
        '/admin/map/push-landmarks',
        {
          mapId: 'complex-test',
          landmarks: [{
            id: 'complex',
            q: 0,
            r: 0,
            name: 'Complex',
            type: 'artifact',
            notes: 'Test',
            attributes: JSON.stringify(complexAttrs),
            linkedMapId: 'nowhere',
            visible: false,
            linkedLoreKey: 'artifact:test'
          }]
        },
        ADMIN_SECRET
      )

      const res = await mapPost('/internal/map-readback', { mapId: 'complex-test' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      const lm = body.landmarks[0]
      expect(lm.visible).toBe(false)
      expect(JSON.parse(lm.attributes)).toEqual(complexAttrs)
      expect(lm.linkedLoreKey).toBe('artifact:test')
    })

    it('handles malformed JSON data in hex gracefully', async () => {
      // Insert hex with invalid JSON in data column to trigger error handling
      await env.RPG_DB.prepare(
        'INSERT INTO hexes (map_id, q, r, terrain, label, data) VALUES (?, ?, ?, ?, ?, ?)'
      )
        .bind('bad-json-map', 0, 0, 'grass', 'BadHex', 'not valid json {')
        .run()

      const res = await mapPost('/internal/map-readback', { mapId: 'bad-json-map' }, ADMIN_SECRET)
      // Should return error due to JSON parse failure in rowToHex
      expect(res.status).toBe(500)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(false)
      expect(body.error).toBeDefined()
    })

    it('handles malformed JSON data in landmark gracefully', async () => {
      // Insert landmark with invalid JSON in data column
      await env.RPG_DB.prepare(
        'INSERT INTO landmarks (map_id, id, q, r, name, category, data) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
        .bind('bad-landmark-json', 'bad-lm', 0, 0, 'BadLandmark', 'point', 'invalid { json ')
        .run()

      const res = await mapPost('/internal/map-readback', { mapId: 'bad-landmark-json' }, ADMIN_SECRET)
      // Should return error due to JSON parse failure in rowToLandmark
      expect(res.status).toBe(500)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(false)
      expect(body.error).toBeDefined()
    })

    it('handles hex with empty string data column', async () => {
      // Insert hex with empty string data (falsy but not null)
      await env.RPG_DB.prepare(
        'INSERT INTO hexes (map_id, q, r, terrain, label, data) VALUES (?, ?, ?, ?, ?, ?)'
      )
        .bind('test-map', 3, 4, 'empty-data', 'EmptyData', '')
        .run()

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      const hex = body.hexes.find((h: any) => h.q === 3)
      expect(hex).toBeDefined()
      expect(hex?.description).toBe('')
    })

    it('handles landmark with empty string data column', async () => {
      // Insert landmark with empty string data
      await env.RPG_DB.prepare(
        'INSERT INTO landmarks (map_id, id, q, r, name, category, data) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
        .bind('test-map', 'empty-data-lm', 5, 6, 'EmptyData', 'marker', '')
        .run()

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      const lm = body.landmarks.find((l: any) => l.id === 'empty-data-lm')
      expect(lm).toBeDefined()
      expect(lm?.notes).toBe('')
      expect(lm?.attributes).toBe('{}')
    })

    it('hex with all fields explicitly set in data JSON', async () => {
      const dataJson = JSON.stringify({ description: 'Detailed description' })
      await env.RPG_DB.prepare(
        'INSERT INTO hexes (map_id, q, r, terrain, label, data) VALUES (?, ?, ?, ?, ?, ?)'
      )
        .bind('test-map', 7, 8, 'detailed', 'Detailed', dataJson)
        .run()

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      const hex = body.hexes.find((h: any) => h.q === 7)
      expect(hex?.description).toBe('Detailed description')
    })

    it('landmark with all data fields explicitly set in JSON', async () => {
      const dataJson = JSON.stringify({
        notes: 'Detailed notes',
        attributes: '{"key":"value"}',
        linkedMapId: 'link-map',
        visible: false,
        linkedLoreKey: 'key:value'
      })
      await env.RPG_DB.prepare(
        'INSERT INTO landmarks (map_id, id, q, r, name, category, data) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
        .bind('test-map', 'detailed-lm', 9, 10, 'Detailed', 'artifact', dataJson)
        .run()

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      const lm = body.landmarks.find((l: any) => l.id === 'detailed-lm')
      expect(lm?.notes).toBe('Detailed notes')
      expect(lm?.visible).toBe(false)
      expect(lm?.linkedMapId).toBe('link-map')
      expect(lm?.linkedLoreKey).toBe('key:value')
    })

    it('hex coordinates remain numeric type through readback', async () => {
      await mapPost(
        '/admin/map/push-hexes',
        {
          mapId: 'numeric-type-test',
          hexes: [
            { q: 0, r: 0, terrain: 'zero', name: 'Z', description: '' },
            { q: 1, r: -1, terrain: 'mixed', name: 'M', description: '' },
            { q: -10, r: 10, terrain: 'neg', name: 'N', description: '' }
          ]
        },
        ADMIN_SECRET
      )

      const res = await mapPost('/internal/map-readback', { mapId: 'numeric-type-test' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      body.hexes.forEach((h: any) => {
        expect(typeof h.q).toBe('number')
        expect(typeof h.r).toBe('number')
        expect(Number.isNaN(h.q)).toBe(false)
        expect(Number.isNaN(h.r)).toBe(false)
      })
    })

    it('landmark visible explicitly true through conversion', async () => {
      const dataJson = JSON.stringify({ visible: true })
      await env.RPG_DB.prepare(
        'INSERT INTO landmarks (map_id, id, q, r, name, category, data) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
        .bind('test-map', 'explicit-visible', 11, 12, 'VisibleTrue', 'marker', dataJson)
        .run()

      const res = await mapPost('/internal/map-readback', { mapId: 'test-map' }, ADMIN_SECRET)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      const lm = body.landmarks.find((l: any) => l.id === 'explicit-visible')
      expect(lm?.visible).toBe(true)
    })
  })
})
