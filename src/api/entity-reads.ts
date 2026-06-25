// src/api/entity-reads.ts — REST GET endpoints for entity list reads from D1
// GET /api/entities/characters, /locations, /nations, /regions, /quests, /items
// No auth required — consistent with /mcp being open.

import { Hono } from 'hono'
import type { AppBindings } from '../types'

const entityReads = new Hono<{ Bindings: AppBindings }>()

// ── Shared character row normaliser ──────────────────────────────────────────

function normaliseCharacter(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? 'Unknown'),
    character_type: String(row.character_type ?? 'npc'),
    character_class: String(row.character_class ?? 'fighter'),
    race: String(row.race ?? 'Human'),
    level: Number(row.level ?? 1),
    hp: Number(row.hp ?? 0),
    max_hp: Number(row.max_hp ?? 0),
    ac: Number(row.ac ?? 10),
    alignment: row.alignment ? String(row.alignment) : null,
    background: row.background ? String(row.background) : null,
    faction_id: row.faction_id ? String(row.faction_id) : null,
    kv_origin: row.kv_origin ? String(row.kv_origin) : null,
  }
}

// ── Characters ───────────────────────────────────────────────────────────────

entityReads.get('/characters', async (c) => {
  const db = c.env.RPG_DB
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const result = await db.prepare(
      'SELECT id, name, character_type, character_class, race, level, hp, max_hp, ac, alignment, background, faction_id, kv_origin FROM characters ORDER BY name ASC LIMIT 100'
    ).all()
    const characters = (result.results as Array<Record<string, unknown>>).map(normaliseCharacter)
    return c.json({ characters, total: characters.length })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

entityReads.get('/characters/:id', async (c) => {
  const db = c.env.RPG_DB
  /* c8 ignore next */
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const id = c.req.param('id')
    const row = await db.prepare(
      'SELECT id, name, character_type, character_class, race, level, hp, max_hp, ac, alignment, background, faction_id, kv_origin FROM characters WHERE id = ? LIMIT 1'
    ).bind(id).first() as Record<string, unknown> | null
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ character: normaliseCharacter(row) })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// Patchable character fields — only allow a safe subset, never id/kv_origin
const PATCHABLE_FIELDS = new Set([
  'character_type', 'race', 'character_class', 'level',
  'hp', 'max_hp', 'ac', 'alignment', 'background',
])

entityReads.patch('/characters/:id', async (c) => {
  const db = c.env.RPG_DB
  /* c8 ignore next */
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)

  const adminSecret = c.env.ADMIN_SECRET
  const headerSecret = c.req.header('X-Admin-Secret') ?? c.req.header('X-Api-Key') ?? ''
  if (!adminSecret || headerSecret !== adminSecret) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  let body: Record<string, unknown>
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const id = c.req.param('id')
  const entries = Object.entries(body).filter(([k]) => PATCHABLE_FIELDS.has(k))
  if (entries.length === 0) return c.json({ error: 'No patchable fields provided' }, 400)

  try {
    const setClauses = entries.map(([k]) => `${k} = ?`).join(', ')
    const values = entries.map(([, v]) => v)
    await db.prepare(`UPDATE characters SET ${setClauses} WHERE id = ?`)
      .bind(...values, id)
      .run()
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// ── Locations (room_nodes) ───────────────────────────────────────────────────

entityReads.get('/locations', async (c) => {
  const db = c.env.RPG_DB
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const result = await db.prepare(
      'SELECT id, name, biome_context, visited_count, last_visited_at FROM room_nodes ORDER BY name ASC LIMIT 100'
    ).all()
    const locations = (result.results as Array<Record<string, unknown>>).map(row => ({
      id: String(row.id ?? ''),
      name: String(row.name ?? 'Unknown'),
      biome_context: row.biome_context ? String(row.biome_context) : null,
      visited_count: Number(row.visited_count ?? 0),
      last_visited_at: row.last_visited_at ? String(row.last_visited_at) : null,
    }))
    return c.json({ locations, total: locations.length })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// ── Nations ──────────────────────────────────────────────────────────────────

entityReads.get('/nations', async (c) => {
  const db = c.env.RPG_DB
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const result = await db.prepare(
      'SELECT id, name, leader, ideology, aggression, trust, paranoia, gdp FROM nations ORDER BY name ASC'
    ).all()
    const nations = (result.results as Array<Record<string, unknown>>).map(row => ({
      id: String(row.id ?? ''),
      name: String(row.name ?? 'Unknown'),
      leader: String(row.leader ?? ''),
      ideology: String(row.ideology ?? ''),
      aggression: Number(row.aggression ?? 50),
      trust: Number(row.trust ?? 50),
      paranoia: Number(row.paranoia ?? 50),
      gdp: Number(row.gdp ?? 0),
    }))
    return c.json({ nations, total: nations.length })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// ── Regions ──────────────────────────────────────────────────────────────────

entityReads.get('/regions', async (c) => {
  const db = c.env.RPG_DB
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const result = await db.prepare(
      'SELECT id, name, type, owner_nation_id FROM regions ORDER BY name ASC'
    ).all()
    const regions = (result.results as Array<Record<string, unknown>>).map(row => ({
      id: String(row.id ?? ''),
      name: String(row.name ?? 'Unknown'),
      type: String(row.type ?? ''),
      owner_nation_id: row.owner_nation_id ? String(row.owner_nation_id) : null,
    }))
    return c.json({ regions, total: regions.length })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// ── Quests ───────────────────────────────────────────────────────────────────

entityReads.get('/quests', async (c) => {
  const db = c.env.RPG_DB
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const result = await db.prepare(
      'SELECT id, name, description, status, giver FROM quests ORDER BY created_at DESC LIMIT 100'
    ).all()
    const quests = (result.results as Array<Record<string, unknown>>).map(row => ({
      id: String(row.id ?? ''),
      name: String(row.name ?? 'Unknown'),
      description: String(row.description ?? ''),
      status: String(row.status ?? ''),
      giver: row.giver ? String(row.giver) : null,
    }))
    return c.json({ quests, total: quests.length })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// ── Items ─────────────────────────────────────────────────────────────────────

entityReads.get('/items', async (c) => {
  const db = c.env.RPG_DB
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const result = await db.prepare(
      'SELECT id, name, type, value, weight FROM items ORDER BY name ASC LIMIT 100'
    ).all()
    const items = (result.results as Array<Record<string, unknown>>).map(row => ({
      id: String(row.id ?? ''),
      name: String(row.name ?? 'Unknown'),
      type: String(row.type ?? ''),
      value: Number(row.value ?? 0),
      weight: Number(row.weight ?? 0),
    }))
    return c.json({ items, total: items.length })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

export default entityReads
