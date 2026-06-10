// src/do/context-adapter.ts
// Builds a minimal synthetic Hono context for calling legacy KV tool handlers
// from inside the McpAgent DO, where no real Hono request context exists.
// Handlers only access c.env, c.req.header(), and c.json() — nothing else.
import type { AppBindings, DOEnv } from '../types'

export function makeSyntheticContext(env: DOEnv | AppBindings): {
  env: AppBindings
  req: { header: (name: string) => string | null }
  json: (data: unknown, status?: number) => Response
} {
  return {
    env,
    req: { header: () => null },
    json: (data: unknown) =>
      new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' },
      }),
  }
}
