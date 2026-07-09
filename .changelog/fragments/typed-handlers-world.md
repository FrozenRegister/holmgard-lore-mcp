### Typed handlers for world_manage

- Converted 12 world_manage action handlers to TypedToolContext pattern for strict schema validation:
  - `handle_thread_tick`, `handle_get_relationship`, `handle_get_faction_standing` (dispatcher-level validation added)
  - `handle_get_entity_knowledge`, `handle_set_entity_knowledge` (D1 database operations)
  - `handle_learn_from_event`, `handle_migrate_knowledge` (entity knowledge migration)
  - `handle_get_location_occupants`, `handle_get_reachable_locations`, `handle_sense_environment` (world state queries)
  - `handle_get_thread_comparison`, `handle_check_convergence` (thread analysis)
- Aliases normalized at dispatcher level before schema validation (entity_name→entity_key, faction_name→faction_key, location_id→location_key)
- All handlers now receive pre-validated `args` matching their Zod schemas
- Removed inline schema definitions and validation from handlers
- Unified action routing via `makeActionDispatcher` with support for both typed ActionSpec and legacy ToolHandler entries
- Implements Issue #241 for world_manage tool
