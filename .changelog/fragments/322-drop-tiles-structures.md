### chore: drop legacy tiles/structures tables (#322)

- Migration `0038_drop_tiles_structures.sql` drops the square-grid `tiles` and `structures` tables, retired by #320's rewrite of `world_map.ts` to the hex-axial `hexes`/`landmarks` tables. Their `schema/rpg-schema.sql` definitions are removed.
- Verified against production before merging: `tiles`, `structures`, `hexes`, and `landmarks` are all empty (0 rows) — no world has ever had square-grid or hex-grid geography data, so there is nothing to migrate and no data loss. Confirmed via full-repo search (both `holmgard-lore-mcp` and `holmgard-lore-editor`) that no code reads or writes these tables — the two "hidden coupling" reads #320 flagged were already repointed at `hexes`.
- No handler code, MCP action, or test fixture referenced these tables, so no other files changed.
