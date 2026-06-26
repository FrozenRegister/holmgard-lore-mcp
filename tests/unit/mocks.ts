// tests/unit/mocks.ts
// Provides a minimal mock of Hono's Context plus a fake KV store so that both
// kvGet/kvPut (which access c.env.LORE_DB) and c.json() work in unit tests.
// Also provides a mock D1 database for RPG/agent/character handlers.

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
 * Build a minimal mock D1Database that stores rows in memory.
 * Supports .prepare(...).bind(...).all() / .first() / .run() chains.
 */
export function createMockD1(): any {
  const tables: Record<string, Record<string, unknown>[]> = {}

  const chain = {
    all: async () => ({ results: tables._lastResults ?? [], success: true }),
    first: async () => (tables._lastResults?.[0] ?? null),
    run: async () => {
      // Minimal INSERT simulation: track by table name stored on the chain
      return { success: true }
    },
    bind: function (..._args: unknown[]) { return this },
  }

  return {
    prepare(_sql: string) {
      // Extract table name for minimal simulation
      const match = _sql.match(/(?:FROM|INTO|UPDATE)\s+(\w+)/i)
      tables._lastTable = match?.[1] ?? 'unknown'
      tables._lastResults = tables[tables._lastTable] ?? []
      return chain
    },
    _tables: tables,
    _seed(table: string, rows: Record<string, unknown>[]) {
      tables[table] = rows
    },
  }
}

/**
 * Create a minimal Hono Context that satisfies our tool-handler needs.
 * Cast to the full Context type since we only use `env` and `json()`.
 */
export function createMockContext(
  seed?: Record<string, string>,
  opts?: { d1Seeds?: Record<string, Record<string, unknown>[]> },
): Context<{ Bindings: AppBindings }> {
  const kv = createMockKV(seed)
  const d1 = createMockD1()
  if (opts?.d1Seeds) {
    for (const [table, rows] of Object.entries(opts.d1Seeds)) {
      d1._seed(table, rows)
    }
  }
  return {
    env: {
      LORE_DB: kv,
      DB: d1,
      RPG_DB: d1,
    } as unknown as AppBindings,
    json: async (body: unknown, status?: number) =>
      new Response(JSON.stringify(body), {
        status: status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
  } as unknown as Context<{ Bindings: AppBindings }>
}
