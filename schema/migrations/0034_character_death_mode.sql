-- #314: death speed — instant vs. staged dissolution.
--
-- death_mode classifies how a character's death is resolved. 'instant' (the
-- default, non-breaking for every existing row) means hp:0 -> dead, normal
-- combat rules apply. 'staged' means death unfolds over a narrator-controlled
-- multi-stage process (Mycelium integration, consumption timelines, dispatch
-- protocols) and the character must not be treated as a valid combat target.
--
-- dissolution_stage/dissolution_stages/dissolution_terminal are intentionally
-- generic (no fixed stage-name enum, no assumption of a specific stage count)
-- so unrelated staged-dissolution mechanisms can coexist on different
-- characters without a schema change — confirmed during the #314 narrator
-- Q&A that at least two distinct mechanisms already exist in the live
-- narrative (Mycelium integration vs. Slime-Girl parasitic assimilation).
ALTER TABLE characters ADD COLUMN death_mode TEXT NOT NULL DEFAULT 'instant'
  CHECK(death_mode IN ('instant', 'staged'));
ALTER TABLE characters ADD COLUMN dissolution_stage INTEGER;
ALTER TABLE characters ADD COLUMN dissolution_stages INTEGER;
ALTER TABLE characters ADD COLUMN dissolution_terminal TEXT;
ALTER TABLE characters ADD COLUMN dissolution_id TEXT;
