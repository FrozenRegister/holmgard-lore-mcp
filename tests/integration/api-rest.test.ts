// tests/integration/api-rest.test.ts
// Integration test: REST API endpoints (entity reads from D1)
// Covers: GET /api/entities/characters, locations, nations, regions, quests, items

import { describe, it, expect, beforeAll } from 'vitest'

// These tests exercise the entity-reads router directly.
// They import the router and create a minimal Hono app to test against.

import { Hono } from 'hono'
import type { AppBindings } from '../../src/types'
import entityReadsRouter from '../../src/api/entity-reads'
import type { Context } from 'hono'

/**
 * Minimal mock D1Database that returns empty results by default.
 */
class MockD1Database {
  prepare() {
    return {
      bind: () => this,
      all: async () => ({ results: [], success: true }),
      first: async () => null,
      run: async () => ({ success: true }),
      raw: async () => [],
    }
  }
}

function createTestApp() {
  const app = new Hono<{ Bindings: AppBindings }>()
  // Inject a minimal env with mock D1
  app.use('*', async (c, next) => {
    const mockCtx = c as any
    mockCtx.env = {
      ...c.env,
      DB: new MockD1Database() as unknown as D1Database,
      LORE_DB: {
        get: async () => null,
        put: async () => {},
        delete: async () => {},
        list: async () => ({ keys: [] }),
      },
    }
    await next()
  })
  app.route('/api/entities', entityReadsRouter)
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
    it(`GET ${path} returns array of ${label}`, async () => {
      const body = await fetchJson(app, path)
      expect(body).toBeDefined()
      // Each endpoint should return an array (possibly empty with mock DB)
      expect(Array.isArray(body)).toBeTruthy()
    })
  }

  it('returns 404 for unknown entity type', async () => {
    const res = await app.fetch(new Request('http://localhost/api/entities/unknown', { method: 'GET' }))
    expect(res.status).toBe(404)
  })

  it('returns empty array when DB has no data', async () => {
    const body = await fetchJson(app, '/api/entities/characters')
    expect(body).toEqual([])
  })
})
