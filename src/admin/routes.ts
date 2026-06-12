// src/admin/routes.ts
import { Hono } from 'hono'
import type { AppBindings } from '../types'
import { kvGet, kvPut, kvDelete, getKV, loreDB } from '../lib/kv'
import { parseKvEntry } from '../lib/lore'
import { pushHistory, appendChangelog } from '../lib/history'
import { updateIndexes } from '../lib/indexes'
import { parseKvCharToD1 } from '../rpg/utils/kv-to-d1'

const admin = new Hono<{ Bindings: AppBindings }>()

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Extract and validate a non-empty key from a JSON body. Returns null on failure. */
function extractKey(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const k = (body as Record<string, unknown>).key
  if (typeof k !== 'string' || !k.trim()) return null
  return k.trim().toLowerCase()
}

/** Sanitize error messages to prevent internal implementation details from leaking. */
function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    // Only expose generic messages in production
    if (process.env.NODE_ENV === 'production') {
      return 'Internal server error'
    }
    return err.message
  }
  return 'Unknown error'
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
    console.error(`[admin] ${c.req.method} ${c.req.path}:`, e)
    return c.json({ ok: false, error: safeErrorMessage(e) }, 500)
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
    console.error(`[admin] ${c.req.method} ${c.req.path}:`, e)
    return c.json({ ok: false, error: safeErrorMessage(e) }, 500)
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
    console.error(`[admin] ${c.req.method} ${c.req.path}:`, e)
    return c.json({ ok: false, error: safeErrorMessage(e) }, 500)
  }
})

// ── KV → D1 character migration ─────────────────────────────────────────────

