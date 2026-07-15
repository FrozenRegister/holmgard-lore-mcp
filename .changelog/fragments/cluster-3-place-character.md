### New `place_character` Spawn Action (#340)

- Add `place_character` action to spawn handler for positioning characters on hex maps
- Requires `characterId`, `q`, `r` parameters; `mapId` defaults to `'main'`
- Characters can be placed without creating a new NPC (unlike `spawn_character`)
- Adds `characters.current_hex_q`, `current_hex_r`, `map_id` columns via migration 0024
