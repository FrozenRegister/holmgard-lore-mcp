### refactor: typed handlers — continuity (continuity_manage) PR 1/2

- Converts `continuity_manage` event/changelog handlers to typed args using the pattern from #237
- Extracts Zod schemas for 5 event handlers: `append_event`, `get_event_log`, `canonize`, `migrate_events`, `recent_changes`
- Updates handler signatures to use `TypedToolHandler<Schema>` for compile-time type safety
- Applies alias normalization via schema `.transform().pipe()` for `append_event` (aliases: `date` → `at`, `description` → `detail`)
  - Fixes: `appendEventSchema` now includes alias fields in first validation so transforms can apply before pipe validation
- Removes redundant per-handler schema parsing; parse-once at dispatcher boundary via `makeActionDispatcher`
- Remaining 10 setup/continuity handlers kept as legacy (to be refactored in PR 2)
- Improves test context: adds mock `env.LORE_DB` binding to tests so handlers can execute without errors
- All tests pass; 100% patch coverage maintained

