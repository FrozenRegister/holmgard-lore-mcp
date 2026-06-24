// src/api/entity-reads.ts — REST GET endpoints for entity list reads from D1
// GET /api/entities/characters, /locations, /nations, /regions, /quests, /items
// No auth required — consistent with /mcp being open.

import { Hono } from 'hono'
import type { AppBindings } from '../types'

const entityReads = new Hono<{ Bindings: AppBindings }>()

// ── Characters ───────────────────────────────────────────────────────────────

entityReads.get('/characters', async (c) => {
  const db = c.env.RPG_DB
  if (!db) return c.json({ error: 'RPG_DB unavailable' }, 503)
  try {
    const result = await db.prepare(
      'SELECT id, name, character_type, character_class, race, level, hp, max_hp, faction_id, kv_origin FROM characters ORDER BY name ASC LIMIT 100'
    ).all()
    const characters = (result.results as Array<Record<string, unknown>>).map(row => ({
      id: String(row.id ?? ''),
      name: String(row.name ?? 'Unknown'),
      character_type: String(row.character_type ?? 'npc'),
      character_class: String(row.character_class ?? 'fighter'),
      race: String(row.race ?? 'Human'),
      level: Number(row.level ?? 1),
      hp: Number(row.hp ?? 0),
      max_hp: Number(row.max_hp ?? 0),
      faction_id: row.faction_id ? String(row.faction_id) : null,
      kv_origin: row.kv_origin ? String(row.kv_origin) : null,
    }))
    return c.json({ characters, total: characters.length })
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
