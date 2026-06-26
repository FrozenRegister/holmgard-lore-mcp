// tests/integration/api-rest.test.ts
// Integration test: REST API entity-reads endpoints (GET /api/entities/...)

import { describe, it, expect, beforeAll } from 'vitest'
import { Hono } from 'hono'
import type { AppBindings } from '../../src/types'
import entityReads from '../../src/api/entity-reads'
import { createMockD1 } from '../unit/mocks'

function createTestApp() {
  const app = new Hono<{ Bindings: AppBindings }>()
  const mockDb = createMockD1()
  app.use('*', async (c, next) => {
    const mc = c as any
    mc.env = { ...c.env, RPG_DB: mockDb, ADMIN_SECRET: 'test-admin-secret' }
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
    { path: '/api/entities/characters', label: 'characters', key: 'characters' },
    { path: '/api/entities/locations', label: 'locations', key: 'locations' },
    { path: '/api/entities/nations', label: 'nations', key: 'nations' },
    { path: '/api/entities/regions', label: 'regions', key: 'regions' },
    { path: '/api/entities/quests', label: 'quests', key: 'quests' },
    { path: '/api/entities/items', label: 'items', key: 'items' },
  ]

  for (const { path, label } of endpoints) {
    it(`GET ${path} returns ${label} list`, async () => {
      const body = await fetchJson(app, path)
      expect(body).toBeDefined()
      const resultKey = Object.keys(body).find(k => k !== 'total' && k !== 'error')
      expect(resultKey).toBeDefined()
      expect(Array.isArray(body[resultKey!])).toBeTruthy()
    })
  }

  it('returns 404 for unknown entity type', async () => {
    const res = await app.fetch(new Request('http://localhost/api/entities/unknown', { method: 'GET' }))
    expect(res.status).toBe(404)
  })

  it('returns empty array when DB has no data', async () => {
    const body = await fetchJson(app, '/api/entities/characters')
    expect(body.characters).toEqual([])
    expect(body.total).toBe(0)
  })
})
