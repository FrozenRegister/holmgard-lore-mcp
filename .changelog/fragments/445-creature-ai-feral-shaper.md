### Creature AI — feral + Shaper (#445, #440 Phase 3)

The first autonomous creature behaviour. A new per-world `creature_ai_state` table (migration `0044`) plus a `creature_ai_tick` hook plugged into the Phase 1 tick driver, branching on `predator_taxonomy`.

- **New `rpg{sub:'creature'}` handler** (`creature-manage.ts`) — CRUD for `creature_ai_state` (`register`/`list`/`get`/`update`/`delete`) plus `place` (reposition a creature on the hex map), following the `biome`/`zone_type` handler shape.
- **New `creature-ai.ts` behaviour trees** (pure, unit-testable):
  - **`feralTick`** — CK3 hunger model: activity-pattern gating, hunger accrual, and a `patrolling → hunting → feeding` (and `fleeing`) state machine. A hunt reaching melee range is **flagged** as an encounter for the narrator to resolve, never auto-resolved.
  - **`shaperTick`** — creative-drive / tenderizing / atelier: builds `creative_drive`, selects prey by `yield_preference`, seizes a subject at melee (setting a cross-tick claim via Phase 2 `setClaim`), then hauls it toward its atelier.
  - **`creatureAiTick`** branches on taxonomy; `parasitic`/`environmental` are documented no-op stubs.
- **`creature_ai_tick` hook** (`tick-hooks.ts`) is marked `mutates: true` (#512), so `dry_run` correctly rejects previewing it. It reconciles claims left by removed predators at tick start, applies each creature's movement/state/hunger, sets Shaper claims, and returns hunt/tenderize events as flagged encounters.
- **Claim death-clearing** — `clearDeadPredatorClaims` (`claims.ts`, previously a Phase 3 stub) now releases any `creature:`-namespaced claim whose claimant no longer exists in `creature_ai_state`, leaving faction/other claims untouched.

Flagged hunt/tenderize events set exactly **one** `resourceLocks` entry, per the `resolveTickConflicts` one-verdict-per-lock constraint (#512). Creature AI is **off by default** — a world opts in by including `creature_ai_tick` in its tick hooks.
