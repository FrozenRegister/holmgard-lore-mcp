### Test Setup: SQLite Compatibility for Migrations

- Fixed test setup to gracefully handle migrations with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` syntax on older SQLite versions
- Migrations 0003 and 0005 now apply individually in tests, skipping columns that already exist in the canonical schema
- Maintains production compatibility with Cloudflare D1's modern SQLite 3.35.0+
