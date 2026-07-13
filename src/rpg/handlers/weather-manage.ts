// Weather lazy-population (#364) — rpg({ sub: "weather", action: "get_forecast" | "set_forecast" | "list_forecasts" }).
// Design pattern: the MCP is a cache, never an oracle. When weather is not cached,
// return a structured gap with enough context for the narrator to generate a coherent
// answer. The narrator fills it; the MCP stores it; next query returns the canonical answer.
//
// Example flow:
//   get_forecast(worldId, day)  → { found: false, gap: { needed: [...], context: {...} } }
//   set_forecast(worldId, day, ...)  → stored
//   get_forecast(worldId, day)  → { found: true, temperature_high: 8, ... }

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['get_forecast', 'set_forecast', 'list_forecasts'] as const
type WeatherAction = typeof ACTIONS[number]
const ALIASES: Record<string, WeatherAction> = {
  get: 'get_forecast', forecast: 'get_forecast', weather: 'get_forecast',
  set: 'set_forecast', override: 'set_forecast',
  list: 'list_forecasts', forecasts: 'list_forecasts',
} as Record<string, WeatherAction>

const WEATHER_CONDITIONS = ['storm', 'rain', 'overcast', 'clear'] as const

const InputSchema = z.object({
  action: z.string(),
  worldId: z.string().min(1),
  day: z.number().int().min(0).optional(),
  season: z.string().optional(),
  // set_forecast fields (all optional — the narrator fills what they decide):
  temperatureHigh: z.number().optional(),
  temperatureLow: z.number().optional(),
  conditions: z.enum(WEATHER_CONDITIONS).optional(),
  windSpeed: z.number().optional(),
  windDirection: z.string().optional(),
  precipitationChance: z.number().min(0).max(1).optional(),
  precipitationType: z.enum(['rain', 'sleet', 'snow', 'none']).optional(),
  humidity: z.number().min(0).max(1).optional(),
  visibility: z.enum(['unlimited', 'moderate', 'poor', 'nil']).optional(),
  source: z.string().optional().default('narrator'),
  limit: z.number().int().min(1).max(100).optional().default(30),
  // Legacy simplified fields (mapped to conditions internally):
  weather: z.enum(WEATHER_CONDITIONS).optional(),
  fog: z.boolean().optional(),
  encounterModifier: z.number().int().optional(),
  movementModifier: z.number().int().optional(),
})

function seasonFromDate(dateStr: string): string {
  const month = parseInt(dateStr.split('-')[1] ?? '1', 10)
  if (month <= 2 || month === 12) return 'winter'
  if (month <= 5) return 'spring'
  if (month <= 8) return 'summer'
  return 'autumn'
}

async function currentWorldDay(db: D1Database, worldId: string): Promise<number> {
  const row = await db.prepare('SELECT production_day FROM world_state WHERE world_id = ?').bind(worldId).first() as { production_day: number | null } | null
  return row?.production_day ?? 0
}

async function currentWorldDate(db: D1Database, worldId: string): Promise<string | null> {
  const row = await db.prepare('SELECT "current_date" FROM world_state WHERE world_id = ?').bind(worldId).first() as { current_date: string | null } | null
  return row?.current_date ?? null
}

// Fetch recent weather entries to provide narrative context for gaps.
async function recentWeatherContext(db: D1Database, worldId: string, limit = 3): Promise<Array<Record<string, unknown>>> {
  const { results } = await db.prepare(
    'SELECT day, conditions, temperature_high, temperature_low, wind_speed, wind_direction, precipitation_type FROM weather_log WHERE world_id = ? ORDER BY day DESC LIMIT ?'
  ).bind(worldId, limit).all()
  return results as Array<Record<string, unknown>>
}

