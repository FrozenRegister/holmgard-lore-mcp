// src/admin/routes.ts
import { Hono, type Context } from 'hono'
import type { AppBindings } from '../types'
import type { RequestIdVariables } from '../middleware/request-id'
import { kvGet, kvPut, kvDelete, getKV, loreDB } from '../lib/kv'
import { parseKvEntry } from '../lib/lore'
import { pushHistory, appendChangelog } from '../lib/history'
import { updateIndexes } from '../lib/indexes'
import { parseKvCharToD1 } from '../rpg/utils/kv-to-d1'

const admin = new Hono<{ Bindings: AppBindings; Variables: RequestIdVariables }>()

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Extract and validate a non-empty key from a JSON body. Returns null on failure. */
function extractKey(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const k = (body as Record<string, unknown>).key
  if (typeof k !== 'string' || !k.trim()) return null
  return k.trim().toLowerCase()
}

/** Extract a positive integer from a value, with a default fallback. */
function extractPositiveInt(value: unknown, defaultValue: number): number {
  const num = parseInt((value ?? '').toString(), 10)
  return isNaN(num) || num <= 0 ? defaultValue : num
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

/** Uniform 500 response — tags the error with the request's correlation ID (see issue #23). */
function errorResponse(c: Context<{ Bindings: AppBindings; Variables: RequestIdVariables }>, e: unknown, status: 500 = 500): Response {
  const requestId = c.get('requestId')
  console.error(JSON.stringify({ request_id: requestId, error: safeErrorMessage(e) }))
  return c.json({ ok: false, error: safeErrorMessage(e), request_id: requestId }, status)
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
    return errorResponse(c, e)
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
    return errorResponse(c, e)
  }
})

admin.post('/set-lore-batch', async (c) => {
  try {
    const body = await c.req.json()

    if (!(await checkSecret(c, body))) {
      return c.json({ ok: false, error: 'unauthorized' }, 401)
    }

    const items: unknown[] = Array.isArray(body?.items) ? body.items : []
    if (!items.length) {
      return c.json({ ok: false, error: 'items must be a non-empty array' }, 400)
    }

    const now = new Date().toISOString()
    const failedKeys: string[] = []

    await Promise.all(items.map(async (item) => {
      const key = extractKey(item)
      const text = extractText(item)
      if (!key || !text) { failedKeys.push(String((item as Record<string, unknown>)?.key ?? '?')); return }

      try {
        const existingRaw = await kvGet(c, key)
        const existingMeta = existingRaw ? parseKvEntry(existingRaw).meta : {}
        if (existingRaw) await pushHistory(c, key, existingRaw)

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
      } catch {
        failedKeys.push(key)
      }
    }))

    if (failedKeys.length) {
      return c.json({ ok: false, error: 'KV write failed', failedKeys }, 500)
    }
    return c.json({ ok: true, saved: items.length }, 200)

  } catch (e) {
    console.error(`[admin] ${c.req.method} ${c.req.path}:`, e)
    return errorResponse(c, e)
  }
})

admin.post('/delete-lore-batch', async (c) => {
  try {
    const body = await c.req.json()

    if (!(await checkSecret(c, body))) {
      return c.json({ ok: false, error: 'unauthorized' }, 401)
    }

    const rawKeys: unknown[] = Array.isArray(body?.keys) ? body.keys : []
    if (!rawKeys.length) {
      return c.json({ ok: false, error: 'keys must be a non-empty array' }, 400)
    }

    const keys = rawKeys
      .filter((k): k is string => typeof k === 'string' && !!k.trim())
      .map(k => k.trim().toLowerCase())

    if (!keys.length) {
      return c.json({ ok: false, error: 'keys must be a non-empty array' }, 400)
    }

    await Promise.all(keys.map(async (key) => {
      const existingRaw = await kvGet(c, key)
      const existingText = existingRaw ? parseKvEntry(existingRaw).text : null
      const deleted = await kvDelete(c, key)
      if (deleted) {
        await updateIndexes(c, key, '', existingText)
        await appendChangelog(c, key, 0, 'delete')
      }
      delete loreDB[key]
    }))

    return c.json({ ok: true, deleted: keys.length }, 200)

  } catch (e) {
    console.error(`[admin] ${c.req.method} ${c.req.path}:`, e)
    return errorResponse(c, e)
  }
})

