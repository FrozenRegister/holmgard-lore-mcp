## Fixed

- `rpg world get_state` no longer crashes when called with only `worldId` (was using `a.id` instead of `targetId` for sub-queries — #376/#377)
- `rpg weather` now returns a clear error message when `worldId` is missing, instead of failing deep in the handler

## Changed

- RPG handlers `world`, `weather`, and `corpse` now accept `world_id` (snake_case) as an alias for `worldId` (camelCase), bridging the cross-tool naming gap with non-RPG tools (#377)
- Corpse sub schema: `id` is now documented as "Corpse UUID" (not a character ID), `characterId` as "Dead character's UUID". The `required` array no longer includes `id` (since `create`/`register`/`list` don't need it)
- World and weather sub schemas now include `world_id` as a documented snake_case alias
- All three sub schemas have improved parameter descriptions visible via `load_tool_schema`

## Added

- `docs/parameter-naming-conventions.md` — comprehensive cross-tool parameter naming reference documenting all five ways to reference a character, the `id` ambiguity by sub, and the `worldId` required/optional matrix