### Typed Handlers — Lore & System Read-Side
- Converted the `lore_manage` read-side actions (`get`, `get_batch`, `get_section`, `list`, `list_maps`, `get_map`, `search`, `validate` — all in `src/tools/system.ts`) to the typed `ActionSpec`/`TypedToolContext` pattern from #237.
- `makeActionDispatcher` now accepts a mixed map of typed `ActionSpec` entries and legacy raw `ToolHandler` entries, so `lore-manage.ts` can pair the now-typed `system.ts` read-side with the not-yet-converted `lore.ts` write-side in the same `ACTION_MAP` without requiring an atomic whole-file conversion.
- `handle_list_topics` and `handle_list_maps` previously read `args.limit`/`args.offset` with no validation at all (bare `as number` casts); they now go through a proper Zod schema at the dispatch boundary.
- Pure refactor otherwise — no behavior change to any other action.