export async function handleWeatherManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  const world = await db.prepare('SELECT id FROM worlds WHERE id = ?').bind(a.worldId).first()
  if (!world) return err(`World not found: ${a.worldId}`)

  switch (match.matched) {
    case 'get_forecast': {
      const day = a.day ?? await currentWorldDay(db, a.worldId)
      const row = await db.prepare('SELECT * FROM weather_log WHERE world_id = ? AND day = ?').bind(a.worldId, day).first() as Record<string, unknown> | null

      if (row) {
        return ok({
          found: true,
          day, season: row.season, weather: row.weather,
          temperature_high: row.temperature_high, temperature_low: row.temperature_low,
          conditions: row.conditions, wind_speed: row.wind_speed, wind_direction: row.wind_direction,
          precipitation_chance: row.precipitation_chance, precipitation_type: row.precipitation_type,
          humidity: row.humidity, visibility: row.visibility,
          fog: Boolean(row.fog), encounter_modifier: row.encounter_modifier, movement_modifier: row.movement_modifier,
          source: row.source,
        })
      }

      // Gap: return structured request for narrator to fill
      const dateStr = await currentWorldDate(db, a.worldId) ?? now.slice(0, 10)
      const season = a.season ?? seasonFromDate(dateStr)
      const recent = await recentWeatherContext(db, a.worldId)

      return ok({
        found: false,
        gap: {
          needed: ['temperature_high', 'temperature_low', 'conditions', 'wind_speed', 'wind_direction', 'precipitation_chance', 'precipitation_type', 'humidity', 'visibility'],
          context: {
            season,
            day,
            biome: 'limestone_karst', // Default; narrator can override
            date: dateStr,
            recent_weather: recent.map(r => `${r.day}: ${r.conditions ?? 'unknown'} (high ${r.temperature_high ?? '?'}°C, low ${r.temperature_low ?? '?'}°C, ${r.wind_speed ?? '?'}kph ${r.wind_direction ?? '?'})`),
          },
        },
      })
    }

    case 'set_forecast': {
      const day = a.day ?? await currentWorldDay(db, a.worldId)
      const dateStr = await currentWorldDate(db, a.worldId) ?? now.slice(0, 10)
      const season = a.season ?? seasonFromDate(dateStr)

      // Accept both new-style (conditions) and legacy (weather) field names
      const conditions = a.conditions ?? a.weather ?? null
      const temperatureHigh = a.temperatureHigh ?? null
      const temperatureLow = a.temperatureLow ?? null
      const windSpeed = a.windSpeed ?? null
      const windDirection = a.windDirection ?? null
      const precipitationChance = a.precipitationChance ?? null
      const precipitationType = a.precipitationType ?? null
      const humidity = a.humidity ?? null
      const visibility = a.visibility ?? null
      const fog = a.fog ?? false
      const encounterModifier = a.encounterModifier ?? null
      const movementModifier = a.movementModifier ?? null
      const source = a.source ?? 'narrator'

      const id = crypto.randomUUID()
      await db.prepare(
        `INSERT INTO weather_log (id, world_id, day, season, weather, fog, encounter_modifier, movement_modifier,
           temperature_high, temperature_low, conditions, wind_speed, wind_direction,
           precipitation_chance, precipitation_type, humidity, visibility, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(world_id, day) DO UPDATE SET
           season = excluded.season,
           weather = excluded.weather,
           fog = excluded.fog,
           encounter_modifier = excluded.encounter_modifier,
           movement_modifier = excluded.movement_modifier,
           temperature_high = excluded.temperature_high,
           temperature_low = excluded.temperature_low,
           conditions = excluded.conditions,
           wind_speed = excluded.wind_speed,
           wind_direction = excluded.wind_direction,
           precipitation_chance = excluded.precipitation_chance,
           precipitation_type = excluded.precipitation_type,
           humidity = excluded.humidity,
           visibility = excluded.visibility,
           source = excluded.source,
           updated_at = excluded.updated_at`
      ).bind(
        id, a.worldId, day, season, conditions, fog ? 1 : 0, encounterModifier, movementModifier,
        temperatureHigh, temperatureLow, conditions, windSpeed, windDirection,
        precipitationChance, precipitationType, humidity, visibility, source, now, now
      ).run()

      return ok({
        success: true, actionType: 'set_forecast', worldId: a.worldId, day,
        season, conditions, temperatureHigh, temperatureLow, windSpeed, windDirection,
        precipitationChance, precipitationType, humidity, visibility, source,
      })
    }

    case 'list_forecasts': {
      const { results } = await db.prepare('SELECT * FROM weather_log WHERE world_id = ? ORDER BY day DESC LIMIT ?').bind(a.worldId, a.limit).all()
      return ok({ success: true, actionType: 'list_forecasts', worldId: a.worldId, count: results.length, forecasts: results })
    }
  }
}