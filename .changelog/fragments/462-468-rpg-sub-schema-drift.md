## Fixed RPG sub-schema drift and added a drift guard (#462-#468)

### Fixed

- `SUB_SCHEMAS` in `src/index.ts` (the doc source for `load_tool_schema({ toolName: "rpg", sub })`) is corrected for seven subs that had drifted from their handlers' real `ACTIONS`: `drama`, `theft`, `event`, `session`, `improvisation`, and `combat_action` each previously advertised a stale or 0%-overlap action list; `spawn` was missing its real `place_character` action (#340). (#462, #463, #464, #465, #466, #467)
- Discovered while adding the drift guard below (not part of #462-#467, but the same bug class), across 13 more subs: `conflict_type` had no `SUB_SCHEMAS` entry at all despite being a real, dispatchable `rpg` sub; `timeline`, `encounter`, `batch`, `combat_map`, `turn`, `spatial`, and `npc` each advertised an almost entirely stale action list (0-1 of the real actions overlapped); `perception` overlapped on only one of six real actions; `scene`, `math`, `character`, and `party` were each missing a handful of real actions (e.g. `move_to_location`/`move_to_tile` on `character`, `cohesion_check`/`group_break`/`cohesion_shift` on `party`). All corrected the same way as #462-#467; a static script cross-checking every canonical sub's real `ACTIONS` against its `SUB_SCHEMAS` description confirms no further gaps remain.

### Added

- Every `rpg` dispatch handler now exports its `ACTIONS` constant (previously module-private), so the real runtime action set is introspectable outside the handler file.
- New `src/__tests__/rpg-sub-schema-actions-drift.test.ts` — cross-checks every canonical `rpg` sub's `SUB_SCHEMAS` description against its handler's real `ACTIONS`, failing CI if a future edit lets a sub's advertised actions omit a real one (the #462-#467 bug class). Deliberately scoped to action-list drift only — no new dependency, generated file, or build step (see #468 discussion for why full JSON-schema codegen was passed over).
- `src/__tests__/rpg-schema-accuracy.test.ts` and `tests/live/rpg-schema-accuracy.test.ts` gained per-sub regression coverage for the seven corrected subs, following the existing `world_map schema accuracy (#423)` pattern.
