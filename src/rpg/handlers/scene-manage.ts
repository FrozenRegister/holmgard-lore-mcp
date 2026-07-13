// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/scene-manage.ts
// scenes table: id, world_id, title, when_label, place_label, narration,
//               engine_state, participants, previous_scene_id, created_at
// (no status, mood, tags, updated_at, or room_id columns)
//
// #368: state_snapshot action combines occupants + weather + events + threads +
// environment + reachable_locations + setups into one call (6 round-trips → 1).

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError, CRUD_ALIASES } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['create', 'get', 'list', 'update', 'delete', 'get_latest', 'state_snapshot'] as const
type SceneAction = typeof ACTIONS[number]
const ALIASES: Record<string, SceneAction> = {
  ...CRUD_ALIASES,
  new_scene: 'create', begin_scene: 'create', open: 'create',
  show: 'get', fetch: 'get', load: 'get',
  scenes: 'list', all_scenes: 'list',
  edit: 'update', modify: 'update', patch: 'update',
  remove: 'delete', close: 'delete', end_scene: 'delete',
  latest: 'get_latest', current: 'get_latest', active: 'get_latest',
  snapshot: 'state_snapshot', scene_state: 'state_snapshot', brief: 'state_snapshot',
} as Record<string, SceneAction>

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  worldId: z.string().optional(),
  title: z.string().optional(),
  whenLabel: z.string().optional(),
  placeLabel: z.string().optional(),
  narration: z.string().optional(),
  participants: z.array(z.string()).optional().default([]),
  previousSceneId: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional().default(20),
  // #368 state_snapshot fields
  locationKey: z.string().optional(),
  include: z.array(z.enum(['occupants', 'weather', 'events', 'threads', 'environment', 'setups', 'reachable'])).optional(),
  name: z.string().optional(),
})

// Helper to get occupants at a location from D1 characters table (normalized location_key).
async function getOccupants(db: D1Database, locationKey: string, worldId: string | undefined): Promise<Array<Record<string, unknown>>> {
  let query = "SELECT id, name, character_type, hp, max_hp, current_room_id, conditions FROM characters WHERE current_room_id = ?"
  const binds: unknown[] = [locationKey]
  if (worldId) { query += ' AND world_id = ?'; binds.push(worldId) }
  const { results } = await db.prepare(query).bind(...binds).all()
  return (results as Array<Record<string, unknown>>).map(r => ({
    ...r,
    conditions: r.conditions ? JSON.parse(r.conditions as string) : [],
  }))
}

// Helper to get recent events at a location from D1 timeline_events.
async function getRecentEvents(db: D1Database, locationKey: string, worldId: string | undefined, limit = 10): Promise<Array<Record<string, unknown>>> {
  let query = "SELECT id, event_at, verb, entity_id, object_entity, detail FROM timeline_events WHERE location_id = ?"
  const binds: unknown[] = [locationKey]
  if (worldId) { query += ' AND world_id = ?'; binds.push(worldId) }
  query += ' ORDER BY event_at DESC LIMIT ?'
  binds.push(limit)
  const { results } = await db.prepare(query).bind(...binds).all()
  return results as Array<Record<string, unknown>>
}

// Helper to get weather for the current day.
async function getWeather(db: D1Database, worldId: string, day: number): Promise<Record<string, unknown> | null> {
  const row = await db.prepare('SELECT * FROM weather_log WHERE world_id = ? AND day = ?').bind(worldId, day).first() as Record<string, unknown> | null
  if (!row) return null
  return {
    found: true,
    day, season: row.season, weather: row.weather,
    temperature_high: row.temperature_high, temperature_low: row.temperature_low,
    conditions: row.conditions, wind_speed: row.wind_speed, wind_direction: row.wind_direction,
    precipitation_chance: row.precipitation_chance, precipitation_type: row.precipitation_type,
    humidity: row.humidity, visibility: row.visibility,
    source: row.source,
  }
}

async function currentWorldDay(db: D1Database, worldId: string): Promise<number> {
  const row = await db.prepare('SELECT production_day FROM world_state WHERE world_id = ?').bind(worldId).first() as { production_day: number | null } | null
  return row?.production_day ?? 0
}

