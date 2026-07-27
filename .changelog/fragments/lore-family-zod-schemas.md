---
type: feature
---

Added real Zod input schemas for the 5 lore-family tools (`lore_manage`, `entity_manage`, `world_manage`, `scene_manage`, `continuity_manage`) and registered each via the existing `registerTool()` infrastructure. This is additive only — the existing hand-written JSON Schema definitions and dispatch paths remain unchanged.

**Schema deviations from the hand-written definitions:**

1. **`world_manage` and `continuity_manage`** use `z.union` at the top level instead of `z.discriminatedUnion` because 4 actions in `world_manage` (`get_faction_standing`, `get_entity_knowledge`, `get_location_occupants`, `sense_environment`) and 1 action in `continuity_manage` (`plant_setup`) have OR-alias field requirements that cannot be expressed within a single `z.discriminatedUnion` branch. Zod's `discriminatedUnion` constructor calls `option.shape[discriminator].value` on each option, which fails on `z.union` instances. Each OR-alias action is modeled as multiple flat objects with the same `action` literal but different required fields.

2. **`continuity_manage.set_goal`** has three independent OR-pairs (`entity_key`/`entity_name`, `goal_id`/`goal_name`, `description`/`goal_description`). Building the 8-way combinatorial union would be verbose and fragile. Instead, all six aliased fields are optional in a single flat Zod object, and the handler's existing runtime check enforces the OR requirement. This is a deliberate, documented fidelity loss for this one action only.

3. **`entity_manage`** also uses `z.union` at the top level instead of `z.discriminatedUnion`, for the same structural reason as (1): `set_attributes.attributes` needs a `.refine()` to enforce "at least one attribute" (matching `ENTITY_MANAGE_SCHEMA`'s `minProperties: 1`), and `discriminatedUnion` rejects members that aren't flat `ZodObject`s. Found and fixed in review (the first version of this PR used `discriminatedUnion` for `entity_manage` and silently dropped the `minProperties: 1` constraint). Note the refine's constraint doesn't surface in the generated JSON Schema — `zod-to-json-schema` treats `.refine()` as an opaque predicate — so `tools/list` output for `set_attributes` won't show `minProperties`, only the parse-time check enforces it, once schema validation is wired into dispatch (#546).

**Deferred to the dependabot Zod v4 bump (#602) and later work:** this PR does not upgrade `zod`/`zod-to-json-schema` past their current pinned versions (`zod@^3.25.76`, `zod-to-json-schema@^3.24.6`). All Zod APIs used here (`.strict()`, `z.discriminatedUnion`, `z.union`, `z.literal`, `.refine()`, two-arg `z.record(keySchema, valueSchema)`) are unchanged in Zod v4, so no rework is expected in these 5 files — but `zod-to-json-schema`'s v4 compatibility (or replacing it with Zod v4's built-in `z.toJSONSchema()`) is a repo-wide question spanning every `registerTool()` consumer (Phases 2–4), not scoped to this PR. See #602 and #540.
