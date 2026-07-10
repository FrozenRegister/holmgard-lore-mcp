### Fix — character world scoping (#268)
- Adds `world_id` column to the D1 `characters` table (migration 0009) and wires it through `character_manage`'s `create`, `update`, `list`, and `search` actions.
- Fixes cross-world contamination where `character.list`/`character.search` could return characters from a different narrative world in the same result set (e.g. two universes both having a character named "Kael").
- Does not backfill `world_id` on existing characters — there is no reliable structural signal in D1 to infer world membership safely; this is left as a follow-up requiring the narrator's own knowledge of which character belongs to which world.
