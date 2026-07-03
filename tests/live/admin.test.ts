import { describe, it, expect } from 'vitest'
import { BASE_URL, MCP_API_KEY, ADMIN_SECRET, adminPost, tool, uid } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rawAdminPost(endpoint: string, body: Record<string, unknown>): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': MCP_API_KEY },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() }
}

describe.skipIf(!MCP_API_KEY || !ADMIN_SECRET)('Admin Endpoints', () => {
  it('admin/set-lore endpoint', async () => {
    const key = `test:admin-set-${uid()}`
    const res = await adminPost('/admin/set-lore', { key, text: 'Admin test content.' })
    expect(res.ok).toBe(true)
    await tool('lore_manage', { action: 'delete', key })
  })

  it('admin/delete-lore endpoint', async () => {
    const key = `test:admin-delete-${uid()}`
    await tool('lore_manage', { action: 'set', key, text: 'Admin test content.' })
    const res = await adminPost('/admin/delete-lore', { key })
    expect(res.ok).toBe(true)
  })

  it('admin/gc returns ok:true with deleted_csp_reports count', async () => {
    const res = await adminPost('/admin/gc', {})
    expect(res.ok).toBe(true)
    expect(typeof res.deleted_csp_reports).toBe('number')
  })

  it('admin/set-lore-batch endpoint', async () => {
    const k1 = `test:batch-set-${uid()}`
    const k2 = `test:batch-set-${uid()}`
    const res = await adminPost('/admin/set-lore-batch', {
      items: [{ key: k1, text: 'Batch A' }, { key: k2, text: 'Batch B' }],
    })
    expect(res.ok).toBe(true)
    expect(res.saved).toBe(2)
    await adminPost('/admin/delete-lore-batch', { keys: [k1, k2] })
  })

  it('admin/delete-lore-batch endpoint', async () => {
    const k1 = `test:batch-del-${uid()}`
    const k2 = `test:batch-del-${uid()}`
    await adminPost('/admin/set-lore-batch', {
      items: [{ key: k1, text: 'Del A' }, { key: k2, text: 'Del B' }],
    })
    const res = await adminPost('/admin/delete-lore-batch', { keys: [k1, k2] })
    expect(res.ok).toBe(true)
    expect(res.deleted).toBe(2)
  })
})

// Malformed-request edge cases against the deployed worker — the happy-path
// tests above only exercise valid input. See issue #31: these are the smoke-test
// equivalent of src/__tests__/admin.test.ts's validation coverage, run against
// the live worker instead of miniflare.
describe.skipIf(!MCP_API_KEY || !ADMIN_SECRET)('Admin Endpoints — malformed requests', () => {
  describe('/admin/set-lore', () => {
    it('rejects an empty body', async () => {
      const { status } = await rawAdminPost('/admin/set-lore', { secret: ADMIN_SECRET })
      expect(status).toBe(400)
    })

    it('rejects a null key', async () => {
      const { status } = await rawAdminPost('/admin/set-lore', { key: null, text: 'x', secret: ADMIN_SECRET })
      expect(status).toBe(400)
    })

    it('rejects an empty string key', async () => {
      const { status } = await rawAdminPost('/admin/set-lore', { key: '', text: 'x', secret: ADMIN_SECRET })
      expect(status).toBe(400)
    })

    it('rejects a whitespace-only key', async () => {
      const { status } = await rawAdminPost('/admin/set-lore', { key: '   ', text: 'x', secret: ADMIN_SECRET })
      expect(status).toBe(400)
    })

    it('rejects a numeric key', async () => {
      const { status } = await rawAdminPost('/admin/set-lore', { key: 42, text: 'x', secret: ADMIN_SECRET })
      expect(status).toBe(400)
    })

    it('rejects empty text', async () => {
      const { status } = await rawAdminPost('/admin/set-lore', { key: `test:edge-${uid()}`, text: '', secret: ADMIN_SECRET })
      expect(status).toBe(400)
    })

    it('rejects whitespace-only text', async () => {
      const { status } = await rawAdminPost('/admin/set-lore', { key: `test:edge-${uid()}`, text: '   ', secret: ADMIN_SECRET })
      expect(status).toBe(400)
    })

    it('rejects a wrong secret', async () => {
      const { status } = await rawAdminPost('/admin/set-lore', { key: `test:edge-${uid()}`, text: 'x', secret: 'definitely-wrong-secret' })
      expect(status).toBe(401)
    })

    it('rejects a missing secret', async () => {
      const { status } = await rawAdminPost('/admin/set-lore', { key: `test:edge-${uid()}`, text: 'x' })
      expect(status).toBe(401)
    })
  })

  describe('/admin/delete-lore', () => {
    it('rejects an empty body', async () => {
      const { status } = await rawAdminPost('/admin/delete-lore', { secret: ADMIN_SECRET })
      expect(status).toBe(400)
    })

    it('rejects a null key', async () => {
      const { status } = await rawAdminPost('/admin/delete-lore', { key: null, secret: ADMIN_SECRET })
      expect(status).toBe(400)
    })

    it('rejects an empty string key', async () => {
      const { status } = await rawAdminPost('/admin/delete-lore', { key: '', secret: ADMIN_SECRET })
      expect(status).toBe(400)
    })

    it('rejects a whitespace-only key', async () => {
      const { status } = await rawAdminPost('/admin/delete-lore', { key: '   ', secret: ADMIN_SECRET })
      expect(status).toBe(400)
    })

    it('rejects a numeric key', async () => {
      const { status } = await rawAdminPost('/admin/delete-lore', { key: 42, secret: ADMIN_SECRET })
      expect(status).toBe(400)
    })

    it('rejects a wrong secret', async () => {
      const { status } = await rawAdminPost('/admin/delete-lore', { key: `test:edge-${uid()}`, secret: 'definitely-wrong-secret' })
      expect(status).toBe(401)
    })

    it('rejects a missing secret', async () => {
      const { status } = await rawAdminPost('/admin/delete-lore', { key: `test:edge-${uid()}` })
      expect(status).toBe(401)
    })
  })
})
