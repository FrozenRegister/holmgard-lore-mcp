import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('admin endpoints', () => {
  async function adminPost(path: string, body: Record<string, unknown>) {
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

    it('returns 400 when key is null', async () => {
      const res = await adminPost('/admin/set-lore', { key: null, text: 'content', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when key is empty string', async () => {
      const res = await adminPost('/admin/set-lore', { key: '', text: 'content', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when key is whitespace only', async () => {
      const res = await adminPost('/admin/set-lore', { key: '   ', text: 'content', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when key is a number', async () => {
      const res = await adminPost('/admin/set-lore', { key: 42, text: 'content', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when key is an array', async () => {
      const res = await adminPost('/admin/set-lore', { key: ['foo', 'bar'], text: 'content', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when text is empty string', async () => {
      const res = await adminPost('/admin/set-lore', { key: 'admin:test-empty-text', text: '', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when text is whitespace only', async () => {
      const res = await adminPost('/admin/set-lore', { key: 'admin:test-ws-text', text: '   ', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when text is missing', async () => {
      const res = await adminPost('/admin/set-lore', { key: 'admin:test-missing-text', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })
  })

  describe('/admin/delete-lore', () => {
    it('deletes lore and returns ok:true with correct secret', async () => {
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

    it('returns 400 when key is null', async () => {
      const res = await adminPost('/admin/delete-lore', { key: null, secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when key is empty string', async () => {
      const res = await adminPost('/admin/delete-lore', { key: '', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when key is whitespace only', async () => {
      const res = await adminPost('/admin/delete-lore', { key: '   ', secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when key is a number', async () => {
      const res = await adminPost('/admin/delete-lore', { key: 42, secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })

    it('returns 400 when key is an array', async () => {
      const res = await adminPost('/admin/delete-lore', { key: ['k', 'v'], secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
    })
  })
})

