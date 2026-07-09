### refactor: typed handlers — continuity_manage (continuity_manage) PR 2/2

- Converts remaining 10 setup/continuity handlers to typed args using the pattern from #237
- Extracts Zod schemas for 10 handlers: `tag_topic`, `find_by_tag`, `list_tags`, `bookmark_state`, `world_diff`, `plant_setup`, `pay_off_setup`, `list_unpaid_setups`, `set_goal`, `check_continuity`
- Updates handler signatures to use `TypedToolHandler<Schema>` for compile-time type safety
- Applies alias normalization via schema `.transform().pipe()`:
  - `plant_setup`: alias `setup_id` → `id`
  - `set_goal`: aliases `entity_name` → `entity_key`, `goal_name` → `goal_id`, `goal_description` → `description`
  - `check_continuity`: custom severity_floor aliases (low→info, medium/moderate→warn, high/critical→error)
- Removes per-handler schema validation; centralizes parse-once at dispatcher boundary via `makeActionDispatcher`
- All 15 continuity_manage handlers now use typed handlers pattern (completes #242)
- Updates dispatcher: all actions now use `defineAction(schema, handler, exampleArgs)`
- Improves test context: adds mock `env.LORE_DB` binding to all dispatcher tests
- All tests pass; 100% patch coverage maintained
