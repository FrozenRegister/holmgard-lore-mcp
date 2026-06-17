// src/middleware/rate-limit.ts
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, WS_RECONNECT_WINDOW_MS, WS_RECONNECT_LIMIT } from '../constants'

async function notifySlack(webhookUrl: string | undefined, ip: string, windowEndMs: number): Promise<void> {
  if (!webhookUrl) return
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `*WS Reconnect Rate Limit Hit*\nIP \`${ip}\` exceeded ${WS_RECONNECT_LIMIT} WebSocket reconnects/minute. Throttled until ${new Date(windowEndMs).toISOString()}.`,
      }),
    })
  } catch {
    // Best-effort — never block the response for a notification failure
  }
}

// In-memory rate limiter (per-instance; sufficient for a single-worker
// deployment. For multi-instance scale, use Cloudflare Rate Limiting rules.)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

export default async function rateLimitMiddleware(c: any, next: any): Promise<any> {
  const ip = c.req.header('CF-Connecting-IP')
  // Skip rate limiting in local/test environments where CF-Connecting-IP is absent
  if (!ip) return await next()

  const now = Date.now()

  // Prevent unbounded growth on high-traffic workers
  if (rateLimitMap.size > 10000) {
    for (const [key, val] of rateLimitMap) {
      if (val.resetAt < now) rateLimitMap.delete(key)
    }
  }

  let entry = rateLimitMap.get(ip)
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
    rateLimitMap.set(ip, entry)
  }
  entry.count++
  if (entry.count > RATE_LIMIT_MAX) {
    return c.json({ error: 'Rate limit exceeded' }, 429)
  }
  await next()
}

// Separate, tighter rate limit for WebSocket upgrade requests.
// Healthy MCP clients connect once and hold the session; repeated upgrades
// from the same IP indicate a reconnect loop and are throttled here before
// the request ever reaches the Durable Object.
const wsReconnectMap = new Map<string, { count: number; resetAt: number }>()

export function wsReconnectRateLimit(c: any, next: any): Promise<any> {
  const ip = c.req.header('CF-Connecting-IP')
  if (!ip) return next()

  const upgrade = c.req.header('Upgrade') ?? ''
  if (upgrade.toLowerCase() !== 'websocket') return next()

  const now = Date.now()

  if (wsReconnectMap.size > 5000) {
    for (const [key, val] of wsReconnectMap) {
      if (val.resetAt < now) wsReconnectMap.delete(key)
    }
  }

  let entry = wsReconnectMap.get(ip)
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + WS_RECONNECT_WINDOW_MS }
    wsReconnectMap.set(ip, entry)
  }
  entry.count++
  if (entry.count > WS_RECONNECT_LIMIT) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    c.header('Retry-After', String(retryAfter))
    // Notify Slack exactly once per IP per window (on the first excess request)
    if (entry.count === WS_RECONNECT_LIMIT + 1 && c.executionCtx?.waitUntil) {
      c.executionCtx.waitUntil(notifySlack(c.env?.SLACK_WEBHOOK_URL, ip, entry.resetAt))
    }
    return Promise.resolve(c.json({ error: 'Too many reconnect attempts. Back off and retry.' }, 429))
  }
  return next()
}
