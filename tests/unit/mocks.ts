// tests/unit/mocks.ts
// Provides a minimal mock of Hono's Context plus a fake KV store so that both
// kvGet/kvPut (which access c.env.LORE_DB) and c.json() work in unit tests.
// Also provides a mock D1 database (RPG_DB / DB) for RPG handler tests.

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

/** Chainable mock D1 statement */
interface MockD1Statement {
  bind(..._args: unknown[]): MockD1Statement
  first(): Promise<Record<string, unknown> | null>
  all(): Promise<{ results: Record<string, unknown>[]; success: boolean }>
  run(): Promise<{ success: boolean; meta: { changes: number } }>
  raw(): Promise<Record<string, unknown>[]>
}

/**
 * Build a mock D1Database. By default all queries return empty results.
 * Pass seedTables to pre-populate tables with rows keyed by a lookup column.
 * e.g. seedTables: { characters: { rows: [...], lookupCol: 'id' } }
 */
export function createMockD1(
  tables: Record<string, Record<string, unknown>[]> = {},
): Pick<D1Database, 'prepare'> {
  const tableData: Record<string, Record<string, unknown>[]> = JSON.parse(JSON.stringify(tables))

  return {
    prepare(_query: string): MockD1Statement {
      let boundValues: unknown[] = []
      const self: MockD1Statement = {
        bind(...args: unknown[]) {
          boundValues = args
          return self
        },
        async first() {
          // Try to match a lookup: if query contains "WHERE id = ?" and we have that id
          if (boundValues.length === 1) {
            for (const tableName of Object.keys(tableData)) {
              if (_query.includes(tableName)) {
                const rows = tableData[tableName]
                const found = rows.find(r => r.id === boundValues[0])
                if (found) return { ...found }
              }
            }
            // For agent lookup by character_id
            for (const tableName of Object.keys(tableData)) {
              if (_query.includes(tableName) && _query.includes('character_id')) {
                const rows = tableData[tableName]
                const found = rows.find(r => r.character_id === boundValues[0])
                if (found) return { ...found }
              }
            }
          }
          return null
        },
        async all() {
          for (const tableName of Object.keys(tableData)) {
            if (_query.includes(tableName)) {
              return { results: [...tableData[tableName]], success: true }
            }
          }
          return { results: [], success: true }
        },
        async run() {
          return { success: true, meta: { changes: 1 } }
        },
        async raw() {
          return []
        },
      }
      return self
    },
  }
}

/**
 * Create a minimal Hono Context that satisfies our tool-handler needs.
 * Cast to the full Context type since we only use `env` and `json()`.
 *
 * Set options.rpgDb to true to include a mock RPG_DB (for RPG/agent/character tests).
 * Set options.tables to pre-load mock D1 tables.
 */
export function createMockContext(
  seed?: Record<string, string>,
  options?: { rpgDb?: boolean; tables?: Record<string, Record<string, unknown>[]> },
): Context<{ Bindings: AppBindings }> {
  const kv = createMockKV(seed)
  const env: Record<string, unknown> = { LORE_DB: kv }

  if (options?.rpgDb) {
    const mockD1 = createMockD1(options.tables ?? {})
    env.RPG_DB = mockD1
    env.DB = mockD1
  }

  return {
    env: env as unknown as AppBindings,
    json: async (body: unknown, status?: number) =>
      new Response(JSON.stringify(body), {
        status: status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
  } as unknown as Context<{ Bindings: AppBindings }>
}
