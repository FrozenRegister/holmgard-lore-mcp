### New `move_hex` Travel Action (#337)

- Add `move_hex` action to travel handler for hex-based party movement
- Requires `partyId`, `worldId`, `toQ`, `toR` parameters
- Updates `parties.current_hex_q/r` to track hex position
- Optionally resolves encounters via existing `resolveEncounterCore` engine
- Gracefully handles hexes without biome rows (returns `biome: null`)
