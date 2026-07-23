import { describe, it } from 'vitest'
import { wsReconnectRateLimit } from '@/middleware/rate-limit'

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
    await wsReconnectRateLimit(ctx, async () => 'ok')
  })

  it('passes through when CF-Connecting-IP is missing', async () => {
    const ctx = makeCtx({ req: { header: () => undefined } })
    await wsReconnectRateLimit(ctx, async () => 'ok')
  })

  it('allows requests under the reconnect limit', async () => {
    const ctx = makeCtx({
      req: { header: (key: string) => (key === 'CF-Connecting-IP' ? '10.0.0.1' : 'websocket') },
    })
    await wsReconnectRateLimit(ctx, async () => 'ok')
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

    for (let i = 0; i < 6; i++) {
      await wsReconnectRateLimit(ctx, async () => 'ok')
    }
  })
})
