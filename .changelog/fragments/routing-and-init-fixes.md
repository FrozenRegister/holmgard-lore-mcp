### Fix — rpg sub routing/init bug cluster (#330, #335, #336)

- `world.create`/`world.generate` now seed a `world_state` row automatically (#330) — previously `time.get_date`/`get_age`/`advance` failed with `"No world_state found"` for any newly-created world. Adds `seedWorldState()` (time-manage.ts) and migration `0022_backfill_world_state.sql` to backfill existing worlds.
- `rpg{sub:"stealth"}` is now a working alias for `rpg{sub:"perception"}`'s `stealth_check` action (#335) — the handler was never a separate subsystem, it just wasn't registered under the name narrators reach for.
- `time.get_date`/`timeline.get_events` now accept camelCase `worldId` in addition to their historical snake_case `world_id` (#336) — the last two subs still requiring snake_case.
- Investigated #331/#332/#333/#334 (D1_ERROR: missing table/column for encounter/resource/broadcast/biome) — all four were already fixed by unrelated prior work; closed as stale rather than re-fixed.
- Documented a separately-discovered MCP-transport issue (numeric arguments arriving stringified over at least one connected client) in `docs/holmgard-user-guide.md` — not fixed here since it's client-side, not a handler bug.