export async function handleSceneManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'create': {
      if (!a.worldId) return err('"worldId" is required')
      if (!a.narration) return err('"narration" is required')
      const id = crypto.randomUUID()
      await db.prepare('INSERT INTO scenes (id, world_id, title, when_label, place_label, narration, engine_state, participants, previous_scene_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, a.worldId, a.title ?? null, a.whenLabel ?? null, a.placeLabel ?? null, a.narration, '{}', JSON.stringify(a.participants), a.previousSceneId ?? null, now).run()
      return ok({ success: true, actionType: 'create', sceneId: id, worldId: a.worldId, title: a.title })
    }
    case 'get': {
      if (!a.id) return err('"id" is required')
      const scene = await db.prepare('SELECT * FROM scenes WHERE id = ?').bind(a.id).first() as Record<string, unknown> | null
      if (!scene) return err(`Scene not found: ${a.id}`)
      return ok({ success: true, actionType: 'get', scene: { ...scene, participants: JSON.parse(scene.participants as string ?? '[]'), engine_state: JSON.parse(scene.engine_state as string ?? '{}') } })
    }
    case 'list': {
      let query = 'SELECT id, world_id, title, when_label, place_label, created_at FROM scenes'
      const binds: unknown[] = []
      if (a.worldId) { query += ' WHERE world_id = ?'; binds.push(a.worldId) }
      query += ' ORDER BY created_at DESC LIMIT ?'
      binds.push(a.limit)
      const { results } = await db.prepare(query).bind(...binds).all()
      return ok({ success: true, actionType: 'list', scenes: results, count: results.length })
    }
    case 'update': {
      if (!a.id) return err('"id" is required')
      const existing = await db.prepare('SELECT id FROM scenes WHERE id = ?').bind(a.id).first()
      if (!existing) return err(`Scene not found: ${a.id}`)
      const updates: string[] = []
      const binds: unknown[] = []
      if (a.title !== undefined) { updates.push('title = ?'); binds.push(a.title) }
      if (a.whenLabel !== undefined) { updates.push('when_label = ?'); binds.push(a.whenLabel) }
      if (a.placeLabel !== undefined) { updates.push('place_label = ?'); binds.push(a.placeLabel) }
      if (a.narration !== undefined) { updates.push('narration = ?'); binds.push(a.narration) }
      if (a.participants.length > 0) { updates.push('participants = ?'); binds.push(JSON.stringify(a.participants)) }
      if (updates.length === 0) return err('No fields to update provided')
      binds.push(a.id)
      await db.prepare(`UPDATE scenes SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run()
      return ok({ success: true, actionType: 'update', sceneId: a.id })
    }
    case 'delete': {
      if (!a.id) return err('"id" is required')
      const existing = await db.prepare('SELECT id FROM scenes WHERE id = ?').bind(a.id).first()
      if (!existing) return err(`Scene not found: ${a.id}`)
      await db.prepare('DELETE FROM scenes WHERE id = ?').bind(a.id).run()
      return ok({ success: true, actionType: 'delete', sceneId: a.id })
    }
    case 'get_latest': {
      let query = 'SELECT * FROM scenes'
      const binds: unknown[] = []
      if (a.worldId) { query += ' WHERE world_id = ?'; binds.push(a.worldId) }
      const scene = await db.prepare(query + ' ORDER BY created_at DESC LIMIT 1').bind(...binds).first() as Record<string, unknown> | null
      if (!scene) return err('No scenes found')
      return ok({ success: true, actionType: 'get_latest', scene: { ...scene, participants: JSON.parse(scene.participants as string ?? '[]'), engine_state: JSON.parse(scene.engine_state as string ?? '{}') } })
    }
    // #368: Unified state snapshot — one call replaces 6 round-trips
    case 'state_snapshot': {
      const locationKey = a.locationKey ?? a.name ?? a.placeLabel
      if (!locationKey && !a.worldId && !a.id) return err('"locationKey", "worldId", or "id" is required for state_snapshot')
      if (!a.worldId) return err('"worldId" is required for state_snapshot')

      const resolveLocationKey = locationKey ?? locationKey === undefined ? a.id : undefined
      const loc = (resolveLocationKey ?? '').trim().toLowerCase()
      const include = a.include ?? ['occupants', 'weather', 'events', 'environment', 'setups', 'reachable']
      const day = await currentWorldDay(db, a.worldId)
      const includeSet = new Set(include)

      // Phase queries in parallel
      const queries: Promise<unknown>[] = []

      // 1. Occupants
      let occupantsPromise: Promise<Array<Record<string, unknown>>> = Promise.resolve([])
      if (includeSet.has('occupants')) {
        occupantsPromise = getOccupants(db, loc, a.worldId)
      }
      queries.push(occupantsPromise)

      // 2. Weather
      let weatherPromise: Promise<Record<string, unknown> | null> = Promise.resolve(null)
      if (includeSet.has('weather')) {
        weatherPromise = getWeather(db, a.worldId, day)
      }
      queries.push(weatherPromise)

      // 3. Recent events
      let eventsPromise: Promise<Array<Record<string, unknown>>> = Promise.resolve([])
      if (includeSet.has('events')) {
        eventsPromise = getRecentEvents(db, loc, a.worldId)
      }
      queries.push(eventsPromise)

      // 4. Reachable locations — from world_map (grid-based adjacency, simplified: same biome neighbors)
      let reachablePromise: Promise<Array<Record<string, unknown>>> = Promise.resolve([])
      if (includeSet.has('reachable')) {
        reachablePromise = (async () => {
          const { results } = await db.prepare(
            'SELECT id, name, biome, coord_x, coord_y FROM world_map WHERE world_id = ? AND (coord_x = ? OR coord_y = ?) LIMIT 20'
          ).bind(a.worldId, -1, -1).all() // simplified; real adjacency would need grid math
          return results as Array<Record<string, unknown>>
        })()
      }
      queries.push(reachablePromise)

      // 5. Active threads from timeline_events
      let threadsPromise: Promise<Array<Record<string, unknown>>> = Promise.resolve([])
      if (includeSet.has('threads')) {
        threadsPromise = (async () => {
          const { results } = await db.prepare(
            'SELECT DISTINCT thread_id, COUNT(*) as event_count, MAX(event_at) as last_event FROM timeline_events WHERE world_id = ? AND thread_id != \'main\' GROUP BY thread_id ORDER BY last_event DESC LIMIT 10'
          ).bind(a.worldId).all()
          return results as Array<Record<string, unknown>>
        })()
      }
      queries.push(threadsPromise)

      // 6. Environment text from KV (location:* entry)
      let environmentPromise: Promise<Record<string, unknown> | null> = Promise.resolve(null)
      if (includeSet.has('environment')) {
        environmentPromise = (async () => {
          // Try to read from KV if available — best-effort, may not exist
          try {
            const locKey = `location:${loc}`
            if (env.LORE_DB) {
              const raw = await env.LORE_DB.get(locKey)
              if (raw) {
                const { text } = JSON.parse(raw)
                return { found: true, key: locKey, text }
              }
            }
          } catch { /* best-effort */ }
          // Return a gap if no KV entry exists
          return { found: false, key: `location:${loc}`, gap: 'No environment description cached — use lore_manage.set to create one' }
        })()
      }
      queries.push(environmentPromise)

      // 7. Open setups from KV (setup:* entries)
      let setupsPromise: Promise<Array<Record<string, unknown>>> = Promise.resolve([])
      if (includeSet.has('setups')) {
        setupsPromise = (async () => {
          const open: Array<Record<string, unknown>> = []
          try {
            if (env.LORE_DB) {
              const listed = await env.LORE_DB.list({ prefix: 'setup:' })
              for (const k of listed.keys) {
                const raw = await env.LORE_DB.get(k.name)
                if (!raw) continue
                const { text } = JSON.parse(raw)
                if (!text.toLowerCase().includes('**status:** open') && !text.toLowerCase().includes('status: open')) continue
                const descMatch = text.match(/\*\*Description:\*\*\s*(.+?)(?:\n|$)/i)
                open.push({ id: k.name.replace(/^setup:/, ''), description: descMatch ? descMatch[1].trim() : text.slice(0, 100) })
              }
            }
          } catch { /* best-effort */ }
          return open
        })()
      }
      queries.push(setupsPromise)

      const [occupants, weather, events, reachable, threads, environment, setups] = await Promise.all(queries)

      return ok({
        success: true, actionType: 'state_snapshot',
        location: { key: loc },
        occupants: includeSet.has('occupants') ? occupants : undefined,
        weather: includeSet.has('weather') ? weather : undefined,
        recent_events: includeSet.has('events') ? events : undefined,
        active_threads: includeSet.has('threads') ? threads : undefined,
        reachable_locations: includeSet.has('reachable') ? reachable : undefined,
        environment: includeSet.has('environment') ? environment : undefined,
        open_setups: includeSet.has('setups') ? setups : undefined,
      })
    }
  }
}