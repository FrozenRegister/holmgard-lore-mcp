# Issue: `combat_manage (create_encounter)` — FOREIGN KEY Constraint Failed

**Severity:** HIGH
**Reported:** 2026-06-11
**Status:** Open

## Symptom

```
Error executing MCP tool: MCP error -32603:
D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT
  (extended: SQLITE_CONSTRAINT_FOREIGNKEY)
```

Triggered by:

```
combat_manage({ action: "create_encounter", id: "test-narrative-flow-combat-1", regionId: "location:thornwood-road" })
```

## Impact

**Blocks all combat initialization.** The entire combat pipeline depends on `create_encounter` — you cannot start combat, add combatants, track turns, resolve actions, or render battle maps. This means any narrative flow that leads to combat is dead in the water.

Affected downstream tools that are unreachable:
- `combat_action` (attack, heal, apply_condition, use_ability)
- `combat_map` (create, move_token, render)
- `combat_manage` (add_combatant, next_turn, start, end)
- `combat_action` (get_log, get_turn_summary)

## Root Cause Hypothesis

The `encounters` table has a foreign key column — likely `region_id` — that references a `regions` (or similar) parent table. The FK constraint requires a matching row in the parent table. No such row exists, so the INSERT fails.

Likely candidates:
1. The D1 schema has `region_id` column with `REFERENCES regions(id)` and the `regions` table is empty or doesn't match the regionId format being passed.
2. The `regionId` parameter maps to a location key (e.g. `location:thornwood-road`) but the FK expects a numeric ID from a `regions` table.
3. The FK references a `maps` or `worlds` table that hasn't been seeded.

## Reproduction

```js
combat_manage({ action: "create_encounter", id: "any-id", regionId: "any-region-key" })
// → FOREIGN KEY constraint failed
```

## Suggested Fix

1. Examine the D1 schema (`schema/rpg-schema.sql`) for the `encounters` table's FK definitions.
2. Identify which parent table the `region_id` FK references.
3. Either:
   - a) Seed the parent table with a matching row before creating encounters, or
   - b) Remove the FK constraint or make it nullable/optional, or
   - c) Change the regionId parameter to accept a format that matches the parent table's primary key.

## Workaround

None currently available. The combat pipeline cannot be tested or used until this is resolved.