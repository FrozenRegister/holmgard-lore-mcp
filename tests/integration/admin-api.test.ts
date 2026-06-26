// tests/integration/admin-api.test.ts
// Integration test: Admin API routes
// Covers: /set-lore, /delete-lore, /set-lore-batch, /delete-lore-batch, /gc

import { describe, it, expect, beforeAll } from 'vitest'
import { Hono } from 'hono'
import type { AppBindings } from '../../src/types'
import adminRoutes from '../../src/admin/routes'
import { createMockKV, createMockD1Database } from '../unit/mocks'

type Bindings = AppBindings & { LORE_DB: KVNamespace; RPG_DB: D1Database }

function createTestApp() {
  const app = new Hono<{ Bindings: Bindings }>()
  const kv = createMockKV()
  const rpgDb = createMockD1Database()

  app.use('*', async (c, next) => {
    const mockCtx = c as any
    mockCtx.env = {
      ...c.env,
      ADMIN_SECRET: 'test-secret',
      LORE_DB: kv,
      RPG_DB: rpgDb,
    }
    await next()
  })
  app.route('/admin', adminRoutes)
  return { app, kv }
}

async function adminPost(app: Hono, path: string, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  const req = new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': 'test-secret',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  })
  const res = await app.fetch(req)
  return { res, json: async () => res.json() }
}

describe('Admin API', () => {
  let app: Hono

  beforeAll(() => {
    ({ app } = createTestApp())
  })

  it('POST /admin/set-lore creates a lore entry', async () => {
    const { res, json } = await adminPost(app, '/admin/set-lore', {
      key: 'npc:admin-test',
      text: 'Admin test entry',
    })
    const body = await json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.version).toBe(1)
  })

  it('POST /admin/delete-lore deletes a lore entry', async () => {
    // Set first
    await adminPost(app, '/admin/set-lore', { key: 'npc:delete-me', text: 'Delete test' })

    const { res, json } = await adminPost(app, '/admin/delete-lore', { key: 'npc:delete-me' })
    const body = await json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
  })

  it('POST /admin/set-lore-batch creates multiple entries', async () => {
    const { res, json } = await adminPost(app, '/admin/set-lore-batch', {
      items: [
        { key: 'npc:batch-1', text: 'Batch 1' },
        { key: 'npc:batch-2', text: 'Batch 2' },
      ],
    })
    const body = await json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.saved).toBe(2)
  })

  it('POST /admin/delete-lore-batch deletes multiple entries', async () => {
    await adminPost(app, '/admin/set-lore-batch', {
      items: [
        { key: 'npc:del-batch-1', text: 'A' },
        { key: 'npc:del-batch-2', text: 'B' },
      ],
    })

    const { res, json } = await adminPost(app, '/admin/delete-lore-batch', {
      keys: ['npc:del-batch-1', 'npc:del-batch-2'],
    })
    const body = await json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
  })

  it('POST /admin/gc runs garbage collection', async () => {
    const { res, json } = await adminPost(app, '/admin/gc', { max_age_days: 30 })
    const body = await json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
  })

  it('blocks requests without admin secret', async () => {
    const req = new Request('http://localhost/admin/set-lore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'test', text: 'test' }),
    })
    const res = await app.fetch(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 for missing key', async () => {
    const { res, json } = await adminPost(app, '/admin/set-lore', { text: 'no key' })
    expect(res.status).toBe(400)
    const body = await json()
    expect(body.error).toBeDefined()
  })
})
