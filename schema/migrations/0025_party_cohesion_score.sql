-- Add cohesion_score column to parties table for Party Cohesion tracking (#306)
-- Distinct from morale: tracks immediate interpersonal bond strength independently of group mood
ALTER TABLE parties ADD COLUMN cohesion_score INTEGER NOT NULL DEFAULT 50;
