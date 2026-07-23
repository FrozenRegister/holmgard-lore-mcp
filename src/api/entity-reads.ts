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
    current_room_id: row.current_room_id ? String(row.current_room_id) : null,
    kv_origin: row.kv_origin ? String(row.kv_origin) : null,
  }
}

// ── Characters ───────────────────────────────────────────────────────────────

entityReads.get('/characters', async (c) => {
  const db = c.env.RPG_DB
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const result = await db
      .prepare(
        'SELECT id, name, character_type, character_class, race, level, hp, max_hp, ac, alignment, background, faction_id, current_room_id, kv_origin FROM characters ORDER BY name ASC LIMIT 100',
      )
      .all()
    const characters = (result.results as Array<Record<string, unknown>>).map(normaliseCharacter)
    return c.json({ characters, total: characters.length })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

entityReads.get('/characters/:id', async (c) => {
  const db = c.env.RPG_DB
  /* c8 ignore next */
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const id = c.req.param('id')
    const row = (await db
      .prepare(
        'SELECT id, name, character_type, character_class, race, level, hp, max_hp, ac, alignment, background, faction_id, current_room_id, kv_origin FROM characters WHERE id = ? LIMIT 1',
      )
      .bind(id)
      .first()) as Record<string, unknown> | null
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ character: normaliseCharacter(row) })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// Patchable character fields — only allow a safe subset, never id/kv_origin
const PATCHABLE_FIELDS = new Set([
  'character_type',
  'race',
  'character_class',
  'level',
  'hp',
  'max_hp',
  'ac',
  'alignment',
  'background',
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
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const id = c.req.param('id')
  const entries = Object.entries(body).filter(([k]) => PATCHABLE_FIELDS.has(k))
  if (entries.length === 0) return c.json({ error: 'No patchable fields provided' }, 400)

  try {
    const setClauses = entries.map(([k]) => `${k} = ?`).join(', ')
    const values = entries.map(([, v]) => v)
    await db
      .prepare(`UPDATE characters SET ${setClauses} WHERE id = ?`)
      .bind(...values, id)
      .run()
    return c.json({ ok: true })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// ── Character relationships ───────────────────────────────────────────────────

entityReads.get('/characters/:id/relationships', async (c) => {
  const db = c.env.RPG_DB
  /* c8 ignore next */
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const id = c.req.param('id')

    // Bidirectional NPC relationships — this char as initiator OR target
    const relResult = await db
      .prepare(
        `
      SELECT nr.npc_id AS target_id, c.name AS target_name,
             c.character_type AS target_type, c.kv_origin AS target_kv_origin,
             nr.familiarity, nr.disposition, nr.interaction_count, nr.last_interaction_at
      FROM npc_relationships nr
      JOIN characters c ON c.id = nr.npc_id
      WHERE nr.character_id = ?
      UNION ALL
      SELECT nr.character_id AS target_id, c.name AS target_name,
             c.character_type AS target_type, c.kv_origin AS target_kv_origin,
             nr.familiarity, nr.disposition, nr.interaction_count, nr.last_interaction_at
      FROM npc_relationships nr
      JOIN characters c ON c.id = nr.character_id
      WHERE nr.npc_id = ?
      ORDER BY familiarity, last_interaction_at DESC
    `,
      )
      .bind(id, id)
      .all()

    // Co-party members through any shared party
    const partyResult = await db
      .prepare(
        `
      SELECT pm2.character_id, c2.name, c2.character_type, c2.kv_origin,
             pm2.role, p.id AS party_id, p.name AS party_name
      FROM party_members pm1
      JOIN parties p ON p.id = pm1.party_id
      JOIN party_members pm2 ON pm2.party_id = p.id AND pm2.character_id != ?
      JOIN characters c2 ON c2.id = pm2.character_id
      WHERE pm1.character_id = ?
      ORDER BY pm2.role, c2.name
    `,
      )
      .bind(id, id)
      .all()

    const npc_relationships = (relResult.results as Array<Record<string, unknown>>).map((row) => ({
      target_id: String(row.target_id ?? ''),
      target_name: String(row.target_name ?? 'Unknown'),
      target_type: String(row.target_type ?? 'npc'),
      target_kv_origin: row.target_kv_origin ? String(row.target_kv_origin) : null,
      familiarity: String(row.familiarity ?? 'stranger'),
      disposition: String(row.disposition ?? 'neutral'),
      interaction_count: Number(row.interaction_count ?? 0),
      last_interaction_at: row.last_interaction_at ? String(row.last_interaction_at) : null,
    }))

    const party_members = (partyResult.results as Array<Record<string, unknown>>).map((row) => ({
      character_id: String(row.character_id ?? ''),
      name: String(row.name ?? 'Unknown'),
      character_type: String(row.character_type ?? 'npc'),
      kv_origin: row.kv_origin ? String(row.kv_origin) : null,
      role: String(row.role ?? 'member'),
      party_id: String(row.party_id ?? ''),
      party_name: String(row.party_name ?? ''),
    }))

    return c.json({ npc_relationships, party_members })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// ── Character inventory ───────────────────────────────────────────────────────

entityReads.get('/characters/:id/inventory', async (c) => {
  const db = c.env.RPG_DB
  /* c8 ignore next */
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const id = c.req.param('id')
    const result = await db
      .prepare(
        `
      SELECT ii.item_id, i.name, i.type, ii.quantity, ii.equipped, ii.slot, i.value, i.weight
      FROM inventory_items ii
      JOIN items i ON i.id = ii.item_id
      WHERE ii.character_id = ?
      ORDER BY ii.equipped DESC, i.name ASC
    `,
      )
      .bind(id)
      .all()

    const items = (result.results as Array<Record<string, unknown>>).map((row) => ({
      item_id: String(row.item_id ?? ''),
      name: String(row.name ?? 'Unknown'),
      type: String(row.type ?? ''),
      quantity: Number(row.quantity ?? 1),
      equipped: Boolean(row.equipped),
      slot: row.slot ? String(row.slot) : null,
      value: Number(row.value ?? 0),
      weight: Number(row.weight ?? 0),
    }))

    return c.json({ items, total: items.length })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// ── Locations (room_nodes) ───────────────────────────────────────────────────

function normaliseLocation(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? 'Unknown'),
    biome_context: row.biome_context ? String(row.biome_context) : null,
    base_description: row.base_description ? String(row.base_description) : null,
    visited_count: Number(row.visited_count ?? 0),
    last_visited_at: row.last_visited_at ? String(row.last_visited_at) : null,
    local_x: row.local_x !== undefined && row.local_x !== null ? Number(row.local_x) : null,
    local_y: row.local_y !== undefined && row.local_y !== null ? Number(row.local_y) : null,
    network_id: row.network_id ? String(row.network_id) : null,
  }
}

entityReads.get('/locations', async (c) => {
  const db = c.env.RPG_DB
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const result = await db
      .prepare(
        'SELECT id, name, biome_context, visited_count, last_visited_at FROM room_nodes ORDER BY name ASC LIMIT 100',
      )
      .all()
    const locations = (result.results as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id ?? ''),
      name: String(row.name ?? 'Unknown'),
      biome_context: row.biome_context ? String(row.biome_context) : null,
      visited_count: Number(row.visited_count ?? 0),
      last_visited_at: row.last_visited_at ? String(row.last_visited_at) : null,
    }))
    return c.json({ locations, total: locations.length })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

entityReads.get('/locations/:id', async (c) => {
  const db = c.env.RPG_DB
  /* c8 ignore next */
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const id = c.req.param('id')
    const row = (await db
      .prepare(
        'SELECT id, name, biome_context, base_description, visited_count, last_visited_at, local_x, local_y, network_id FROM room_nodes WHERE id = ? LIMIT 1',
      )
      .bind(id)
      .first()) as Record<string, unknown> | null
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ location: normaliseLocation(row) })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

entityReads.get('/locations/:id/occupants', async (c) => {
  const db = c.env.RPG_DB
  /* c8 ignore next */
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const id = c.req.param('id')
    const result = await db
      .prepare(
        'SELECT id, name, character_type, character_class, race, level, hp, max_hp, ac, alignment, background, faction_id, current_room_id, kv_origin FROM characters WHERE current_room_id = ? ORDER BY name ASC',
      )
      .bind(id)
      .all()
    const occupants = (result.results as Array<Record<string, unknown>>).map(normaliseCharacter)
    return c.json({ occupants, total: occupants.length })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// ── Nations ──────────────────────────────────────────────────────────────────

function normaliseNation(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? 'Unknown'),
    leader: String(row.leader ?? ''),
    ideology: String(row.ideology ?? ''),
    aggression: Number(row.aggression ?? 50),
    trust: Number(row.trust ?? 50),
    paranoia: Number(row.paranoia ?? 50),
    gdp: Number(row.gdp ?? 0),
  }
}

entityReads.get('/nations', async (c) => {
  const db = c.env.RPG_DB
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const result = await db
      .prepare(
        'SELECT id, name, leader, ideology, aggression, trust, paranoia, gdp FROM nations ORDER BY name ASC',
      )
      .all()
    const nations = (result.results as Array<Record<string, unknown>>).map(normaliseNation)
    return c.json({ nations, total: nations.length })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

entityReads.get('/nations/:id', async (c) => {
  const db = c.env.RPG_DB
  /* istanbul ignore next */
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const id = c.req.param('id')
    const row = (await db
      .prepare(
        'SELECT id, name, leader, ideology, aggression, trust, paranoia, gdp FROM nations WHERE id = ? LIMIT 1',
      )
      .bind(id)
      .first()) as Record<string, unknown> | null
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ nation: normaliseNation(row) })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// ── Regions ──────────────────────────────────────────────────────────────────

function normaliseRegion(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? 'Unknown'),
    type: String(row.type ?? ''),
    owner_nation_id: row.owner_nation_id ? String(row.owner_nation_id) : null,
    owner_nation_name: row.owner_nation_name ? String(row.owner_nation_name) : null,
  }
}

entityReads.get('/regions', async (c) => {
  const db = c.env.RPG_DB
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const result = await db
      .prepare('SELECT id, name, type, owner_nation_id FROM regions ORDER BY name ASC')
      .all()
    const regions = (result.results as Array<Record<string, unknown>>).map(normaliseRegion)
    return c.json({ regions, total: regions.length })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

entityReads.get('/regions/:id', async (c) => {
  const db = c.env.RPG_DB
  /* istanbul ignore next */
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const id = c.req.param('id')
    const row = (await db
      .prepare(
        `
      SELECT r.id, r.name, r.type, r.owner_nation_id, n.name AS owner_nation_name
      FROM regions r LEFT JOIN nations n ON n.id = r.owner_nation_id
      WHERE r.id = ? LIMIT 1
    `,
      )
      .bind(id)
      .first()) as Record<string, unknown> | null
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ region: normaliseRegion(row) })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// ── Quests ───────────────────────────────────────────────────────────────────

function normaliseQuest(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? 'Unknown'),
    description: String(row.description ?? ''),
    status: String(row.status ?? ''),
    giver: row.giver ? String(row.giver) : null,
  }
}

entityReads.get('/quests', async (c) => {
  const db = c.env.RPG_DB
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const result = await db
      .prepare(
        'SELECT id, name, description, status, giver FROM quests ORDER BY created_at DESC LIMIT 100',
      )
      .all()
    const quests = (result.results as Array<Record<string, unknown>>).map(normaliseQuest)
    return c.json({ quests, total: quests.length })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

entityReads.get('/quests/:id', async (c) => {
  const db = c.env.RPG_DB
  /* istanbul ignore next */
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const id = c.req.param('id')
    const row = (await db
      .prepare('SELECT id, name, description, status, giver FROM quests WHERE id = ? LIMIT 1')
      .bind(id)
      .first()) as Record<string, unknown> | null
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ quest: normaliseQuest(row) })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

entityReads.get('/quests/:id/log', async (c) => {
  const db = c.env.RPG_DB
  /* istanbul ignore next */
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const id = c.req.param('id')
    const result = await db
      .prepare(
        'SELECT id, note, created_at FROM quest_logs WHERE quest_id = ? ORDER BY created_at ASC',
      )
      .bind(id)
      .all()
    const entries = (result.results as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id ?? ''),
      note: String(row.note ?? ''),
      created_at: String(row.created_at ?? ''),
    }))
    return c.json({ entries, total: entries.length })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

entityReads.get('/quests/:id/milestones', async (c) => {
  const db = c.env.RPG_DB
  /* istanbul ignore next */
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const id = c.req.param('id')
    const result = await db
      .prepare(
        'SELECT id, quest_id, sort_order, title, notes, status, linked_entity_type, linked_entity_id, color, is_private, created_at, updated_at FROM quest_milestones WHERE quest_id = ? ORDER BY sort_order ASC',
      )
      .bind(id)
      .all()
    const milestones = (result.results as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id ?? ''),
      quest_id: String(row.quest_id ?? ''),
      sort_order: Number(row.sort_order ?? 0),
      title: String(row.title ?? ''),
      notes: row.notes ? String(row.notes) : null,
      status: String(row.status ?? 'pending'),
      linked_entity_type: row.linked_entity_type ? String(row.linked_entity_type) : null,
      linked_entity_id: row.linked_entity_id ? String(row.linked_entity_id) : null,
      color: row.color ? String(row.color) : null,
      is_private: Boolean(row.is_private ?? 0),
      created_at: String(row.created_at ?? ''),
      updated_at: String(row.updated_at ?? ''),
    }))
    return c.json({ milestones, total: milestones.length })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// ── Items ─────────────────────────────────────────────────────────────────────

function normaliseItem(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? 'Unknown'),
    type: String(row.type ?? ''),
    value: Number(row.value ?? 0),
    weight: Number(row.weight ?? 0),
  }
}

entityReads.get('/items', async (c) => {
  const db = c.env.RPG_DB
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const result = await db
      .prepare('SELECT id, name, type, value, weight FROM items ORDER BY name ASC LIMIT 100')
      .all()
    const items = (result.results as Array<Record<string, unknown>>).map(normaliseItem)
    return c.json({ items, total: items.length })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

entityReads.get('/items/:id', async (c) => {
  const db = c.env.RPG_DB
  /* istanbul ignore next */
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const id = c.req.param('id')
    const row = (await db
      .prepare('SELECT id, name, type, value, weight FROM items WHERE id = ? LIMIT 1')
      .bind(id)
      .first()) as Record<string, unknown> | null
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ item: normaliseItem(row) })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// ── Races ────────────────────────────────────────────────────────────────────

function normaliseRace(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? 'Unknown'),
    description: String(row.description ?? ''),
    is_extinct: Boolean(row.is_extinct ?? 0),
    parent_race_id: row.parent_race_id ? String(row.parent_race_id) : null,
  }
}

entityReads.get('/races', async (c) => {
  const db = c.env.RPG_DB
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const result = await db
      .prepare(
        'SELECT id, name, description, is_extinct, parent_race_id FROM races ORDER BY name ASC',
      )
      .all()
    const races = (result.results as Array<Record<string, unknown>>).map(normaliseRace)
    return c.json({ races, total: races.length })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

entityReads.get('/races/:id', async (c) => {
  const db = c.env.RPG_DB
  /* istanbul ignore next */
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const id = c.req.param('id')
    const row = (await db
      .prepare(
        'SELECT id, name, description, is_extinct, parent_race_id FROM races WHERE id = ? LIMIT 1',
      )
      .bind(id)
      .first()) as Record<string, unknown> | null
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ race: normaliseRace(row) })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// ── Journals (session logs) ──────────────────────────────────────────────────────

function normaliseJournal(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? 'Unknown'),
    date_year: row.date_year !== null && row.date_year !== undefined ? Number(row.date_year) : null,
    date_month:
      row.date_month !== null && row.date_month !== undefined ? Number(row.date_month) : null,
    date_day: row.date_day !== null && row.date_day !== undefined ? Number(row.date_day) : null,
    calendar_id: row.calendar_id ? String(row.calendar_id) : null,
    is_private: Boolean(row.is_private ?? 0),
    created_at: String(row.created_at ?? ''),
  }
}

function normaliseJournalDetail(row: Record<string, unknown>) {
  return {
    ...normaliseJournal(row),
    entry: String(row.entry ?? ''),
    updated_at: String(row.updated_at ?? ''),
  }
}

entityReads.get('/journals', async (c) => {
  const db = c.env.RPG_DB
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const result = await db
      .prepare(
        'SELECT id, name, date_year, date_month, date_day, calendar_id, is_private, created_at FROM journals ORDER BY date_year DESC, date_month DESC, date_day DESC LIMIT 100',
      )
      .all()
    const journals = (result.results as Array<Record<string, unknown>>).map(normaliseJournal)
    return c.json({ journals, total: journals.length })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

entityReads.get('/journals/:id', async (c) => {
  const db = c.env.RPG_DB
  /* istanbul ignore next */
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const id = c.req.param('id')
    const row = (await db
      .prepare(
        'SELECT id, name, entry, date_year, date_month, date_day, calendar_id, is_private, created_at, updated_at FROM journals WHERE id = ? LIMIT 1',
      )
      .bind(id)
      .first()) as Record<string, unknown> | null
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ journal: normaliseJournalDetail(row) })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

entityReads.get('/journals/:id/participants', async (c) => {
  const db = c.env.RPG_DB
  /* istanbul ignore next */
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const id = c.req.param('id')
    const result = await db
      .prepare(
        `
      SELECT jp.entity_type, jp.entity_id
      FROM journal_participants jp
      WHERE jp.journal_id = ?
      ORDER BY jp.created_at ASC
    `,
      )
      .bind(id)
      .all()

    // For each participant, fetch its name from the appropriate table
    const participants = await Promise.all(
      (result.results as Array<{ entity_type: string; entity_id: string }>).map(async (p) => {
        let entity_name = 'Unknown'
        try {
          if (p.entity_type === 'character') {
            const r = (await db
              .prepare('SELECT name FROM characters WHERE id = ? LIMIT 1')
              .bind(p.entity_id)
              .first()) as { name: string } | null
            if (r) entity_name = r.name
          } else if (p.entity_type === 'location') {
            const r = (await db
              .prepare('SELECT name FROM room_nodes WHERE id = ? LIMIT 1')
              .bind(p.entity_id)
              .first()) as { name: string } | null
            if (r) entity_name = r.name
          } else if (p.entity_type === 'quest') {
            const r = (await db
              .prepare('SELECT name FROM quests WHERE id = ? LIMIT 1')
              .bind(p.entity_id)
              .first()) as { name: string } | null
            if (r) entity_name = r.name
          } else if (p.entity_type === 'nation') {
            const r = (await db
              .prepare('SELECT name FROM nations WHERE id = ? LIMIT 1')
              .bind(p.entity_id)
              .first()) as { name: string } | null
            if (r) entity_name = r.name
          }
          /* istanbul ignore next -- defensive: name lookups above are simple SELECTs against known tables, not expected to throw */
        } catch {
          // no-op: leave entity_name as 'Unknown'
        }
        return {
          entity_type: p.entity_type,
          entity_id: p.entity_id,
          entity_name,
        }
      }),
    )

    return c.json({ participants, total: participants.length })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// ── Entity relations ──────────────────────────────────────────────────────────

const ENTITY_TYPE_SLUGS = new Set([
  'characters',
  'locations',
  'nations',
  'regions',
  'quests',
  'items',
  'races',
  'journals',
])

function normaliseRelation(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    from_type: String(row.from_type ?? ''),
    from_id: String(row.from_id ?? ''),
    to_type: String(row.to_type ?? ''),
    to_id: String(row.to_id ?? ''),
    relation_type: String(row.relation_type ?? ''),
    attitude: row.attitude !== null && row.attitude !== undefined ? Number(row.attitude) : null,
    is_bidirectional: Boolean(row.is_bidirectional ?? 1),
    color: row.color ? String(row.color) : null,
    is_pinned: Boolean(row.is_pinned),
    is_private: Boolean(row.is_private),
    notes: row.notes ? String(row.notes) : null,
    created_at: String(row.created_at ?? ''),
  }
}

// GET /api/entities/:type/:id/relations — all relations for an entity (both directions merged)
entityReads.get('/:type/:id/relations', async (c) => {
  const db = c.env.RPG_DB
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)

  const typeSlug = c.req.param('type')
  if (!ENTITY_TYPE_SLUGS.has(typeSlug)) {
    return c.json({ error: `Unknown entity type: ${typeSlug}` }, 400)
  }

  try {
    const id = c.req.param('id')
    // Merge both directions: entity is from OR to (bidirectional merge)
    const result = await db
      .prepare(
        `
      SELECT id, from_type, from_id, to_type, to_id, relation_type,
             attitude, is_bidirectional, color, is_pinned, is_private, notes, created_at
      FROM entity_relations
      WHERE (from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?)
      ORDER BY is_pinned DESC, created_at ASC
    `,
      )
      .bind(typeSlug, id, typeSlug, id)
      .all()

    const relations = (result.results as Array<Record<string, unknown>>).map(normaliseRelation)
    return c.json({ relations, total: relations.length })
  } catch (e) {
    /* istanbul ignore next */
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

export { normaliseRelation }
export default entityReads