admin.post('/migrate-character', async (c) => {
  try {
    const body = await c.req.json()

    if (!(await checkSecret(c, body))) {
      return c.json({ ok: false, error: 'unauthorized' }, 401)
    }

    const rawKey = (body as Record<string, unknown>).key
    if (typeof rawKey !== 'string' || !rawKey.trim()) {
      return c.json({ ok: false, error: 'missing or invalid key' }, 400)
    }
    const key = rawKey.trim().toLowerCase()
    if (!key.startsWith('character:')) {
      return c.json({ ok: false, error: 'key must start with "character:"' }, 400)
    }

    const db = c.env?.RPG_DB
    if (!db) return c.json({ ok: false, error: 'RPG_DB unavailable' }, 503)

    const raw = await kvGet(c, key)
    if (!raw) return c.json({ ok: false, error: `KV key not found: ${key}` }, 404)

    const { text, meta } = parseKvEntry(raw)

    // Idempotency: if already migrated, return the existing D1 id
    const idMatch = text.match(/^## D1-Character-ID:\s*(\S+)/m)
    if (idMatch) {
      return c.json({ ok: true, already_migrated: true, d1Id: idMatch[1], key }, 200)
    }

    // Check for existing D1 row by kv_origin to prevent duplicates
    const existing = await db.prepare('SELECT id FROM characters WHERE kv_origin = ?').bind(key).first() as { id: string } | null
    if (existing) {
      return c.json({ ok: false, error: `D1 row already exists for ${key}`, d1Id: existing.id }, 409)
    }

    const newId = crypto.randomUUID()
    const insert = parseKvCharToD1(key, text, newId)

    await db.prepare(`
      INSERT INTO characters (
        id, name, stats, hp, max_hp, ac, level, faction_id, behavior,
        character_type, character_class, race, background, alignment,
        conditions, resistances, vulnerabilities, immunities,
        known_spells, prepared_spells, cantrips_known,
        currency, resource_pools, xp,
        alias, age, gender, orientation,
        weight_1, weight_2, perception_float,
        thread_id, state_stage, state_stage_timer,
        kv_origin, current_room_id, perception_bonus, stealth_bonus,
        origin, created_at, updated_at
      ) VALUES (
        ?,?,?,?,?,?,?,?,?,
        ?,?,?,?,?,
        ?,?,?,?,
        ?,?,?,
        ?,?,?,
        ?,?,?,?,
        ?,?,?,
        ?,?,?,
        ?,?,?,?,
        ?,?,?
      )
    `).bind(
      insert.id, insert.name, insert.stats, insert.hp, insert.max_hp, insert.ac, insert.level,
      insert.faction_id, insert.behavior,
      insert.character_type, insert.character_class, insert.race, insert.background, insert.alignment,
      insert.conditions, insert.resistances, insert.vulnerabilities, insert.immunities,
      insert.known_spells, insert.prepared_spells, insert.cantrips_known,
      insert.currency, insert.resource_pools, insert.xp,
      insert.alias, insert.age, insert.gender, insert.orientation,
      insert.weight_1, insert.weight_2, insert.perception_float,
      insert.thread_id, insert.state_stage, insert.state_stage_timer,
      insert.kv_origin, insert.current_room_id, insert.perception_bonus, insert.stealth_bonus,
      insert.origin, insert.created_at, insert.updated_at
    ).run()

    // Update KV entry: prepend redirect marker, preserve existing text
    const now = new Date().toISOString()
    const newVersion = typeof meta.version === 'number' ? meta.version + 1 : 1
    const redirectHeader = `## D1-Migrated: true\n## D1-Character-ID: ${newId}\n## Status: Legacy entry — see D1 for current data\n\n`
    const updatedText = redirectHeader + text

    await pushHistory(c, key, raw)
    await kvPut(c, key, JSON.stringify({
      text: updatedText,
      meta: { ...meta, version: newVersion, updatedAt: now },
    }))
    loreDB[key] = updatedText

    return c.json({ ok: true, d1Id: newId, key, name: insert.name }, 200)

  } catch (e) {
    console.error(`[admin] ${c.req.method} ${c.req.path}:`, e)
    return c.json({ ok: false, error: safeErrorMessage(e) }, 500)
  }
})

// ── Map routes ──────────────────────────────────────────────────────────────

// Single-line CREATE TABLE statements (exec() processes line-by-line in D1).
const MAP_SCHEMA_DDL = [
  "CREATE TABLE IF NOT EXISTS hexes (q INTEGER NOT NULL, r INTEGER NOT NULL, map_id TEXT NOT NULL DEFAULT 'main', terrain TEXT, label TEXT, data TEXT DEFAULT '{}', updated_at TEXT DEFAULT (DATETIME('now')), PRIMARY KEY (q, r, map_id))",
  "CREATE TABLE IF NOT EXISTS landmarks (id TEXT PRIMARY KEY, map_id TEXT NOT NULL DEFAULT 'main', q INTEGER NOT NULL, r INTEGER NOT NULL, name TEXT NOT NULL, category TEXT, data TEXT DEFAULT '{}', updated_at TEXT DEFAULT (DATETIME('now')))",
  "CREATE INDEX IF NOT EXISTS idx_landmarks_map ON landmarks(map_id)",
  "CREATE INDEX IF NOT EXISTS idx_landmarks_coords ON landmarks(q, r)",
]

admin.post('/map/setup-db', async (c) => {
  try {
    const body = await c.req.json()
    if (!(await checkSecret(c, body))) {
      return c.json({ ok: false, error: 'unauthorized' }, 401)
    }
    const db = c.env?.RPG_DB
    if (!db) return c.json({ ok: false, error: 'RPG_DB unavailable' }, 503)
    for (const ddl of MAP_SCHEMA_DDL) {
      await db.exec(ddl)
    }
    return c.json({ ok: true }, 200)
  } catch (e) {
    console.error(`[admin] ${c.req.method} ${c.req.path}:`, e)
    return c.json({ ok: false, error: safeErrorMessage(e) }, 500)
  }
})

const D1_CHUNK = 100

admin.post('/map/push-hexes', async (c) => {
  try {
    const body = await c.req.json()

    if (!(await checkSecret(c, body))) {
      return c.json({ ok: false, error: 'unauthorized' }, 401)
    }

    const mapId: string = typeof body?.mapId === 'string' && body.mapId ? body.mapId : 'main'
    const hexes: unknown[] = Array.isArray(body?.hexes) ? body.hexes : []

    const db = c.env?.RPG_DB
    if (!db) return c.json({ ok: false, error: 'RPG_DB unavailable' }, 503)

    let count = 0
    for (let i = 0; i < hexes.length; i += D1_CHUNK) {
      const chunk = hexes.slice(i, i + D1_CHUNK)
      const stmts = chunk
        .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
        .map((h) =>
          db.prepare(
            'INSERT OR REPLACE INTO hexes (q, r, map_id, terrain, label, data) VALUES (?, ?, ?, ?, ?, ?)'
          ).bind(
            h.q ?? 0,
            h.r ?? 0,
            mapId,
            h.terrain ?? null,
            h.name ?? null,
            JSON.stringify({ description: h.description ?? '' })
          )
        )
      if (stmts.length > 0) {
        await db.batch(stmts)
        count += stmts.length
      }
    }

    return c.json({ ok: true, count }, 200)
  } catch (e) {
    console.error(`[admin] ${c.req.method} ${c.req.path}:`, e)
    return c.json({ ok: false, error: safeErrorMessage(e) }, 500)
  }
})

admin.post('/map/push-landmarks', async (c) => {
  try {
    const body = await c.req.json()

    if (!(await checkSecret(c, body))) {
      return c.json({ ok: false, error: 'unauthorized' }, 401)
    }

    const mapId: string = typeof body?.mapId === 'string' && body.mapId ? body.mapId : 'main'
    const landmarks: unknown[] = Array.isArray(body?.landmarks) ? body.landmarks : []

    const db = c.env?.RPG_DB
    if (!db) return c.json({ ok: false, error: 'RPG_DB unavailable' }, 503)

    let count = 0
    for (let i = 0; i < landmarks.length; i += D1_CHUNK) {
      const chunk = landmarks.slice(i, i + D1_CHUNK)
      const stmts = chunk
        .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
        .map((l) =>
          db.prepare(
            'INSERT OR REPLACE INTO landmarks (id, map_id, q, r, name, category, data) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).bind(
            l.id ?? '',
            mapId,
            l.q ?? 0,
            l.r ?? 0,
            l.name ?? '',
            l.type ?? null,
            JSON.stringify({
              notes: l.notes ?? '',
              attributes: l.attributes ?? '{}',
              linkedMapId: l.linkedMapId ?? null,
              visible: l.visible ?? true,
              linkedLoreKey: l.linkedLoreKey ?? null,
            })
          )
        )
      if (stmts.length > 0) {
        await db.batch(stmts)
        count += stmts.length
      }
    }

    return c.json({ ok: true, count }, 200)
  } catch (e) {
    console.error(`[admin] ${c.req.method} ${c.req.path}:`, e)
    return c.json({ ok: false, error: safeErrorMessage(e) }, 500)
  }
})

export default admin
