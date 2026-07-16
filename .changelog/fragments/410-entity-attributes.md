### D1-backed entity interaction attributes (#410)

- New `entity_attributes` D1 table (migration `0039`): campaign-configurable numeric attributes (Weight-1, Weight-2, Tenderness-Index, Cortisol-Level, or anything a campaign defines) as a JSON blob, dual-keyed by `lore_key` and an opportunistically-resolved `character_id` so both active campaigns' entity identity schemes work without forcing either to adopt the other's.
- `resolve_interaction`, `analyze_utility`, and `get_compatibility` now read D1 attributes as the primary source of truth, falling back to KV lore markdown parsing when no D1 row exists — zero data migration required for existing entities.
- Two new `entity_manage` actions: `get_attributes` (read) and `set_attributes` (write, `merge: true` by default).
- `analyze_utility` gains `d1_attributes_used` and per-field `source: 'd1' | 'kv'`; `resolve_interaction` and `get_compatibility` gain `weight_1_source`/`weight_2_source`.
- Scoped per the issue's own non-goals: does not change the interaction probability formula, does not bridge the RPG combat engine, does not auto-backfill D1 from existing KV lore.
- Design synthesized from both narrator agents' analysis on #410 (Archisector, Calder Architect).
