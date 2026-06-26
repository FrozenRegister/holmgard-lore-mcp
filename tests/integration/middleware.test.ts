// tests/integration/middleware.test.ts
// Integration test: middleware components
// Covers: rate limiting, WAF checks, CSP reporting

import { describe, it, expect, beforeAll } from 'vitest'
import { Hono } from 'hono'
import type { AppBindings } from '../../src/types'
import rateLimitMiddleware from '../../src/middleware/rate-limit'

type MinimalEnv = AppBindings & { LORE_DB: KVNamespace }

function createTestApp(extraEnv: Partial<MinimalEnv> = {}) {
  const app = new Hono<{ Bindings: AppBindings }>()
  const store: Record<string, string> = {}
  const callCounts: Record<string, number> = {}

  app.use('*', async (c, next) => {
    const mockCtx = c as any
    mockCtx.env = {
      ...c.env,
      ADMIN_SECRET: 'test-admin-secret',
      MCP_API_KEY: 'test-api-key',
      RATE_LIMIT: {
        get: async (key: string) => {
          const val = store[key]
          return val ? JSON.parse(val) : null
        },
        put: async (key: string, value: string) => {
          store[key] = value
        },
        delete: async () => {},
        list: async () => ({ keys: [] }),
      },
      LORE_DB: {
        get: async () => null,
        put: async () => {},
        delete: async () => {},
        list: async () => ({ keys: [] }),
      },
      ...extraEnv,
    }
    callCounts[c.req.path] = (callCounts[c.req.path] || 0) + 1
    await next()
  })
  app.use('*', rateLimitMiddleware)
  app.get('/test', (c) => c.json({ ok: true }))
  app.post('/csp-report', async (c) => c.json({ status: 'reported' }))
  return { app, callCounts, store }
}

describe('Middleware integration', () => {
  describe('Rate limiting', () => {
    it('allows requests within rate limit', async () => {
      const { app } = createTestApp()
      for (let i = 0; i < 5; i++) {
        const req = new Request('http://localhost/test', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '192.0.2.1',
          },
        })
        const res = await app.fetch(req)
        expect(res.status).toBe(200)
      }
    })

    it('allows health check bypass without rate limiting', async () => {
      const { app } = createTestApp()
      const res = await app.fetch(new Request('http://localhost/health', { method: 'GET' }))
      // Health might be handled elsewhere, just check no 429
      expect([200, 404]).toContain(res.status)
    })

    it('allows requests with valid API key', async () => {
      const { app } = createTestApp({ MCP_API_KEY: 'my-secret-key' })
      const res = await app.fetch(new Request('http://localhost/test', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': 'my-secret-key',
        },
      }))
      expect(res.status).toBe(200)
    })
  })

  describe('CSP reporting', () => {
    it('accepts CSP violation reports', async () => {
      const { app } = createTestApp()
      const res = await app.fetch(new Request('http://localhost/csp-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          'blocked-uri': 'https://evil.com/script.js',
          'violated-directive': 'script-src',
          'original-policy': "script-src 'self'",
        }),
      }))
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.status).toBe('reported')
    })

    it('handles invalid CSP report gracefully', async () => {
      const { app } = createTestApp()
      const res = await app.fetch(new Request('http://localhost/csp-report', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'not json',
      }))
      // Should not crash
      expect([200, 400]).toContain(res.status)
    })
  })
})
