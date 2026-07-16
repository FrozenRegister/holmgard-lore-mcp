### rpg scene / conflict_type: conflict-type taxonomy for dual-agent routing (#316)

- New D1 table `conflict_types` (migration `0035_conflict_types.sql`), a global (not per-world) taxonomy seeded with `physical` (resolver: `combat`), `social` (resolver: `drama`), and `hybrid` (resolver: `both`). Runtime-extensible via the new `rpg{sub:"conflict_type"}` sub: `list`, `create`, `update`, `delete`.
- `scenes` gains `conflict_type_id` (nullable FK). `rpg{sub:"scene"}` gains `set_conflict_type` (set or clear, pass `null`) and `get_conflict_type` actions.
- This MCP records the taxonomy but cannot enforce agent-side routing — which agent(s) act on a scene based on its `resolver` is a convention the calling agent(s) honor, same as #312's time-mode coordination.
