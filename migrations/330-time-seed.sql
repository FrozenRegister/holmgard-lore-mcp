-- Migration: 330-time-seed
-- Seeds world_state with default row for time subsystem (#330)
-- This fixes the time subsystem's missing data dependency

INSERT INTO world_state (world_id, current_date, era, time_scale)
VALUES (
  '2d8eabf6-5537-499d-8eac-c81bf2b7ae50',
  '2024-07-01',
  'Aurelia''s Legacy',
  'daily'
);
