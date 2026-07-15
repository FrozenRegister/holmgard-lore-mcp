# Add NPC CRUD operations for agent integration

- Added `list` action to query all NPCs in a world
- Added `get` action to retrieve single NPC with relationships and location data
- Added `update` action to modify NPC state (name, disposition, faction, hp)
- Added `assign_to_location` action to place NPCs on map (location_key or hex coordinates)
- Enables Phase 4 agent integration and NPC management workflows (fixes #347)
