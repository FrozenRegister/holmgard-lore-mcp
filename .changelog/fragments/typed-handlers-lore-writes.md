### Typed Handlers — Lore Write-Side (completes #238)
- Converted the remaining `lore_manage` write-side actions (`set`, `delete`, `patch`, `batch_set`, `batch_mutate`, `restore`, `history`, `increment`, `append_section` — all in `src/tools/lore.ts`) plus `handle_move_entity` to the typed `ActionSpec`/`TypedToolContext` pattern from #237.
- `lore-manage.ts`'s `ACTION_MAP` is now fully typed — no more legacy raw `ToolHandler` entries.
- `entity-manage.ts`'s `move` action (which dispatches the now-typed `handle_move_entity`) is also converted; the rest of `entity-manage.ts` stays legacy pending #239.
- Pure refactor — no behavior change, error messages and example payloads unchanged.
