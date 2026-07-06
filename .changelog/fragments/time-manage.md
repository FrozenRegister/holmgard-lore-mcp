### time_manage sub-system (#216)

- New `rpg({ sub: "time" })` handler with D1-backed world clock and character birthdate tracking.
- Added `world_state` table (world_id PK, current_date, era, tick_speed, last_advanced_at) with FK to `worlds`.
- Added `born TEXT` column to `characters` (nullable; NULL = unknown birthdate).
- Actions: `set_date`, `get_date`, `get_age`, `advance`.
  - `get_date` returns current date, era, season (winter/spring/summer/autumn), and days_in_month (leap-year aware).
  - `get_age` computes years/months/days from `characters.born` against `world_state.current_date`; detects birthday today and returns next_birthday.
  - `advance` parses "N days/months/years", clamps months to last valid day, detects in-range birthdays, and emits `world_change` events for each.
- Migration `0005_time_birthdate.sql`.
