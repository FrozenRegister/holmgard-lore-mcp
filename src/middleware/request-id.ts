// src/middleware/request-id.ts
// Generates (or accepts) a per-request correlation ID so a specific error can be
// traced from a user report back to a specific log line — see issue #23.
import type { MiddlewareHandler } from 'hono'

export type RequestIdVariables = { requestId: string }

export const requestIdMiddleware: MiddlewareHandler<{ Variables: RequestIdVariables }> = async (c, next) => {
  const requestId = c.req.header('X-Request-Id') ?? crypto.randomUUID()
  c.set('requestId', requestId)
  c.header('X-Request-Id', requestId)
  await next()
}
