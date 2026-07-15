-- Add NPC-specific attributes to characters table for #347 (npc-manage CRUD)
-- disposition: NPC's innate attitude independent of specific relationships
-- location_key: Named location where NPC is commonly found (complements hex positioning)
ALTER TABLE characters ADD COLUMN disposition TEXT CHECK (disposition IN ('hostile', 'unfriendly', 'neutral', 'friendly', 'helpful')) DEFAULT 'neutral';
ALTER TABLE characters ADD COLUMN location_key TEXT;
