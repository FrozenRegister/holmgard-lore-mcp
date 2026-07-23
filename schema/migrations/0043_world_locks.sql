-- Migration 0043: D1-backed world-level tick lock (#512)
-- Replaces the in-memory WORLD_LOCKS Map in src/rpg/handlers/tick-hooks.ts, which
-- only serialized concurrent time.advance calls when routed through the
-- HolmgardMCP Durable Object (the Streamable HTTP transport path). The separate
-- "legacy hand-rolled JSON-RPC" handler (app.post('/mcp') in src/index.ts)
-- dispatches the identical tools/call handlers directly from whatever Worker
-- isolate received the request, never touching the DO — for that path (used by
-- every test in this repo, and plausibly most real callers) the in-memory Map
-- provided zero cross-isolate protection. A D1 row is a single source of truth
-- regardless of which isolate or transport handles the request.

CREATE TABLE IF NOT EXISTS world_locks (
  world_id   TEXT PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,
  holder_id  TEXT NOT NULL,
  expires_at DATETIME NOT NULL
);

-- Notes on schema design:
-- 1. world_id is the primary key — one active lock row per world, acquired via
--    an atomic conditional UPSERT (see acquireWorldLock in tick-hooks.ts):
--    INSERT ... ON CONFLICT(world_id) DO UPDATE ... WHERE expires_at <= ?
--    The WHERE clause is the actual lock check — the UPDATE only applies (and
--    only then does meta.changes report a row touched) when the existing lock
--    has already expired, mirroring the same pattern setClaim() uses (#444).
-- 2. expires_at is a real DATETIME with a short TTL (see acquireWorldLock),
--    so an abandoned lock (e.g. a crashed request) self-heals instead of
--    permanently blocking that world's ticks.
-- 3. No trigger or cleanup job needed — expired rows are simply overwritten
--    on the next acquisition attempt for that world_id.
