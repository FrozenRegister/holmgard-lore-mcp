-- Weather lazy-population (#364): per-world/day weather forecasts.
-- The MCP is a cache, never an oracle. When weather is not cached, return a
-- structured gap for the narrator to fill. The narrator fills it; the MCP stores it.
-- See src/rpg/handlers/weather-manage.ts for the handler.

CREATE TABLE IF NOT EXISTS weather_log (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  season TEXT NOT NULL DEFAULT 'spring',
  weather TEXT NOT NULL DEFAULT 'clear',       -- 'storm' | 'rain' | 'overcast' | 'clear'
  fog INTEGER NOT NULL DEFAULT 0,
  encounter_modifier INTEGER DEFAULT NULL,
  movement_modifier INTEGER DEFAULT NULL,
  -- Extended weather fields (per #364 issue spec):
  temperature_high REAL DEFAULT NULL,          -- °C
  temperature_low REAL DEFAULT NULL,           -- °C
  conditions TEXT DEFAULT NULL,                -- 'overcast', 'rain', 'fog', 'clear', 'storm'
  wind_speed REAL DEFAULT NULL,                -- kph
  wind_direction TEXT DEFAULT NULL,            -- 'NW', 'SE', etc.
  precipitation_chance REAL DEFAULT NULL,      -- 0.0–1.0
  precipitation_type TEXT DEFAULT NULL,        -- 'rain', 'sleet', 'snow', 'none'
  humidity REAL DEFAULT NULL,                  -- 0.0–1.0
  visibility TEXT DEFAULT NULL,                -- 'unlimited', 'moderate', 'poor', 'nil'
  source TEXT NOT NULL DEFAULT 'narrator',     -- 'narrator' | 'system' | 'production'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE,
  UNIQUE(world_id, day)
);

CREATE INDEX IF NOT EXISTS idx_weather_log_world_day ON weather_log(world_id, day);