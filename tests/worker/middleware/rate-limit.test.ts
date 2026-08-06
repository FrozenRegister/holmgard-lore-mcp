import { describe, it, expect, vi } from 'vitest'
import { wsReconnectRateLimit } from '@/middleware/rate-limit'
import rateLimitMiddleware from '@/middleware/rate-limit'
import { RATE_LIMIT_MAX, WS_RECONNECT_LIMIT } from '@/constants'

describe('rateLimitMiddleware', () => {
  const makeCtx = (overrides: Record<string, unknown> = {}) => {
    const header = (key: string) => {
      if (key === 'CF-Connecting-IP') return '192.168.1.1'
      return undefined
    }
    return {
      req: { header },
      env: {},
      json: (body: unknown, status?: number) => ({ body, status, headers: {} }),
      header,
      ...overrides,
    } as any
  }

  it('passes through requests when CF-Connecting-IP is missing', async () => {
    const ctx = makeCtx({ req: { header: () => undefined } })
    const result = await rateLimitMiddleware(ctx, async () => 'passed')
    expect(result).toBe('passed')
  })

  it('allows requests under the rate limit', async () => {
    const ctx = makeCtx()
    const result = await rateLimitMiddleware(ctx, async () => 'ok')
    // Middleware calls next() but doesn't return its value when allowed
    expect(result).toBeUndefined()
  })

  it('blocks requests when rate limit is exceeded', async () => {
    const ctx = makeCtx({
      req: {
        header: (key: string) => (key === 'CF-Connecting-IP' ? '172.16.0.1' : undefined),
      },
    })

    // Make requests up to and past the limit
    for (let i = 0; i <= RATE_LIMIT_MAX; i++) {
      const result = await rateLimitMiddleware(ctx, async () => 'ok')
      if (i < RATE_LIMIT_MAX) {
        // Middleware calls next() but doesn't return its value when allowed
        expect(result).toBeUndefined()
      } else {
        // Last request should be blocked
        expect(result.status).toBe(429)
        expect(result.body.error).toBe('Rate limit exceeded')
      }
    }
  })

  it('resets the counter after the time window expires', async () => {
    const originalDateNow = Date.now
    let mockNow = 1000

    vi.spyOn(Date, 'now').mockImplementation(() => mockNow)

    const ctx = makeCtx({
      req: {
        header: (key: string) => (key === 'CF-Connecting-IP' ? '10.20.30.40' : undefined),
      },
    })

    // First request at time 1000
    let result = await rateLimitMiddleware(ctx, async () => 'ok')
    expect(result).toBeUndefined()

    // Advance time past the window
    mockNow = 1000 + 60_001 // RATE_LIMIT_WINDOW_MS is 60_000

    // Next request should be allowed (counter reset)
    result = await rateLimitMiddleware(ctx, async () => 'ok')
    expect(result).toBeUndefined()

    Date.now = originalDateNow
  })

  it('maintains separate counters for different IPs', async () => {
    const ip1ctx = makeCtx({
      req: {
        header: (key: string) => (key === 'CF-Connecting-IP' ? '10.1.1.1' : undefined),
      },
    })
    const ip2ctx = makeCtx({
      req: {
        header: (key: string) => (key === 'CF-Connecting-IP' ? '10.2.2.2' : undefined),
      },
    })

    // Both IPs make requests
    const r1 = await rateLimitMiddleware(ip1ctx, async () => 'ok1')
    const r2 = await rateLimitMiddleware(ip2ctx, async () => 'ok2')
    // Middleware calls next() but doesn't return its value when allowed
    expect(r1).toBeUndefined()
    expect(r2).toBeUndefined()
  })

  it('cleans up expired entries once the map grows past 10000 entries', async () => {
    const originalDateNow = Date.now
    let mockNow = 2000
    vi.spyOn(Date, 'now').mockImplementation(() => mockNow)

    // Fill the map past the 10000-entry cleanup threshold with already-expired
    // entries, all under one shared window so the sweep has real work to do.
    for (let i = 0; i < 10001; i++) {
      const ctx = makeCtx({
        req: {
          header: (key: string) => (key === 'CF-Connecting-IP' ? `10.99.${Math.floor(i / 255)}.${i % 255}` : undefined),
        },
      })
      await rateLimitMiddleware(ctx, async () => 'ok')
    }

    // Advance time so every entry above is now expired, then push size over
    // 10000 again with a fresh IP — this request is the one that observes
    // `rateLimitMap.size > 10000` as true and runs the sweep.
    mockNow += 70_000
    const triggerCtx = makeCtx({
      req: { header: (key: string) => (key === 'CF-Connecting-IP' ? '10.99.255.255' : undefined) },
    })
    const result = await rateLimitMiddleware(triggerCtx, async () => 'ok')
    expect(result).toBeUndefined()

    Date.now = originalDateNow
  })
})

