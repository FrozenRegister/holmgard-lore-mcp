-- #311: Event verb taxonomy — D1-backed signal tiering for narrative engine
-- filtering. get_event_log gains an optional `tier` param that joins against
-- this table so a caller can ask for only high-signal events instead of
-- drowning in combat noise.
--
-- Seed list combines the issue's original 20-verb generic RPG set with real
-- production vocabulary gathered from both live narrator agents during the
-- #311 issue Q&A: Archisector (early-era agent — predation/dissolution
-- vocabulary) and the Calder Architect (later-era agent — social/political/
-- production vocabulary). Runtime-mutable after this seed — taxonomy_set/
-- taxonomy_delete let either agent extend it without a code deploy.
--
-- Three verbs had conflicting tier suggestions between the two agents;
-- resolved by taking the higher tier (a missed high-signal event is worse
-- than a little extra noise in a "high" filter):
--   - absorbed: Archisector said low ("partial assimilation"), Calder said
--     high ("Mycelium integration of a mind") — kept high.
--   - extracted: already high/production from the original seed and
--     Archisector; Calder separately used it for "data/memory pulled from a
--     mind" (medium/narrative) — kept high/production, the 2-of-3 reading.
--   - surrendered: both agents said high but split category (social vs.
--     narrative) — unified to narrative as the more general reading.

CREATE TABLE IF NOT EXISTS event_verb_taxonomy (
  verb        TEXT PRIMARY KEY,
  tier        TEXT NOT NULL CHECK(tier IN ('high', 'medium', 'low')),
  category    TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO event_verb_taxonomy (verb, tier, category) VALUES
  -- high — combat
  ('killed', 'high', 'combat'),
  ('died', 'high', 'combat'),
  ('captured', 'high', 'combat'),
  ('escaped', 'high', 'combat'),
  ('engulfed', 'high', 'combat'),
  -- high — narrative
  ('discovered', 'high', 'narrative'),
  ('transformed', 'high', 'narrative'),
  ('consumed', 'high', 'narrative'),
  ('digested', 'high', 'narrative'),
  ('assimilated', 'high', 'narrative'),
  ('surrendered', 'high', 'narrative'),
  ('dissolved', 'high', 'narrative'),
  ('parasitized', 'high', 'narrative'),
  ('awakened', 'high', 'narrative'),
  ('absorbed', 'high', 'narrative'),
  ('integrated', 'high', 'narrative'),
  ('transferred', 'high', 'narrative'),
  ('merged', 'high', 'narrative'),
  ('revealed', 'high', 'narrative'),
  ('diminished', 'high', 'narrative'),
  -- high — social
  ('betrayed', 'high', 'social'),
  ('defected', 'high', 'social'),
  -- high — production
  ('extracted', 'high', 'production'),
  ('dispatched', 'high', 'production'),
  ('activated', 'high', 'production'),
  ('deployed', 'high', 'production'),
  -- medium — combat
  ('wounded', 'medium', 'combat'),
  ('fled', 'medium', 'combat'),
  ('stalked', 'medium', 'combat'),
  ('ambushed', 'medium', 'combat'),
  ('tenderized', 'medium', 'combat'),
  -- medium — narrative
  ('cocooned', 'medium', 'narrative'),
  ('compressed', 'medium', 'narrative'),
  ('reclaimed', 'medium', 'narrative'),
  ('stabilized', 'medium', 'narrative'),
  ('recalled', 'medium', 'narrative'),
  -- medium — social
  ('negotiated', 'medium', 'social'),
  ('forged', 'medium', 'social'),
  ('allied', 'medium', 'social'),
  ('confronted', 'medium', 'social'),
  ('fractured', 'medium', 'social'),
  ('contacted', 'medium', 'social'),
  -- medium — production
  ('gestated', 'medium', 'production'),
  ('hatched', 'medium', 'production'),
  ('collected', 'medium', 'production'),
  ('harvested', 'medium', 'production'),
  ('rendered', 'medium', 'production'),
  ('sculpted', 'medium', 'production'),
  -- low — combat
  ('attacked', 'low', 'combat'),
  ('moved', 'low', 'combat'),
  ('missed', 'low', 'combat'),
  ('blocked', 'low', 'combat'),
  ('searched', 'low', 'combat'),
  ('weaponized', 'low', 'combat'),
  -- low — narrative
  ('delivered', 'low', 'narrative'),
  ('observed', 'low', 'narrative'),
  ('tracked', 'low', 'narrative'),
  ('rested', 'low', 'narrative'),
  ('waited', 'low', 'narrative'),
  -- low — production
  ('processed', 'low', 'production'),
  ('catalogued', 'low', 'production'),
  ('logged', 'low', 'production'),
  ('priced', 'low', 'production');