admin.post('/gc', async (c) => {
  try {
    const body = await c.req.json()

    const maxAgeDays = extractPositiveInt(body?.max_age_days, 30)

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

    // Purge all CSP violation reports (never needed after logging)
    let deletedCspReports = 0
    cursor = undefined
    do {
      const list: any = await kv.list({ prefix: '_csp_report:', cursor })
      for (const k of list.keys) {
        await kv.delete(k.name)
        deletedCspReports++
      }
      cursor = list.list_complete ? undefined : list.cursor
    } while (cursor)

    return c.json({ ok: true, deleted_history: deletedHistory, deleted_snapshots: deletedSnapshots, deleted_csp_reports: deletedCspReports }, 200)
  } catch (e) {
    console.error(`[admin] ${c.req.method} ${c.req.path}:`, e)
    return errorResponse(c, e)
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
        ?,?,?,
        ?,?,?,?,
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
    return errorResponse(c, e)
  }
})

// Bulk migration: all characters
admin.post('/migrate-all-characters', async (c) => {
  try {
    const body = await c.req.json()

    if (!(await checkSecret(c, body))) {
      return c.json({ ok: false, error: 'unauthorized' }, 401)
    }

    const db = c.env?.RPG_DB
    const kv = getKV(c)
    if (!db || !kv) return c.json({ ok: false, error: 'KV or RPG_DB unavailable' }, 503)

    // List all character:* keys
    const characterKeys: string[] = []
    let cursor: string | undefined
    do {
      const listed: any = await kv.list({ prefix: 'character:', cursor })
      for (const k of listed.keys) {
        characterKeys.push(k.name)
      }
      cursor = listed.list_complete ? undefined : listed.cursor
    } while (cursor)

    const results: Array<{ key: string; status: 'migrated' | 'skipped' | 'error'; d1Id?: string; error?: string }> = []

    for (const key of characterKeys) {
      try {
        const raw = await kvGet(c, key)
        if (!raw) {
          results.push({ key, status: 'error', error: 'KV entry not found' })
          continue
        }

        const { text, meta } = parseKvEntry(raw)

        // Idempotency: if already migrated, skip
        const idMatch = text.match(/## D1-Character-ID:\s*([a-f0-9-]+)/)
        if (idMatch) {
          results.push({ key, status: 'skipped', d1Id: idMatch[1] })
          continue
        }

        // Check for existing D1 row by kv_origin
        const existing = await db.prepare('SELECT id FROM characters WHERE kv_origin = ?').bind(key).first() as { id: string } | null
        if (existing) {
          results.push({ key, status: 'skipped', d1Id: existing.id })
          continue
        }

        const newId = crypto.randomUUID()
        const insert = parseKvCharToD1(key, text, newId)

        // Nullify current_room_id to avoid FK violations
        insert.current_room_id = null

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
            ?,?,?,
            ?,?,?,?,
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

        // Update KV with redirect marker
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

        results.push({ key, status: 'migrated', d1Id: newId })
      } catch (err) {
        results.push({
          key,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    const migrated = results.filter(r => r.status === 'migrated').length
    const skipped = results.filter(r => r.status === 'skipped').length
    const failed = results.filter(r => r.status === 'error').length

    return c.json({
      ok: true,
      total: results.length,
      migrated,
      skipped,
      failed,
      results,
    }, 200)
  } catch (e) {
    console.error(`[admin] ${c.req.method} ${c.req.path}:`, e)
    return errorResponse(c, e)
  }
})

// ── Entity relations (CRUD) ──────────────────────────────────────────────────

const VALID_ENTITY_TYPES = new Set(['characters', 'locations', 'nations', 'regions', 'quests', 'items'])

admin.post('/relations', async (c) => {
  const db = c.env?.RPG_DB
  if (!db) return c.json({ ok: false, error: 'RPG_DB unavailable' }, 503)

  let body: Record<string, unknown>
  try { body = await c.req.json() } catch { return c.json({ ok: false, error: 'Invalid JSON' }, 400) }

  if (!(await checkSecret(c, body))) {
    return c.json({ ok: false, error: 'unauthorized' }, 401)
  }

  const from_type = typeof body.from_type === 'string' ? body.from_type.trim() : ''
  const from_id   = typeof body.from_id   === 'string' ? body.from_id.trim()   : ''
  const to_type   = typeof body.to_type   === 'string' ? body.to_type.trim()   : ''
  const to_id     = typeof body.to_id     === 'string' ? body.to_id.trim()     : ''
  const relation_type = typeof body.relation_type === 'string' ? body.relation_type.trim() : ''

  if (!from_type || !VALID_ENTITY_TYPES.has(from_type)) {
    return c.json({ ok: false, error: 'Invalid or missing from_type' }, 400)
  }
  if (!from_id) return c.json({ ok: false, error: 'Missing from_id' }, 400)
  if (!to_type || !VALID_ENTITY_TYPES.has(to_type)) {
    return c.json({ ok: false, error: 'Invalid or missing to_type' }, 400)
  }
  if (!to_id) return c.json({ ok: false, error: 'Missing to_id' }, 400)
  if (!relation_type) return c.json({ ok: false, error: 'Missing relation_type' }, 400)

  const attitude       = body.attitude !== undefined && body.attitude !== null ? Number(body.attitude) : null
  const is_bidirectional = body.is_bidirectional === false ? 0 : 1
  const color          = typeof body.color === 'string' ? body.color.trim() || null : null
  const is_pinned      = body.is_pinned ? 1 : 0
  const is_private     = body.is_private ? 1 : 0
  const notes          = typeof body.notes === 'string' ? body.notes.trim() || null : null

  try {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await db.prepare(`
      INSERT INTO entity_relations
        (id, from_type, from_id, to_type, to_id, relation_type,
         attitude, is_bidirectional, color, is_pinned, is_private, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, from_type, from_id, to_type, to_id, relation_type,
             attitude, is_bidirectional, color, is_pinned, is_private, notes, now).run()
    return c.json({ ok: true, id }, 201)
  } catch (e) {
    /* istanbul ignore next */
    return errorResponse(c, e)
  }
})

const RELATION_PATCHABLE = new Set([
  'relation_type', 'attitude', 'is_bidirectional', 'color', 'is_pinned', 'is_private', 'notes',
])

admin.patch('/relations/:id', async (c) => {
  const db = c.env?.RPG_DB
  if (!db) return c.json({ ok: false, error: 'RPG_DB unavailable' }, 503)

  let body: Record<string, unknown>
  try { body = await c.req.json() } catch { return c.json({ ok: false, error: 'Invalid JSON' }, 400) }

  if (!(await checkSecret(c, body))) {
    return c.json({ ok: false, error: 'unauthorized' }, 401)
  }

  const id = c.req.param('id')
  const entries = Object.entries(body).filter(([k]) => RELATION_PATCHABLE.has(k))
  if (entries.length === 0) return c.json({ ok: false, error: 'No patchable fields provided' }, 400)

  try {
    const existing = await db.prepare('SELECT id FROM entity_relations WHERE id = ?').bind(id).first()
    if (!existing) return c.json({ ok: false, error: 'Relation not found' }, 404)

    const setClauses = entries.map(([k]) => `${k} = ?`).join(', ')
    const values = entries.map(([, v]) => v)
    await db.prepare(`UPDATE entity_relations SET ${setClauses} WHERE id = ?`)
      .bind(...values, id).run()
    return c.json({ ok: true })
  } catch (e) {
    /* istanbul ignore next */
    return errorResponse(c, e)
  }
})

admin.delete('/relations/:id', async (c) => {
  const db = c.env?.RPG_DB
  if (!db) return c.json({ ok: false, error: 'RPG_DB unavailable' }, 503)

  const headerSecret = c.req.header('X-Admin-Secret') ?? c.req.header('X-Api-Key') ?? null
  const ADMIN_SECRET = c.env?.ADMIN_SECRET
  if (!ADMIN_SECRET || headerSecret !== ADMIN_SECRET) {
    return c.json({ ok: false, error: 'unauthorized' }, 401)
  }

  try {
    const id = c.req.param('id')
    const existing = await db.prepare('SELECT id FROM entity_relations WHERE id = ?').bind(id).first()
    if (!existing) return c.json({ ok: false, error: 'Relation not found' }, 404)

    await db.prepare('DELETE FROM entity_relations WHERE id = ?').bind(id).run()
    return c.json({ ok: true })
  } catch (e) {
    /* istanbul ignore next */
    return errorResponse(c, e)
  }
})

// ── Map routes ──────────────────────────────────────────────────────────────
// `hexes`/`landmarks` are created by schema/migrations/0001_initial.sql (and
// updated by 0019_map_tables_world_scoping.sql, #319) — the D1 migration
// pipeline is authoritative for their schema. The `POST /admin/map/setup-db`
// route that used to re-run an ad-hoc, uncoordinated copy of this DDL at
// request time (bypassing .github/workflows/d1-migrate.yml) has been removed
// as part of #319 since it was fully redundant with the migrations.

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
          // #321 — this route only ever owns terrain/label/data (the editor's
          // freeform fields). worldId/biome are RPG-owned (world_map.ts's
          // patch/batch actions) but the editor's push MAY optionally carry
          // them (e.g. #321's biome picker); COALESCE preserves whichever
          // RPG-set value already exists when the editor doesn't send one,
          // rather than resetting it to null (the old INSERT OR REPLACE did
          // exactly that on every editor push, silently wiping any world_id/
          // biome set via world_map.patch — see docs/issues/HIGH-map-push-
          // insert-or-replace-wipes-rpg-columns.md).
          db.prepare(
            `INSERT INTO hexes (q, r, map_id, terrain, label, data, world_id, biome, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(q, r, map_id) DO UPDATE SET
               terrain = excluded.terrain, label = excluded.label, data = excluded.data,
               world_id = COALESCE(excluded.world_id, hexes.world_id),
               biome = COALESCE(excluded.biome, hexes.biome),
               updated_at = excluded.updated_at`
          ).bind(
            h.q ?? 0,
            h.r ?? 0,
            mapId,
            h.terrain ?? null,
            h.name ?? null,
            JSON.stringify({ description: h.description ?? '' }),
            h.worldId ?? null,
            h.biome ?? null,
            new Date().toISOString()
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
    return errorResponse(c, e)
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
          // #321 — same fix as push-hexes: this route only owns name/category/
          // data. world_id/region_id/population/zone_* are RPG-owned (set via
          // world_map.ts's suggest_poi/update_poi); preserve them on an
          // ordinary editor push instead of resetting to their column
          // defaults, which the old INSERT OR REPLACE silently did.
          db.prepare(
            `INSERT INTO landmarks (id, map_id, q, r, name, category, data, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               map_id = excluded.map_id, q = excluded.q, r = excluded.r,
               name = excluded.name, category = excluded.category, data = excluded.data,
               updated_at = excluded.updated_at`
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
            }),
            new Date().toISOString()
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
    return errorResponse(c, e)
  }
})

// ── Disaster recovery: full KV dump + restore ───────────────────────────────
// Exports/imports the *entire* KV namespace (including _history:, _idx:,
// _changelog, etc.) — a real restore needs to reconstruct the whole store,
// not just the "visible" lore keys kvList() filters down to. Admin-only
// (ADMIN_SECRET-gated): this is bulk/privileged, not an agent-facing read, so
// it stays off the MCP surface per the API surface convention in CLAUDE.md.

admin.get('/export', async (c) => {
  try {
    const headerSecret = c.req.header('X-Api-Key') ?? c.req.header('X-Admin-Secret') ?? null
    const ADMIN_SECRET = c.env?.ADMIN_SECRET
    if (!ADMIN_SECRET || headerSecret !== ADMIN_SECRET) {
      return c.json({ ok: false, error: 'unauthorized' }, 401)
    }

    const kv = getKV(c)
    if (!kv) return c.json({ ok: false, error: 'kv unavailable' }, 503)

    const keys: Array<{ key: string; value: string }> = []
    let cursor: string | undefined
    do {
      const listed: { keys: Array<{ name: string }>; list_complete: boolean; cursor?: string } =
        await kv.list(cursor ? { cursor } : undefined)
      const rawValues = await Promise.all(listed.keys.map(k => kv.get(k.name)))
      for (let i = 0; i < listed.keys.length; i++) {
        const raw = rawValues[i]
        if (raw !== null) keys.push({ key: listed.keys[i].name, value: raw })
      }
      cursor = listed.list_complete ? undefined : listed.cursor
    } while (cursor)

    return c.json({ ok: true, keys, exported_at: new Date().toISOString(), key_count: keys.length }, 200)
  } catch (e) {
    console.error(`[admin] ${c.req.method} ${c.req.path}:`, e)
    return errorResponse(c, e)
  }
})

admin.post('/import', async (c) => {
  try {
    const body = await c.req.json()

    if (!(await checkSecret(c, body))) {
      return c.json({ ok: false, error: 'unauthorized' }, 401)
    }

    const items: unknown[] = Array.isArray((body as Record<string, unknown>)?.keys) ? (body as Record<string, unknown>).keys as unknown[] : []
    if (!items.length) {
      return c.json({ ok: false, error: 'keys must be a non-empty array' }, 400)
    }

    const kv = getKV(c)
    if (!kv) return c.json({ ok: false, error: 'kv unavailable' }, 503)

    const failedKeys: string[] = []
    let imported = 0

    await Promise.all(items.map(async (item) => {
      if (!item || typeof item !== 'object') { failedKeys.push('?'); return }
      const key = (item as Record<string, unknown>).key
      const value = (item as Record<string, unknown>).value
      if (typeof key !== 'string' || !key.trim() || typeof value !== 'string') {
        failedKeys.push(typeof key === 'string' && key ? key : '?')
        return
      }
      try {
        await kv.put(key, value)
        imported++
      } catch {
        failedKeys.push(key)
      }
    }))

    return c.json({ ok: failedKeys.length === 0, imported, failed: failedKeys.length, failedKeys }, 200)
  } catch (e) {
    console.error(`[admin] ${c.req.method} ${c.req.path}:`, e)
    return errorResponse(c, e)
  }
})

// ── Quest Milestones ────────────────────────────────────────────────────────

admin.post('/quests/:questId/milestones', async (c) => {
  try {
    const body = await c.req.json()

    if (!(await checkSecret(c, body))) {
      return c.json({ ok: false, error: 'unauthorized' }, 401)
    }

    const db = c.env?.RPG_DB
    if (!db) return c.json({ ok: false, error: 'RPG_DB unavailable' }, 503)

    const questId = c.req.param('questId')
    const { title, notes, status, linked_entity_type, linked_entity_id, color, is_private } = body as Record<string, unknown>

    if (!title || typeof title !== 'string' || !title.trim()) {
      return c.json({ ok: false, error: 'title is required' }, 400)
    }

    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    // Get max sort_order for this quest
    const maxResult = await db.prepare('SELECT MAX(sort_order) as max_order FROM quest_milestones WHERE quest_id = ?').bind(questId).first() as { max_order: number | null }
    const nextOrder = (maxResult?.max_order ?? -1) + 1

    await db.prepare(`
      INSERT INTO quest_milestones (id, quest_id, sort_order, title, notes, status, linked_entity_type, linked_entity_id, color, is_private, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, questId, nextOrder,
      title.toString().trim(),
      notes ? String(notes).trim() : null,
      status ? String(status) : 'pending',
      linked_entity_type ? String(linked_entity_type) : null,
      linked_entity_id ? String(linked_entity_id) : null,
      color ? String(color) : null,
      is_private ? 1 : 0,
      now, now
    ).run()

    return c.json({ ok: true, id, sort_order: nextOrder }, 200)
  } catch (e) {
    console.error(`[admin] ${c.req.method} ${c.req.path}:`, e)
    return errorResponse(c, e)
  }
})

admin.patch('/quests/:questId/milestones/:milestoneId', async (c) => {
  try {
    const body = await c.req.json()

    if (!(await checkSecret(c, body))) {
      return c.json({ ok: false, error: 'unauthorized' }, 401)
    }

    const db = c.env?.RPG_DB
    if (!db) return c.json({ ok: false, error: 'RPG_DB unavailable' }, 503)

    const milestoneId = c.req.param('milestoneId')
    const { title, notes, status, linked_entity_type, linked_entity_id, color, is_private, sort_order } = body as Record<string, unknown>

    const sets: string[] = ['updated_at = ?']
    const vals: unknown[] = [new Date().toISOString()]

    if (title !== undefined) { sets.push('title = ?'); vals.push(title ? String(title).trim() : '') }
    if (notes !== undefined) { sets.push('notes = ?'); vals.push(notes ? String(notes).trim() : null) }
    if (status !== undefined) { sets.push('status = ?'); vals.push(String(status)) }
    if (linked_entity_type !== undefined) { sets.push('linked_entity_type = ?'); vals.push(linked_entity_type ? String(linked_entity_type) : null) }
    if (linked_entity_id !== undefined) { sets.push('linked_entity_id = ?'); vals.push(linked_entity_id ? String(linked_entity_id) : null) }
    if (color !== undefined) { sets.push('color = ?'); vals.push(color ? String(color) : null) }
    if (is_private !== undefined) { sets.push('is_private = ?'); vals.push(is_private ? 1 : 0) }
    if (sort_order !== undefined) { sets.push('sort_order = ?'); vals.push(Number(sort_order)) }

    vals.push(milestoneId)

    await db.prepare(`UPDATE quest_milestones SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()

    return c.json({ ok: true }, 200)
  } catch (e) {
    console.error(`[admin] ${c.req.method} ${c.req.path}:`, e)
    return errorResponse(c, e)
  }
})

admin.delete('/quests/:questId/milestones/:milestoneId', async (c) => {
  try {
    const body = await c.req.json()

    if (!(await checkSecret(c, body))) {
      return c.json({ ok: false, error: 'unauthorized' }, 401)
    }

    const db = c.env?.RPG_DB
    if (!db) return c.json({ ok: false, error: 'RPG_DB unavailable' }, 503)

    const milestoneId = c.req.param('milestoneId')

    await db.prepare('DELETE FROM quest_milestones WHERE id = ?').bind(milestoneId).run()

    return c.json({ ok: true }, 200)
  } catch (e) {
    console.error(`[admin] ${c.req.method} ${c.req.path}:`, e)
    return errorResponse(c, e)
  }
})

export default admin