### Timeline Engine (#217)

- Added `timeline_events`, `timeline_branches`, and `entity_knowledge` D1 tables (`schema/migrations/0006_timeline_engine.sql`)
- New `rpg({ sub: "timeline" })` handler with 7 actions: `get_events`, `get_gap`, `get_perspectives`, `create_branch`, `switch_branch`, `compare_branches`, `merge_branch`
- Added `get_timeline` and `jump_to` actions to `time_manage` (Phase 5)
- Enhanced `continuity_manage` `append_event` to write to D1 when `world_id` is supplied (KV-only fallback preserved)
- Rewrote `get_event_log` to merge D1 + KV results with deduplication
- New `continuity_manage` actions: `canonize` (marks timeline events canonical), `migrate_events` (bulk KV→D1 migration)
- Enhanced `world_manage` `get_entity_knowledge` to query D1 `entity_knowledge` table first, KV/markdown fallback preserved
- New `world_manage` actions: `set_entity_knowledge`, `learn_from_event`, `migrate_knowledge`
