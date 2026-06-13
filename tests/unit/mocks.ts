// tests/unit/mocks.ts
// Provides a minimal mock of Hono's Context plus a fake KV store so that both
// kvGet/kvPut (which access c.env.LORE_DB) and c.json() work in unit tests.

import type { Context } from 'hono'
import type { AppBindings } from '../../src/types'

/** Minimal KVNamespace-compatible interface for mocks. */
export interface MockKVStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  list(): Promise<{ keys: { name: string }[] }>
  getWithMetadata(key: string): Promise<{ value: string | null; metadata: Record<string, unknown> | null }>
}

/** Build a fake KV store backed by an in-memory Record. */
export function createMockKV(seed: Record<string, string> = {}): MockKVStore {
  const store: Record<string, string> = { ...seed }
  return {
    get: async (key: string) => store[key] ?? null,
    put: async (key: string, value: string) => { store[key] = value },
    delete: async (key: string) => { delete store[key] },
    list: async () => ({
      keys: Object.keys(store)
        .filter(k => !k.startsWith('_history:') && !k.startsWith('_idx:') && k !== '_changelog')
        .map(name => ({ name })),
    }),
    getWithMetadata: async (key: string) => ({
      value: store[key] ?? null,
      metadata: null,
    }),
  }
}

/**
 * Create a minimal Hono Context that satisfies our tool-handler needs.
 * Cast to the full Context type since we only use `env` and `json()`.
 */
export function createMockContext(
  seed?: Record<string, string>,
): Context<{ Bindings: AppBindings }> {
  const kv = createMockKV(seed)
  return {
    env: { LORE_DB: kv } as unknown as AppBindings,
    json: async (body: unknown, status?: number) =>
      new Response(JSON.stringify(body), {
        status: status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
  } as unknown as Context<{ Bindings: AppBindings }>
}