// eslint-disable-next-line deprecation/deprecation
import { env, SELF } from 'cloudflare:test'
import { expect, it } from 'vitest'
import { describe, ADMIN_SECRET } from './utils'

// ── Admin endpoints ───────────────────────────────────────────────────────────

describe('admin endpoints', () => {
  async function adminPost(path: string, body: Record<string, unknown>) {
    // eslint-disable-next-line deprecation/deprecation
    return SELF.fetch(`http://example.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  describe('/admin/set-lore', () => {
    it('stores lore and returns ok:true with correct secret', async () => {
      const res = await adminPost('/admin/set-lore', {
        key: 'admin:test', text: 'Admin content', secret: ADMIN_SECRET,
      })
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(true)
      expect(body.version).toBe(1)
    })

    it('returns 401 with wrong secret', async () => {
      const res = await adminPost('/admin/set-lore', {
        key: 'admin:test', text: 'Admin content', secret: 'wrong-secret',
      })
      expect(res.status).toBe(401)
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(false)
    })

    it('returns 401 when secret is omitted', async () => {
      const res = await adminPost('/admin/set-lore', { key: 'admin:test', text: 'Admin content' })
      expect(res.status).toBe(401)
    })

    it('returns 400 when key is missing', async () => {
      const res = await adminPost('/admin/set-lore', { text: 'Admin content', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })
  })

  describe('/admin/delete-lore', () => {
    it('deletes lore and returns ok:true with correct secret', async () => {
      // eslint-disable-next-line deprecation/deprecation
      await env.LORE_DB.put('admin:del-target', JSON.stringify({ text: 'to delete', meta: {} }))
      const res = await adminPost('/admin/delete-lore', { key: 'admin:del-target', secret: ADMIN_SECRET })
      const body = await res.json() as Record<string, any>
      expect(body.ok).toBe(true)
    })

    it('returns 401 with wrong secret', async () => {
      const res = await adminPost('/admin/delete-lore', { key: 'admin:test', secret: 'wrong' })
      expect(res.status).toBe(401)
    })

    it('returns 400 when key is missing', async () => {
      const res = await adminPost('/admin/delete-lore', { secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })
  })
})

// ── /admin/gc ─────────────────────────────────────────────────────────────────

describe('/admin/gc', () => {
  async function adminPost(path: string, body: Record<string, unknown>) {
    // eslint-disable-next-line deprecation/deprecation
    return SELF.fetch(`http://example.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('deletes orphan _history entries whose base key no longer exists', async () => {
    // eslint-disable-next-line deprecation/deprecation
    await env.LORE_DB.put('_history:orphan-key', JSON.stringify(['old']))
    const res = await adminPost('/admin/gc', { secret: ADMIN_SECRET, max_age_days: 1 })
    const body = await res.json() as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.deleted_history).toBeGreaterThanOrEqual(1)
    // eslint-disable-next-line deprecation/deprecation
    const check = await env.LORE_DB.get('_history:orphan-key')
    expect(check).toBeNull()
  })

  it('deletes old snapshots beyond max_age_days', async () => {
    const oldSnap = { name: 'old', created_at: '2020-01-01T00:00:00.000Z', manifest: {} }
    // eslint-disable-next-line deprecation/deprecation
    await env.LORE_DB.put('_snapshot:old-test-snap', JSON.stringify(oldSnap))
    const res = await adminPost('/admin/gc', { secret: ADMIN_SECRET, max_age_days: 30 })
    const body = await res.json() as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.deleted_snapshots).toBeGreaterThanOrEqual(1)
    // eslint-disable-next-line deprecation/deprecation
    const check = await env.LORE_DB.get('_snapshot:old-test-snap')
    expect(check).toBeNull()
  })

  it('returns 401 without correct secret', async () => {
    const res = await adminPost('/admin/gc', { secret: 'wrong', max_age_days: 30 })
    expect(res.status).toBe(401)
  })
})
