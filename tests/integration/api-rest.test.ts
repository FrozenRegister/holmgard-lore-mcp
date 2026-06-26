// tests/integration/api-rest.test.ts
// Integration test: REST API endpoints (entity reads from D1/RPG_DB)
// Covers: GET /api/entities/characters, locations, nations, regions, quests, items

import { describe, it, expect, beforeAll } from 'vitest'
import { Hono } from 'hono'
import type { AppBindings } from '../../src/types'
import entityReads from '../../src/api/entity-reads'
import { createMockD1Database } from '../unit/mocks'

type Bindings = AppBindings & { RPG_DB: D1Database }

function createTestApp() {
  const app = new Hono<{ Bindings: Bindings }>()
  const rpgDb = createMockD1Database()

  app.use('*', async (c, next) => {
    const mockCtx = c as any
    mockCtx.env = {
      ...c.env,
      RPG_DB: rpgDb,
      ADMIN_SECRET: 'test-secret',
    }
    await next()
  })
  app.route('/api/entities', entityReads)
  return app
}

async function fetchJson(app: Hono, path: string) {
  const req = new Request(`http://localhost${path}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })
  const res = await app.fetch(req)
  expect(res.status).toBe(200)
  return res.json()
}

describe('REST API endpoints', () => {
  let app: Hono

  beforeAll(() => {
    app = createTestApp()
  })

  const endpoints = [
    { path: '/api/entities/characters', label: 'characters' },
    { path: '/api/entities/locations', label: 'locations' },
    { path: '/api/entities/nations', label: 'nations' },
    { path: '/api/entities/regions', label: 'regions' },
    { path: '/api/entities/quests', label: 'quests' },
    { path: '/api/entities/items', label: 'items' },
  ]

  for (const { path, label } of endpoints) {
    it(`GET ${path} returns ${label}`, async () => {
      const body = await fetchJson(app, path)
      expect(body).toBeDefined()
      // Entity reads return { characters, total } etc.
      expect(body[label] !== undefined || body.total !== undefined).toBeTruthy()
    })
  }

  it('returns empty results when DB has no data', async () => {
    const body = await fetchJson(app, '/api/entities/characters')
    expect(body.characters).toEqual([])
    expect(body.total).toBe(0)
  })

  it('GET /api/entities/characters/:id returns 404 for unknown id', async () => {
    const req = new Request('http://localhost/api/entities/characters/nonexistent', { method: 'GET' })
    const res = await app.fetch(req)
    expect(res.status).toBe(404)
  })
})
