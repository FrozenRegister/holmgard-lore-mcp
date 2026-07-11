# room_nodes.biome_context blocks spatial_manage integration with the dynamic biome registry

## Symptom

`spatial_manage.ts`'s `create_room`/room-generation actions still validate `biome` against a
hardcoded 8-value TypeScript enum (`BIOMES = ['forest', 'mountain', 'urban', 'dungeon', 'coastal',
'cavern', 'divine', 'arcane']`), even after #274 introduced a per-world, D1-backed biome registry
(`biome_manage`) that `world_map.ts` now uses instead of its own hardcoded glyph map.

## Discovered while

Implementing #274 (dynamic biome registry). The natural next step was to also point
`spatial_manage.ts` at the new registry, but `schema/rpg-schema.sql`'s `room_nodes` table
definition has:

```sql
biome_context TEXT NOT NULL CHECK(biome_context IN ('forest', 'mountain', 'urban', 'dungeon', 'coastal', 'cavern', 'divine', 'arcane'))
```

This is a **DB-level `CHECK` constraint**, not just a Zod enum — inserting any biome name outside
that fixed list fails at the SQLite layer regardless of what the TypeScript handler validates.
Additionally, `room_nodes` has **no `world_id` column at all** (confirmed via
`grep -rln "room_nodes" schema/migrations/*.sql` — only migration `0001_initial.sql` ever touches
the table), so there's no column to scope a per-world registry lookup against even if the CHECK
constraint were removed.

## Impact

`spatial_manage` rooms cannot use any of the per-world custom biomes registered via
`biome_manage.register` (e.g. Gotland's `limestone_karst`, `bog`, `sea_cliff`) — they remain
limited to the original 8 hardcoded values, which is exactly the limitation #274 set out to
remove for `world_map`.

## Suggested fix

SQLite cannot `ALTER TABLE ... DROP CONSTRAINT`; removing a `CHECK` constraint requires a full
table rebuild (`CREATE TABLE room_nodes_new (...)` without the constraint, `INSERT INTO ... SELECT
...`, `DROP TABLE room_nodes`, `ALTER TABLE room_nodes_new RENAME TO room_nodes`), run inside a
migration. That migration should also add a `world_id TEXT REFERENCES worlds(id)` column so
`spatial_manage` can call `getBiomeRegistry(db, worldId)` (exported from
`src/rpg/handlers/biome-manage.ts`) the same way `world-map.ts` does.

This is materially higher-risk than a plain `ADD COLUMN` migration (a full table rebuild touches
every existing row) and was deliberately scoped out of the #274 PR. Tracked separately — see the
linked follow-up issue.
