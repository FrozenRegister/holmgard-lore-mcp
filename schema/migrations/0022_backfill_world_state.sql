-- Migration 0022: backfill missing world_state rows (#330).
--
-- world_manage.create/generate never seeded a world_state row (unlike
-- biomes/zone-types, which do get auto-seeded on world creation) — see the
-- application-code fix in time-manage.ts (seedWorldState, now called from
-- world-manage.ts's create/generate). This migration is the one-time
-- backfill for worlds created before that fix: every world_state column
-- besides world_id has a DEFAULT or is nullable, so a bare insert per
-- missing world is safe and requires no narrative-data guessing.

INSERT INTO world_state (world_id)
SELECT w.id FROM worlds w
LEFT JOIN world_state ws ON ws.world_id = w.id
WHERE ws.world_id IS NULL;
