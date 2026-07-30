// src/do/context-adapter.ts
// Builds a minimal synthetic Hono context for calling legacy KV tool handlers
// from inside the McpAgent DO, where no real Hono request context exists.
// Handlers only access c.env, c.req.header(), and c.json() — nothing else.
import type { AppBindings, DOEnv } from '../types'

// `headers` is the originating Streamable HTTP request's headers, threaded
// through from `getCurrentAgent().request` at the DO's tools/call boundary
// (see HolmgardMCP.ts) — real values when the caller supplies them, `null`
// for anything genuinely absent (matching Hono's `c.req.header()` contract),
// rather than the previous unconditional `null` for every header (#620).
export function makeSyntheticContext(
  env: DOEnv | AppBindings,
  headers?: Headers,
): {
  env: AppBindings
  req: { header: (name: string) => string | null }
  json: (data: unknown, status?: number) => Response
} {
  return {
    env,
    req: { header: (name: string) => headers?.get(name) ?? null },
    json: (data: unknown) =>
      new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' },
      }),
  }
}
