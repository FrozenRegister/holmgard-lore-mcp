feat: Phase 0 dissolution primitives — stage-gated sensory mutations, mechanical consequences, terminal conversion branching

- Adds `src/rpg/utils/dissolution.ts` with the five-stage dissolution model (tenderizing → engulfment → dissolution → assimilation → terminal), each with sensory mutations (scent/thermal/texture/visual/sound) and mechanical consequences (resistance decrement, movement lock, communication penalty, HP drain, knowledge leakage)
- Adds `TERMINAL_CONVERSIONS` for all 7 utility vectors (GASTRIC/BUTCHERY/INCUBATION/SCULPTURE/PARASITISM/THRALL/DISTRIBUTED) reusing the #410/#315 vocabulary
- Extends `entity_manage.advance_stage` (#420 handler) to apply stage-gated sensory fields to KV entity text and HP drain via atomic D1 `db.batch`
- Terminal stage resolution now includes conversion pathway detection and timeline event with conversion detail
- Adds `dissolutionStageCheck`, `consumptionTimelineCheck`, `buildSensoryProfile`, `buildMechanicalEffects` helpers
- 100% unit test coverage of all stages, all terminal vectors, edge cases, and cumulative builders