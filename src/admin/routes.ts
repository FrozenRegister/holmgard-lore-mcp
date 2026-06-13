// src/admin/routes.ts
import { Hono } from 'hono'
import type { AppBindings } from '../types'
import { kvGet, kvPut, kvDelete, getKV, loreDB } from '../lib/kv'
import { parseKvEntry } from '../lib/lore'
import { pushHistory, appendChangelog } from '../lib/history'
import { updateIndexes } from '../lib/indexes'
import { migrateCharacterFromKV } from '../rpg/utils/kv-to-d1'
import { parseId } from '../lib/parse-id'

// ── Shared helpers ───────────────────────────────────────────────────────────

function safeErrorMessage(e: unknown, env?: AppBindings): string {
  const isDev = env && (env as any).ENVIRONMENT === 'development'
  if (isDev && e instanceof Error) return e.message
  return 'Internal server error'
}

function extractKey(body: Record<string, unknown>): string | null {
  const raw = body.key
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return null
  return trimmed
}

function extractText(body: Record<string, unknown>): string | null {
  const raw = body.text
  if (typeof raw !== 'string') return null
  const trimmed = (raw as string).trim()
  if (!trimmed) return null
  return trimmed
}

function extractSecret(body: Record<string, unknown>): string | null {
  const raw = body.secret
  if (typeof raw !== 'string') return null
  return raw.trim() || null
}

/**
 * Parse a strictly positive integer from a query param with clamping.
 * - Non-numeric / missing → returns `defaultVal`
 * - Zero → returns `defaultVal`
 * - Values above `max` → clamped to `max`
 * Useful for `?limit=N`, `?max_age=N`, etc.
 */
function extractPositiveInt(
  value: string | undefined | null,
  defaultVal: number,
  max = 1000,
): number {
  if (value === undefined || value === null) return defaultVal
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1) return defaultVal
  return Math.min(n, max)
}

function checkSecret(c: any, body: Record<string, unknown>): boolean {
  const ADMIN_SECRET = c.env.ADMIN_SECRET
  if (!ADMIN_SECRET) return true // no secret configured → open access
  const fromHeader = c.req.header('X-Admin-Secret')
  const fromApiKey = c.req.header('X-Api-Key')
  const fromBody = extractSecret(body)
  return fromHeader === ADMIN_SECRET || fromApiKey === ADMIN_SECRET || fromBody === ADMIN_SECRET
}

const adminRoutes = new Hono<{ Bindings: AppBindings }>()

// ── POST /admin/set-lore ─────────────────────────────────────────────────────

adminRoutes.post('/set-lore', async (c) => {
  try {
    const body = await c.req.json() as Record<string, unknown>
    if (!checkSecret(c, body)) return c.json({ error: 'Unauthorized' }, 401)
    const key = extractKey(body)
    if (!key) return c.json({ error: 'Missing or invalid key' }, 400)
    const text = extractText(body)
    if (!text) return c.json({ error: 'Missing or invalid text' }, 400)
    await kvPut(c, key, text)

    // Update index entries so the new key is searchable.
    try { await updateIndexes(c, key, text) } catch { /* non-fatal */ }

    try { await pushHistory(c, key, text) } catch { /* non-fatal */ }
    try { await appendChangelog(c, key, text) } catch { /* non-fatal */ }

    return c.json({ ok: true, key })
  } catch (e) {
    console.error('Error in /set-lore:', e)
    return c.json({ error: safeErrorMessage(e, c.env) }, 500)
  }
})

// ── POST /admin/delete-lore ──────────────────────────────────────────────────

adminRoutes.post('/delete-lore', async (c) => {
  try {
    const body = await c.req.json() as Record<string, unknown>
    if (!checkSecret(c, body)) return c.json({ error: 'Unauthorized' }, 401)
    const key = extractKey(body)
    if (!key) return c.json({ error: 'Missing or invalid key' }, 400)
    const deleted = await kvDelete(c, key)
    if (!deleted) return c.json({ error: 'Key not found' }, 404)
    return c.json({ ok: true, key })
  } catch (e) {
    console.error('Error in /delete-lore:', e)
    return c.json({ error: safeErrorMessage(e, c.env) }, 500)
  }
})

// ── POST /admin/gc ───────────────────────────────────────────────────────────

adminRoutes.post('/gc', async (c) => {
  try {
    const body = await c.req.json() as Record<string, unknown>
    if (!checkSecret(c, body)) return c.json({ error: 'Unauthorized' }, 401)

    let limit = 50
    let maxAgeMs = 7 * 24 * 60 * 60 * 1000 // 7 days default

    if (body.limit) {
      const raw = Number(body.limit)
      if (Number.isFinite(raw) && raw > 0) limit = Math.min(Math.floor(raw), 500)
    }
    if (body.max_age_ms) {
      const raw = Number(body.max_age_ms)
      if (Number.isFinite(raw) && raw > 0) maxAgeMs = raw
    }

    const kv = getKV(c)
    if (!kv) return c.json({ error: 'KV unavailable' }, 500)

    const now = Date.now()
    const cutoff = now - maxAgeMs

    const keys: string[] = []
    let cursor: string | undefined
    do {
      const page = await kv.list({ limit: 200, cursor })
      for (const item of page.keys) {
        if (item.name.startsWith('_')) continue
        if (item.metadata && typeof item.metadata === 'object' && 'updated_at' in item.metadata) {
          const ts = Number((item.metadata as any).updated_at)
          if (ts < cutoff) keys.push(item.name)
        }
      }
      cursor = page.list_complete ? undefined : page.cursor
    } while (cursor)

    const toDelete = keys.slice(0, limit)
    for (const k of toDelete) await kvDelete(c, k, { quiet: true })

    return c.json({ ok: true, deleted: toDelete.length, scanned: keys.length })
  } catch (e) {
    console.error('Error in /gc:', e)
    return c.json({ error: safeErrorMessage(e, c.env) }, 500)
  }
})

// ── POST /admin/migrate-character ────────────────────────────────────────────

adminRoutes.post('/migrate-character', async (c) => {
  try {
    const body = await c.req.json() as Record<string, unknown>
    if (!checkSecret(c, body)) return c.json({ error: 'Unauthorized' }, 401)

    const key = extractKey(body)
    if (!key) return c.json({ error: 'Missing or invalid key' }, 400)

    const result = await migrateCharacterFromKV(c, key)
    if (!result.migrated) return c.json({ error: result.error ?? 'Migration failed' }, 400)
    return c.json({ ok: true, key, d1Id: result.d1Id })
  } catch (e) {
    console.error('Error in /migrate-character:', e)
    return c.json({ error: safeErrorMessage(e, c.env) }, 500)
  }
})

// ── GET /admin/get-lore ──────────────────────────────────────────────────────

adminRoutes.get('/get-lore', async (c) => {
  try {
    const key = c.req.query('key')?.trim().toLowerCase()
    if (!key) return c.json({ error: 'Missing key query parameter' }, 400)

    const raw = await kvGet(c, key)
    if (!raw) return c.json({ error: 'Not found' }, 404)

    const { text, meta } = parseKvEntry(raw)
    return c.json({ key, text, meta })
  } catch (e) {
    console.error('Error in /get-lore:', e)
    return c.json({ error: safeErrorMessage(e, c.env) }, 500)
  }
})
