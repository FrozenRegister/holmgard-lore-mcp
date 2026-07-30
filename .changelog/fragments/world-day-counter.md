### Added

- `world_state.world_day` — a general-purpose day-counter advanced by `time.advance`, independent of `production-manage.ts`'s opt-in `production_day`. Unblocks tick-hooks.ts's `resource_consume` and `weather_update` sub-hooks (#629), which previously had no day-count integer to call day-based subsystems (`tickAllOwnersDegradation`, `weather_log`) with.

### Fixed

- `resource_consume` and `weather_update` tick-hooks are now implemented instead of returning stub placeholders: `resource_consume` calls `tickAllOwnersDegradation` for the world at the current `world_day`, and `weather_update` reports the cached forecast (or a gap for the narrator to fill) for that day.
- `weather-manage.ts`'s `currentWorldDay()` fallback now reads `world_day` instead of `production_day`, which belonged to an unrelated subsystem and was never advanced by the general world clock.
