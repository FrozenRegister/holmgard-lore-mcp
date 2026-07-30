## feat: implement weather, resource, and health tick-driver hooks (#502)

`time.advance`'s `weather_update`, `resource_consume`, and `health_degradation` hooks no longer return placeholder stubs:

- `weather_update` reuses `weather-manage.ts`'s `get_forecast` (#364) — reports the cached forecast if one exists for the day, or a structured "not yet cached" summary for the narrator to fill via `set_forecast`, rather than inventing weather itself.
- `resource_consume` calls `resource-manage.ts`'s `tickAllOwnersDegradation` (already used by `production-manage.ts`'s `advance_day`) to spoil/degrade every owner's inventory in the world and tick starvation streaks.
- `health_degradation` reuses `encounter-manage.ts`'s `computeInfectionStage` (#280) to report which untreated `character_injuries` have worsened toward infection. Matching this repo's convention that a mechanics handler never silently mutates `characters.hp`/stats (see `resource-manage.ts`'s header), it reports worsening injuries as data for the narrator rather than writing HP itself — the same pattern `encounter_check` and `dissolution_flag` already use.

The last checkbox in #502 (wrapping the tick driver in a D1 transaction) was already resolved as "not needed" by #512's world-lock design — see the comment above `runTickDriver`'s hook loop.
