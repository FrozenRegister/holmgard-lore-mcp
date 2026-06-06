// src/middleware/rate-limit.ts
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX } from '../constants'

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
