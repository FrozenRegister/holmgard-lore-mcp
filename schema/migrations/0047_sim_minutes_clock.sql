-- Migration 0047: monotonic sim-minutes clock (#671)
--
-- #671 traced a concrete drift bug: world_day (0045) only advances via a
-- calendar-date diff (dateDiff(oldDate, newDate)), which ignores hour (0046)
-- entirely. Advancing time.advance by "3 hours" within the same calendar day
-- leaves world_day unchanged even though real time passed — day-cadence tick
-- hooks (resource_consume, weather_update) then read a stale day value.
-- Advancing by hours that crosses midnight bumps world_day by a full day for
-- a partial day's elapsed time — the inverse problem, over-consumption.
--
-- sim_minutes is the fix: a single monotonic counter of total elapsed
-- minutes, computed once per time.advance call regardless of which unit
-- (minutes/hours/days/months/years) the caller used, and the sole input
-- world_day is now derived from (floor(sim_minutes / 1440)) — so the two
-- can no longer independently drift out of sync the way world_day and hour
-- could before this migration. world_day and hour are kept (not dropped):
-- weather_log, resource-manage.ts's expires_on_day, and creature-ai.ts's
-- computeDayPhase all key off them directly and are out of scope to touch
-- here — only their *source of truth* changes from "increment dateDiff" to
-- "derive from sim_minutes."
--
-- minute (0-59) gives world_state the sub-hour precision needed for the new
-- "minutes" `by` unit in time-manage.ts's parseByString/advanceByMinutes.
--
-- Backfill: existing worlds already have world_day/hour set from prior
-- advance() calls; sim_minutes is seeded from them (world_day * 1440 +
-- hour * 60) so a world mid-campaign doesn't silently rewind its clock the
-- moment this migration lands.
--
-- New worlds get the column DEFAULT — 720 (12:00), not 0 (00:00). This must
-- match hour's own DEFAULT of 12 (migration 0046, chosen so nocturnal
-- creatures don't wake the instant a fresh world exists): a 0 default here
-- would make a brand-new, never-advanced world's sim_minutes (0) disagree
-- with its hour (12) from the moment seedWorldState's bare `INSERT OR
-- IGNORE INTO world_state (world_id) VALUES (?)` creates the row — the
-- exact kind of drift this migration exists to eliminate, just introduced
-- fresh instead of inherited.

ALTER TABLE world_state ADD COLUMN sim_minutes INTEGER NOT NULL DEFAULT 720;
ALTER TABLE world_state ADD COLUMN minute INTEGER NOT NULL DEFAULT 0;

UPDATE world_state SET sim_minutes = (COALESCE(world_day, 0) * 1440) + (COALESCE(hour, 12) * 60);

-- character_injuries.created_at is real wall-clock time (documented as a
-- known gap in tick-hooks.ts's health_degradation hook comment) — wound
-- escalation was measuring "hours untreated" against Date.now(), not
-- simulation time, inconsistent with the in-game-time rule claims.ts
-- already enforces for claimed_at/claimed_until. created_at_sim_minutes
-- lets health_degradation diff against the tick driver's own sim clock
-- instead. Nullable: injuries created before this migration have no sim-time
-- stamp, and the hook falls back to the old wall-clock calculation for those
-- rows rather than backfilling a fabricated value.
ALTER TABLE character_injuries ADD COLUMN created_at_sim_minutes INTEGER;
