### rpg time: agent-ownership clock lock (#312)

- `world_state` gains `time_owner` / `time_owner_since` (migration `0036_time_owner.sql`). `rpg{sub:"time"}` gains `set_owner` (claim, or release via `owner: null`) and `get_owner` actions.
- `advance` accepts an optional `owner` param identifying the calling agent. If the clock is unowned, an identified caller implicitly claims it. If owned by a *different* identified caller, `advance` is rejected. Callers that don't pass `owner` (existing behavior) advance unguarded — this is opt-in, not a breaking change.
- Redesigned from the issue's original `time_mode` (`narrative`/`tactical`) proposal after narrator Q&A on #312 established there is no tactical-combat agent — the real dual-agent case is two narrative-mode agents (Archisector: early eras; Calder Architect: later eras) sharing one world's timeline at different granularities. A binary mode doesn't fit that; a simple ownership lock does.
- Scoped to `world_state` (not the `universes` table from #308 Phase 1) because `time.advance` operates on `world_id`, and `universes` currently has no MCP CRUD surface to link a world to one.
- Also corrected the `rpg` tool's `time` sub schema advertisement in `src/index.ts`, which had drifted from the handler's real action set.
