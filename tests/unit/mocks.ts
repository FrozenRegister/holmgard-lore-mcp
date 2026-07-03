// tests/unit/mocks.ts
// Provides a minimal mock of Hono's Context plus fake KV and D1 stores so
// both KV-backed tools and D1-backed RPG handlers work in unit/integration tests.

import type { Context } from 'hono'
import type { AppBindings } from '../../src/types'
import type { RequestIdVariables } from '../../src/middleware/request-id'

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

/** A stub D1Meta that satisfies the type without real metrics. */
const mockD1Meta: D1Meta & Record<string, unknown> = {
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: 0,
  last_row_id: 0,
  changed_db: false,
  changes: 0,
}

/** Minimal D1Database-compatible mock backed by in-memory tables. */
export function createMockD1Database(): D1Database {
  const tables: Record<string, Record<string, unknown>[]> = {}

  function ensureTable(table: string) {
    if (!tables[table]) tables[table] = []
    return tables[table]
  }

  return {
    prepare(sql: string) {
      const insertMatch = sql.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)/i)
      const selectMatch = sql.match(/SELECT\s+.+?\s+FROM\s+(\w+)/i)
      const updateMatch = sql.match(/UPDATE\s+(\w+)\s+SET/i)
      const deleteMatch = sql.match(/DELETE\s+FROM\s+(\w+)/i)
      const createMatch = sql.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/i)
      const tableName = insertMatch?.[1] || selectMatch?.[1] || updateMatch?.[1] || deleteMatch?.[1] || createMatch?.[1] || '_unknown'

      let boundValues: unknown[] = []

      const self = {
        bind(...vals: unknown[]) {
          boundValues = vals
          return self
        },
        async all(): Promise<D1Result<Record<string, unknown>>> {
          const rows = ensureTable(tableName)
          return { results: rows as Record<string, unknown>[], success: true, meta: mockD1Meta }
        },
        async first<T = Record<string, unknown>>(): Promise<T | null> {
          const rows = ensureTable(tableName)
          return (rows[0] as T) ?? null
        },
        async run(): Promise<D1Result<Record<string, unknown>>> {
          if (insertMatch) {
            const row: Record<string, unknown> = {}
            const cols = sql.match(/\(([^)]+)\)/)?.[1]?.split(',').map(c => c.trim()) ?? []
            boundValues.forEach((v, i) => {
              row[cols[i] ?? `col${i}`] = v
            })
            ensureTable(tableName).push(row)
          }
          return { results: [], success: true, meta: mockD1Meta }
        },
        async raw(): Promise<unknown[]> {
          return []
        },
      }
      return self
    },
    async exec(_sql: string): Promise<D1Result<Record<string, unknown>>> {
      return { results: [], success: true, meta: mockD1Meta }
    },
    async batch(_stmts: unknown[]): Promise<D1Result<Record<string, unknown>>[]> {
      return []
    },
    async dump(): Promise<ArrayBuffer> {
      return new ArrayBuffer(0)
    },
  } as unknown as D1Database
}

/**
 * Create a minimal Hono Context that satisfies our tool-handler needs.
 * Cast to the full Context type since we only use `env` and `json()`.
 *
 * @param seed - Optional KV seed data
 * @param includeD1 - If true, also provide mock DB and RPG_DB bindings
 */
export function createMockContext(
  seed?: Record<string, string>,
  includeD1: boolean = false,
): Context<{ Bindings: AppBindings; Variables: RequestIdVariables }> {
  const kv = createMockKV(seed)
  const d1 = includeD1 ? createMockD1Database() : undefined

  const env: Record<string, unknown> = {
    LORE_DB: kv,
  }
  if (includeD1) {
    env.DB = d1
    env.RPG_DB = d1
    env.ADMIN_SECRET = 'test-secret'
    env.MCP_API_KEY = 'test-api-key'
  }

  return {
    env: env as unknown as AppBindings,
    req: {
      header: (name: string) => null,
      json: async () => ({}),
      path: '/mcp',
      method: 'POST',
    },
    json: async (body: unknown, status?: number) =>
      new Response(JSON.stringify(body), {
        status: status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
  } as unknown as Context<{ Bindings: AppBindings; Variables: RequestIdVariables }>
}