-- Migration 0042: Add claim columns to characters table
-- Implements #440 §3.3 (Resource Locking) and #444 (Cross-tick claims + conflict resolution)
-- These columns enable cross-tick predator claims (e.g., Shaper tenderizing projects)

ALTER TABLE characters ADD COLUMN claimed_by TEXT;
ALTER TABLE characters ADD COLUMN claimed_until DATETIME;
ALTER TABLE characters ADD COLUMN claimed_at DATETIME;

-- Notes on schema design:
-- 1. All columns are nullable with no DEFAULT clause
-- 2. claimed_by holds an entity lore key (e.g., "creature:shaper-alpha", "faction:sterling-conglomerate")
-- 3. claimed_at and claimed_until use DATETIME type (not TEXT)
-- 4. No foreign key constraints (D1 rejects REFERENCES on ALTER TABLE ADD COLUMN)
-- 5. claimed_at is set by the application from in-game simulation time, not D1's wall clock
-- 6. NULL claimed_by = unclaimed = current behavior