describe('wsReconnectRateLimit', () => {
  const makeCtx = (overrides: Record<string, unknown> = {}) => {
    const header = (key: string) => {
      if (key === 'CF-Connecting-IP') return '1.2.3.4'
      if (key === 'Upgrade') return 'websocket'
      return undefined
    }
    return {
      req: { header },
      env: {},
      executionCtx: { waitUntil: async () => {} },
      json: (body: unknown, status?: number) => ({ body, status, headers: {} }),
      header,
      ...overrides,
    } as any
  }

  it('passes through non-websocket requests', async () => {
    const ctx = makeCtx({
      req: { header: (key: string) => (key === 'Upgrade' ? undefined : '1.2.3.4') },
    })
    const result = await wsReconnectRateLimit(ctx, async () => 'ok')
    expect(result).toBe('ok')
  })

  it('passes through when CF-Connecting-IP is missing', async () => {
    const ctx = makeCtx({ req: { header: () => undefined } })
    const result = await wsReconnectRateLimit(ctx, async () => 'ok')
    expect(result).toBe('ok')
  })

  it('allows requests under the reconnect limit', async () => {
    const ctx = makeCtx({
      req: { header: (key: string) => (key === 'CF-Connecting-IP' ? '10.0.0.1' : 'websocket') },
    })
    const result = await wsReconnectRateLimit(ctx, async () => 'ok')
    expect(result).toBe('ok')
  })

  it('blocks reconnects over the limit and returns 429', async () => {
    const header = (key: string) => (key === 'CF-Connecting-IP' ? '10.0.0.2' : 'websocket')
    const ctx = {
      req: { header },
      env: { SLACK_WEBHOOK_URL: undefined },
      executionCtx: { waitUntil: async () => {} },
      json: (body: unknown, status?: number) => ({ body, status, headers: {} }),
      header,
    } as any

    let result: any
    for (let i = 0; i <= WS_RECONNECT_LIMIT; i++) {
      result = await wsReconnectRateLimit(ctx, async () => 'ok')
    }

    expect(result.status).toBe(429)
    expect(result.body.error).toContain('Too many reconnect attempts')
  })

  it('handles Upgrade header case-insensitively', async () => {
    const testCases = ['WEBSOCKET', 'WebSocket', 'websocket', 'WeBsOcKeT']

    for (const upgradeValue of testCases) {
      const ctx = makeCtx({
        req: {
          header: (key: string) => {
            if (key === 'CF-Connecting-IP') return `192.168.1.${testCases.indexOf(upgradeValue)}`
            if (key === 'Upgrade') return upgradeValue
            return undefined
          },
        },
      })
      const result = await wsReconnectRateLimit(ctx, async () => 'ok')
      expect(result).toBe('ok')
    }
  })

  it('ignores requests with Upgrade header other than websocket', async () => {
    const ctx = makeCtx({
      req: {
        header: (key: string) => {
          if (key === 'CF-Connecting-IP') return '11.22.33.44'
          if (key === 'Upgrade') return 'h2c'
          return undefined
        },
      },
    })
    const result = await wsReconnectRateLimit(ctx, async () => 'ok')
    expect(result).toBe('ok')
  })

  it('sets Retry-After header when rate limit is hit', async () => {
    const header = (key: string) => (key === 'CF-Connecting-IP' ? '10.0.0.3' : 'websocket')
    const ctx = {
      req: { header },
      env: { SLACK_WEBHOOK_URL: undefined },
      executionCtx: { waitUntil: async () => {} },
      json: (body: unknown, status?: number) => ({ body, status, headers: {} }),
      header: vi.fn(),
    } as any

    // Make requests up to the limit
    for (let i = 0; i <= WS_RECONNECT_LIMIT; i++) {
      await wsReconnectRateLimit(ctx, async () => 'ok')
    }

    // Verify header was called with Retry-After
    expect(ctx.header).toHaveBeenCalledWith('Retry-After', expect.stringMatching(/^\d+$/))
  })

  it('notifies Slack exactly once per IP per window', async () => {
    const waitUntilSpy = vi.fn()
    const header = (key: string) => (key === 'CF-Connecting-IP' ? '10.0.0.4' : 'websocket')
    const ctx = {
      req: { header },
      env: { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/test' },
      executionCtx: { waitUntil: waitUntilSpy },
      json: (body: unknown, status?: number) => ({ body, status, headers: {} }),
      header: vi.fn(),
    } as any

    // Make requests up to the limit
    for (let i = 0; i <= WS_RECONNECT_LIMIT; i++) {
      await wsReconnectRateLimit(ctx, async () => 'ok')
    }

    // Should be called exactly once (on the first excess request)
    expect(waitUntilSpy).toHaveBeenCalledTimes(1)
  })

  it('does not notify Slack on subsequent excess requests in the same window', async () => {
    const waitUntilSpy = vi.fn()
    const header = (key: string) => (key === 'CF-Connecting-IP' ? '10.0.0.5' : 'websocket')
    const ctx = {
      req: { header },
      env: { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/test' },
      executionCtx: { waitUntil: waitUntilSpy },
      json: (body: unknown, status?: number) => ({ body, status, headers: {} }),
      header: vi.fn(),
    } as any

    // Make requests well past the limit
    for (let i = 0; i < WS_RECONNECT_LIMIT + 5; i++) {
      await wsReconnectRateLimit(ctx, async () => 'ok')
    }

    // Should only be called once (on the first excess request at count === WS_RECONNECT_LIMIT + 1)
    expect(waitUntilSpy).toHaveBeenCalledTimes(1)
  })

  it('does not notify Slack when executionCtx.waitUntil is unavailable', async () => {
    const waitUntilSpy = vi.fn()
    const header = (key: string) => (key === 'CF-Connecting-IP' ? '10.0.0.6' : 'websocket')
    const ctx = {
      req: { header },
      env: { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/test' },
      executionCtx: { waitUntil: undefined },
      json: (body: unknown, status?: number) => ({ body, status, headers: {} }),
      header: vi.fn(),
    } as any

    // Make requests past the limit
    for (let i = 0; i <= WS_RECONNECT_LIMIT; i++) {
      await wsReconnectRateLimit(ctx, async () => 'ok')
    }

    // Should not have called waitUntil
    expect(waitUntilSpy).not.toHaveBeenCalled()
  })

  it('resets the counter after the time window expires', async () => {
    const originalDateNow = Date.now
    let mockNow = 2000

    vi.spyOn(Date, 'now').mockImplementation(() => mockNow)

    const ctx = makeCtx({
      req: {
        header: (key: string) => (key === 'CF-Connecting-IP' ? '10.40.50.60' : 'websocket'),
      },
    })

    // First request at time 2000
    let result = await wsReconnectRateLimit(ctx, async () => 'ok')
    expect(result).toBe('ok')

    // Advance time past the window
    mockNow = 2000 + 60_001 // WS_RECONNECT_WINDOW_MS is 60_000

    // Next request should be allowed (counter reset)
    result = await wsReconnectRateLimit(ctx, async () => 'ok')
    expect(result).toBe('ok')

    Date.now = originalDateNow
  })

  it('handles entry creation with proper initial state', async () => {
    const ctx = makeCtx({
      req: {
        header: (key: string) => {
          if (key === 'CF-Connecting-IP') return '10.99.99.99'
          if (key === 'Upgrade') return 'websocket'
          return undefined
        },
      },
    })

    // First call should create entry with count 1
    const result = await wsReconnectRateLimit(ctx, async () => 'first')
    expect(result).toBe('first')

    // Second call should increment the count
    const result2 = await wsReconnectRateLimit(ctx, async () => 'second')
    expect(result2).toBe('second')
  })

  it('cleans up expired entries once the map grows past 5000 entries', async () => {
    const originalDateNow = Date.now
    let mockNow = 3000
    vi.spyOn(Date, 'now').mockImplementation(() => mockNow)

    // Fill the map past the 5000-entry cleanup threshold with already-expired
    // entries, all under one shared window so the sweep has real work to do.
    for (let i = 0; i < 5001; i++) {
      const ctx = makeCtx({
        req: {
          header: (key: string) => {
            if (key === 'CF-Connecting-IP') return `10.88.${Math.floor(i / 255)}.${i % 255}`
            if (key === 'Upgrade') return 'websocket'
            return undefined
          },
        },
      })
      await wsReconnectRateLimit(ctx, async () => 'ok')
    }

    // Advance time so every entry above is now expired, then push size over
    // 5000 again with a fresh IP — this request is the one that observes
    // `wsReconnectMap.size > 5000` as true and runs the sweep.
    mockNow += 70_000
    const triggerCtx = makeCtx({
      req: {
        header: (key: string) => (key === 'CF-Connecting-IP' ? '10.88.255.255' : 'websocket'),
      },
    })
    const result = await wsReconnectRateLimit(triggerCtx, async () => 'ok')
    expect(result).toBe('ok')

    Date.now = originalDateNow
  })

  it('maintains separate counters for different IPs', async () => {
    const ip1header = (key: string) =>
      key === 'CF-Connecting-IP' ? '10.71.71.71' : key === 'Upgrade' ? 'websocket' : undefined
    const ip2header = (key: string) =>
      key === 'CF-Connecting-IP' ? '10.72.72.72' : key === 'Upgrade' ? 'websocket' : undefined

    const ctx1 = {
      req: { header: ip1header },
      env: {},
      executionCtx: { waitUntil: async () => {} },
      json: (body: unknown, status?: number) => ({ body, status, headers: {} }),
      header: ip1header,
    } as any

    const ctx2 = {
      req: { header: ip2header },
      env: {},
      executionCtx: { waitUntil: async () => {} },
      json: (body: unknown, status?: number) => ({ body, status, headers: {} }),
      header: ip2header,
    } as any

    // Both IPs make requests
    const r1 = await wsReconnectRateLimit(ctx1, async () => 'ok1')
    const r2 = await wsReconnectRateLimit(ctx2, async () => 'ok2')
    expect(r1).toBe('ok1')
    expect(r2).toBe('ok2')
  })

  it('returns Promise.resolve for allowed requests', async () => {
    const ctx = makeCtx({
      req: { header: (key: string) => (key === 'CF-Connecting-IP' ? '10.80.80.80' : 'websocket') },
    })
    const result = await wsReconnectRateLimit(ctx, async () => 'next-called')
    expect(result).toBe('next-called')
  })
})
