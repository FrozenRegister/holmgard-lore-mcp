### Tick Driver Infrastructure (#442)

- **New:** `src/rpg/handlers/tick-hooks.ts` — Hook runner system with shadow state, batching, checkpoint/rollback, world-level locking, and feature flags
- **Phase 1 hooks:** weather_update (resolved), resource_consume (resolved, batch), encounter_check (flagged), health_degradation (resolved), dissolution_flag (flagged)
- **Integration:** `time.advance` gains optional `hooks` and `dry_run` parameters (#442)
- **Backward compat:** No hooks → current behavior unchanged, response shape identical
- **Shadow state:** Hooks run against in-memory clone, mutations optional (dry_run mode)
- **Observability:** Structured logs, narrator_summary concatenation, topological hook ordering
- **Tests:** Comprehensive test suite covering backward compat, hook execution, dry_run mode, topological sort, and failure scenarios
