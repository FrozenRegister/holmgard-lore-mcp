### Feature — `get_world_biomes` bare `/mcp` method (#321, Phase 3 of #308)
- New bare JSON-RPC method `get_world_biomes(worldId)`, mirroring `get_lore`'s exact convention (clean structured JSON in `result`, no LLM content-block wrapping) — reuses `biome-manage.ts`'s existing `list` action, so there's one query, two envelopes.
- Returns `{ worldId, biomes: [{id, name, glyph, category, color_hex, movement_cost, base_threat, description}], count }`. A world with zero registered biomes returns an empty array, not an error.
- Agent-facing discoverability is already covered by the existing `rpg{sub:"biome", action:"list"}` sub-tool (via `tools/call`) — no separate tool registration was needed for this bare method, matching how `get_lore`/`list_topics` are bare-method-only today.
- This is the `holmgard-lore-mcp` side of #321 (cross-repo); the `holmgard-lore-editor` side consumes this method to populate a biome-registry-aware terrain picker dropdown.
