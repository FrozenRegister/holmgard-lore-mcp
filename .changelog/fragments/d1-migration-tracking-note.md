### Documentation

- Document the `kv_origin` collision that caused `0003_character_kv_fields.sql` to partially fail against the production `holmgard-rpg` D1 database, and clarify in `CLAUDE.md` that D1 migration tracking is by filename (not content) — hand-repairs belong in the live database plus `d1_migrations` tracking rows, not in a migration file rewrite. (#221)
