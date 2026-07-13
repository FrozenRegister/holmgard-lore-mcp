## Phase 0: Schema Surface — fix missing rpg sub-schemas

- **#358** `character` sub-schema now lists `search` and all actual handler actions (`add_xp`, `get_progression`, `level_up`, `cast_spell`, `snapshot`, `activate`, `list_passengers`, `recompute_derived`)
- **#360** `item` sub-schema added with `search` action and full CRUD parameters
- **#361** `resource` sub-schema corrected: removed phantom actions (`add`, `transfer`), added actual handler actions (`crate_drop`, `degrade`, `improvise`, `craft`)
- **#361** `broadcast` sub-schema corrected: removed phantom actions (`vote`, `intervene`, `schedule_drop`), added actual handler actions (`audience_pulse`, `resolve_vote`, `production_intervene`, `celeste_moment`, `trigger_event`)
- **#362** Added sub-schemas for all 29 previously missing rpg subs: `math`, `world`, `party`, `item`, `inventory`, `theft`, `improvisation`, `npc`, `session`, `combat_map`, `spawn`, `strategy`, `turn`, `spatial`, `world_map`, `batch`, `travel`, `perception`, `scene`, `rest`, `scroll`, `event`, `drama`, `time`, `timeline`, `biome`, `encounter`, `zone_type`, `waypoint`