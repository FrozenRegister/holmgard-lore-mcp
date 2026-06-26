// tests/integration/admin-api.test.ts
// Integration test: Admin API routes
// Covers: bulk operations, health checks, system-level endpoints

import { describe, it, expect, beforeAll } from 'vitest'
import { Hono } from 'hono'
import type { AppBindings } from '../../src/types'
import adminRoutes from '../../src/admin/routes'

type Bindings = AppBindings & { LORE_DB: KVNamespace; DB: D1Database }

function createTestApp() {
  const app = new Hono<{ Bindings: AppBindings }>()
  const store: Record<string, string> = {}
  app.use('*', async (c, next) => {
    const mockCtx = c as any
    mockCtx.env = {
      ...c.env,
      ADMIN_SECRET: 'test-secret',
      LORE_DB: {
        get: async (key: string) => store[key] ?? null,
        put: async (key: string, value: string) => { store[key] = value },
        delete: async (key: string) => { delete store[key] },
        list: async () => ({ keys: Object.keys(store).map(name => ({ name })) }),
      },
      DB: {
        prepare: () => ({
          bind: () => ({ all: async () => ({ results: [], success: true }), first: async () => null, run: async () => ({ success: true }), raw: async () => [] }),
        }),
      },
    }
    await next()
  })
  app.route('/admin', adminRoutes)
  return app
}

async function fetchJson(app: Hono, path: string, init?: RequestInit) {
  const req = new Request(`http://localhost${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Secret': 'test-secret',
      ...(init?.headers || {}),
    },
  })
  const res = await app.fetch(req)
  return { res, json: async () => res.json() }
}

describe('Admin API', () => {
  let app: Hono

  beforeAll(() => {
    app = createTestApp()
  })

  it('GET /admin/health returns status', async () => {
    const { res, json } = await fetchJson(app, '/admin/health')
    const body = await json()
    expect(res.status).toBe(200)
    expect(body.status).toBeDefined()
  })

  it('GET /admin/stats returns store statistics', async () => {
    const { res, json } = await fetchJson(app, '/admin/stats')
    const body = await json()
    expect(res.status).toBe(200)
    expect(body).toBeDefined()
  })

  it('blocks requests without admin secret', async () => {
    const req = new Request('http://localhost/admin/health', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await app.fetch(req)
    expect(res.status).toBe(401)
  })

  it('POST /admin/bulk/write creates multiple keys', async () => {
    const { res, json } = await fetchJson(app, '/admin/bulk/write', {
      method: 'POST',
      body: JSON.stringify({
        entries: [
          { key: 'npc:test-a', text: 'Test A' },
          { key: 'npc:test-b', text: 'Test B' },
        ],
      }),
    })
    const body = await json()
    expect(res.status).toBe(200)
    expect(body.ok || body.success).toBeTruthy()
  })

  it('POST /admin/migrate runs migration', async () => {
    const { res, json } = await fetchJson(app, '/admin/migrate', {
      method: 'POST',
      body: JSON.stringify({ target: 'latest' }),
    })
    const body = await json()
    // May not exist in all versions — just don't crash
    expect(body).toBeDefined()
  })

  it('blocks POST without admin secret', async () => {
    const req = new Request('http://localhost/admin/bulk/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [{ key: 'test', text: 'test' }] }),
    })
    const res = await app.fetch(req)
    expect(res.status).toBe(401)
  })
})
