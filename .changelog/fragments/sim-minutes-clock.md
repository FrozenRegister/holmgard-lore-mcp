### Monotonic sim-minutes clock + tick-hook rate-scaling (#671)

- Added `minutes` as a recognized `time.advance` `by` unit (e.g. `"10 minutes"`), alongside the existing hours/days/months/years.
- Added `world_state.sim_minutes` — a monotonic elapsed-minutes counter that `world_day`/`hour`/`minute` are now derived from on every `advance` call, fixing the drift where hour-only advances left `world_day` unchanged and midnight-crossing advances over-charged a full day's tick-hook rate. Added `world_state.minute` (0-59) for sub-hour precision.
- `time.advance`'s response gains `minute`, `old_minute`, `sim_minutes`, `elapsed_minutes`, and `day_fraction`.
- `tick-hooks.ts`'s `resource_consume` hook now scales its per-day consumption rate by the elapsed day-fraction (`WorldSnapshot.elapsedDayFraction`) instead of always charging a full day's rate, via a new optional `dayFraction` parameter on `resource-manage.ts`'s `tickAllOwnersDegradation`.
- `health_degradation`'s wound-escalation check now diffs against in-game sim time (`character_injuries.created_at_sim_minutes`, stamped by `encounter-manage.ts` at injury creation) instead of wall-clock time, falling back to the old wall-clock diff for injuries created before this migration.
- Migration `0047_sim_minutes_clock.sql`.
- Known follow-up (documented inline, not fixed here): `resource-manage.ts`'s `daysWithoutFood` starvation streak still increments by a flat 1 per `resource_consume` call regardless of `dayFraction`, so sub-day tick cadence inflates it faster than real elapsed time — needs its own design decision if sub-day `resource_consume` cadence becomes common.
