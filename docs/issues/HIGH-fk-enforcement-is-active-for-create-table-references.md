# Discovery: FK enforcement IS active for CREATE TABLE-level REFERENCES — prior "not active anywhere" comments are wrong

**Severity:** HIGH (affects migration-writing assumptions, not a runtime bug)
**Discovered:** 2026-07-11
**Status:** Documented (this file), not a defect to fix

## Symptom

Migrations `0008_character_cohabitation.sql` and `0009_character_world_scoping.sql` both contain comments asserting foreign-key enforcement is inactive in this schema:

> "FK enforcement isn't active anywhere in this schema (no migration sets PRAGMA foreign_keys)"

This is **empirically false**. A test seeding a `room_nodes` row with `worldId: 'world-1'` but no matching `worlds` row failed with:

```text
Error: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)
```

`docs/issues/HIGH-combat-manage-create-encounter-FK-constraint.md` (filed 2026-06-11, still open) independently confirms the same failure mode against **production**, not just the local D1/miniflare test harness — `combat_manage`'s `create_encounter` fails with the identical FK error when `regionId` doesn't match an existing parent row.

## Root cause

D1 (and the miniflare-backed test harness that mirrors it) enables `PRAGMA foreign_keys` by default — nobody needed to set it explicitly, which is what the two migration comments got wrong. The distinction that actually matters is **where the `REFERENCES` clause is declared**:

- **Inline in a `CREATE TABLE` statement** (e.g. `resource_inventory.world_id`, `crate_drops.world_id`, `broadcast_approval.world_id`/`character_id` from migration 0013; `room_nodes.world_id` from migration 0015) — **enforced**. Every INSERT into a table like this requires the referenced parent row to already exist.
- **Added via an incremental `ALTER TABLE ... ADD COLUMN ... REFERENCES ...`** — this is a **different failure mode entirely**: D1/miniflare **rejects the migration at apply time** with a parse/schema error (confirmed empirically while landing migration 0008 — see that file's own comment), so no migration in this repo has ever shipped one. `characters.host_body_id`/`characters.world_id`/`characters.faction_id` are all `ALTER TABLE ADD COLUMN` with **no** `REFERENCES` clause at all specifically to route around this — not because FK enforcement is inactive, but because the ALTER syntax itself doesn't reach the table.

So every table in this schema that declares a `REFERENCES` inline in its `CREATE TABLE` **is** FK-enforced, and always has been.

## Impact

- **Tests**: any test that inserts a row into a table with an inline `REFERENCES` column and doesn't first seed the parent row (most commonly `worlds`) will fail with `SQLITE_CONSTRAINT_FOREIGNKEY`, not silently accept the row. This session's own `resource-manage.test.ts`, `production-manage.test.ts`, `broadcast-manage.test.ts`, `party-trust-betrayal.test.ts`, and `corpse-manage.test.ts` all happened to seed `worlds` first in every test, so this was never hit — it surfaced for the first time in `spatial-manage.test.ts` (#290) when one test used a `worldId` without calling the local `createWorld()` helper.
- **Production**: `docs/issues/HIGH-combat-manage-create-encounter-FK-constraint.md`'s `create_encounter` bug is this same mechanism, not a mystery — its `region_id` (or equivalent) column has an inline `REFERENCES` and the caller is passing a region key that was never inserted into the parent table.

## Suggested follow-up

- When writing a new migration with an inline `CREATE TABLE ... REFERENCES parent(id)`, always seed/verify the parent row exists before the first insert — in tests via a `createWorld()`-style helper, in production via the handler's own validation (several handlers, e.g. `production-manage.ts`'s `advance_day`, already do `SELECT ... FROM worlds WHERE id = ?` before proceeding — this is the right pattern, not incidental).
- `docs/issues/HIGH-combat-manage-create-encounter-FK-constraint.md` can likely be closed with a much narrower fix now that the mechanism is understood: validate/seed the `region_id` parent row (or add the missing `SELECT ... WHERE id = ?` guard with a clear error message) rather than treating it as an open mystery.
- Do **not** rewrite the stale "not active anywhere" comments in migrations 0008/0009 — per this repo's own rule, migration files are the historical record and should stay as originally written. This file is the correction going forward.
