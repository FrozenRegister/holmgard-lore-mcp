### drama_manage / combat_action: co-habitation stat resolution (#315)

- New `src/rpg/utils/cohabitation.ts` — resolves the effective combat/check profile for a co-habitating character (multiple consciousnesses sharing one body, via the existing `host_body_id`/`active` model from #226 Phase 2): physical stats (`str`/`dex`/`con`), HP pool, and AC always from the host body row; mental stats (`int`/`wis`/`cha`) and display name from whichever consciousness currently has `active = 1` (the driver).
- `drama_manage`'s `roll_ability`, `opposed_check`, `group_check`, `social_combat`, and `dramatic_conflict` all resolve through this split automatically now.
- `combat_action`'s `apply_damage`/`heal` redirect to the host body's shared HP pool when a passenger consciousness's own character id is targeted, instead of mutating a separate `hp` field on that row.
- `character_manage`'s `activate`/`list_passengers` gained `set_driver`/`get_driver` aliases (no new mechanics — same actions, matching the issue's proposed naming).
- Reuses the existing `host_body_id`/`active` model rather than building the parallel `co_habitation` junction table the issue originally proposed. Per narrator Q&A: driver switching is narrator discretion, not a mechanical action-cost/contested-roll gate — these characters aren't on a tactical grid.
