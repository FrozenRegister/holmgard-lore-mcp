### Sub-day clock for creature activity gating (#534)
- Adds `world_state.hour` (0-23, default 12/noon) via migration `0046_world_state_hour.sql`
- `time.advance`'s `by` string now accepts an hour unit (e.g. `"6 hours"`), rolling over into the existing day/date arithmetic exactly like day/month/year units already do; `get_date`/`advance` responses now report `hour`/`old_hour`
- `creature_ai_tick` derives a real `dawn`/`day`/`dusk`/`night` phase from the hour instead of a hardcoded always-daytime default — `nocturnal`, `diurnal`, and `crepuscular` `activity_pattern`s are now all live (crepuscular previously always-active as a stub)
- Advancing by days/months/years alone leaves `hour` unchanged; worlds that never advance by hours stay at the default `day` phase, preserving prior behavior
