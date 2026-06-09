// src/admin/routes.ts
import { Hono } from 'hono'
import type { AppBindings } from '../types'
import { kvGet, kvPut, kvDelete, getKV, loreDB } from '../lib/kv'
import { parseKvEntry } from '../lib/lore'
import { pushHistory, appendChangelog } from '../lib/history'
import { updateIndexes } from '../lib/indexes'

const admin = new Hono<{ Bindings: AppBindings }>()

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Extract and validate a non-empty key from a JSON body. Returns null on failure. */
function extractKey(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const k = (body as Record<string, unknown>).key
  if (typeof k !== 'string' || !k.trim()) return null
  return k.trim().toLowerCase()
}

/** Extract optional text from body. Returns empty string if missing or whitespace-only. */
function extractText(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const t = (body as Record<string, unknown>).text
  return typeof t === 'string' ? t.trim() : ''
}

/** Resolve admin secret from header or body. Returns the secret string or null. */
function extractSecret(body: unknown, headerSecret: string | null): string | null {
  const bodySecret =
    body && typeof body === 'object'
      ? ((body as Record<string, unknown>).secret ?? '').toString()
      : ''
  return headerSecret ?? bodySecret ?? null
}

/** Verify the admin secret from request context. Returns true if authorized. */
async function checkSecret(c: any, body: unknown): Promise<boolean> {
  const ADMIN_SECRET: string | undefined = c.env?.ADMIN_SECRET
  if (!ADMIN_SECRET) return false

  const headerSecret: string | null =
    c.req.header('X-Api-Key') ?? c.req.header('X-Admin-Secret') ?? null
  const secret = extractSecret(body, headerSecret)

  return secret === ADMIN_SECRET
}

// ── Routes ──────────────────────────────────────────────────────────────────

admin.post('/set-lore', async (c) => {
  try {
    const body = await c.req.json()
    const key = extractKey(body)
    const text = extractText(body)

    if (!key || !text) {
      return c.json({ ok: false, error: 'missing key or text' }, 400)
    }

    if (!(await checkSecret(c, body))) {
      return c.json({ ok: false, error: 'unauthorized' }, 401)
    }

    const existingRaw = await kvGet(c, key)
    const existingMeta = existingRaw ? parseKvEntry(existingRaw).meta : {}

    if (existingRaw) await pushHistory(c, key, existingRaw)

    const now = new Date().toISOString()
    const version = typeof existingMeta.version === 'number' ? existingMeta.version + 1 : 1

    const payload = JSON.stringify({
      text,
      meta: { version, updatedAt: now, createdAt: existingMeta.createdAt ?? now },
    })

    const existingText = existingRaw ? parseKvEntry(existingRaw).text : null
    await kvPut(c, key, payload)
    await updateIndexes(c, key, text, existingText)
    await appendChangelog(c, key, version)
    loreDB[key] = text
    return c.json({ ok: true, version }, 200)

  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})

admin.post('/delete-lore', async (c) => {
  try {
    const body = await c.req.json()
    const key = extractKey(body)

    if (!key) return c.json({ ok: false, error: 'missing key' }, 400)

    if (!(await checkSecret(c, body))) {
      return c.json({ ok: false, error: 'unauthorized' }, 401)
    }

    const existingRaw = await kvGet(c, key)
    const existingText = existingRaw ? parseKvEntry(existingRaw).text : null
    const deleted = await kvDelete(c, key)
    if (deleted) {
      await updateIndexes(c, key, '', existingText)
      await appendChangelog(c, key, 0, 'delete')
    }
    delete loreDB[key]
    return c.json({ ok: true, source: deleted ? 'kv' : 'in-memory' }, 200)

  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})

admin.post('/gc', async (c) => {
  try {
    const body = await c.req.json()

    const maxAgeDays = Math.max(1, parseInt((body?.max_age_days ?? '30').toString(), 10) || 30)

    if (!(await checkSecret(c, body))) {
      return c.json({ ok: false, error: 'unauthorized' }, 401)
    }

    const kv = getKV(c)
    if (!kv) return c.json({ ok: false, error: 'kv unavailable' }, 503)

    const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString()
    let deletedHistory = 0
    let deletedSnapshots = 0

    // Clean orphan history entries
    let cursor: string | undefined
    do {
      const list: any = await kv.list({ prefix: '_history:', cursor })
      for (const k of list.keys) {
        const baseKey = k.name.slice('_history:'.length)
        const exists = await kv.get(baseKey)
        if (!exists) {
          await kv.delete(k.name)
          deletedHistory++
        }
      }
      cursor = list.list_complete ? undefined : list.cursor
    } while (cursor)

    // Clean old snapshots
    cursor = undefined
    do {
      const list: any = await kv.list({ prefix: '_snapshot:', cursor })
      for (const k of list.keys) {
        const raw = await kv.get(k.name)
        if (raw) {
          try {
            const snap = JSON.parse(raw)
            if (snap.created_at && snap.created_at < cutoff) {
              await kv.delete(k.name)
              deletedSnapshots++
            }
          } catch { /* skip malformed snapshots */ }
        }
      }
      cursor = list.list_complete ? undefined : list.cursor
    } while (cursor)

    return c.json({ ok: true, deleted_history: deletedHistory, deleted_snapshots: deletedSnapshots }, 200)
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})

export default admin