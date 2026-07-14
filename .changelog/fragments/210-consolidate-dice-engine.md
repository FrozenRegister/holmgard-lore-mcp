## Consolidated ad-hoc Math.random() rolls onto the shared dice engine (#210)

### Changed
- `combat_action.attack` now uses `executeRoll('1d20')` from `math-manage` instead of a flat `Math.random() > 0.5` coin-flip. Hit rate shifts from 50% to 55% (d20 >= 10). Nat-20 always hits (critical), nat-1 always misses (fumble).
- `combat_action.attack` damage now uses `executeRoll` with a configurable `damageExpression` param (default `1d8`). Critical hits double the die count (e.g. `1d8` → `2d8`).
- `combat_action.attack` response now includes `attackRoll`, `isCrit`, `isFumble`, and `damageRoll` fields.
- `perception-manage.assess`, `stealth_check`, and `perception_contested` now use `executeRoll('1d20')` instead of `Math.floor(Math.random()*20)+1`.
- `aura-manage.check_save` now uses `executeRoll('1d20')` instead of `Math.floor(Math.random()*20)+1`.
- `combat-manage.death_save` now uses `executeRoll('1d20')` instead of `Math.floor(Math.random()*20)+1`. The nat-1(=2 failures)/nat-20(=revive) logic is unchanged.
- `travel-manage` encounter flag now uses `executeRoll('1d100')` (<= 15) instead of `Math.random() < 0.15`. Loot count uses `executeRoll('1d3')` instead of `Math.floor(Math.random()*3)+1`. The weighted loot table selection remains `Math.random()` (it's a weighted random choice, not a die roll).

### Added
- `executeRoll`, `RollResult`, and `RngSource` are now exported from `math-manage.ts` for cross-handler reuse.
- New `damageExpression` optional param on `combat_action.attack` for configurable weapon damage dice.
- New test file `src/__tests__/dice-consolidation.test.ts` covering all consolidated roll sites.

### Out of scope (left as-is per issue #210)
- `entity.ts` `resolve_interaction` and `roll_encounter` — these use weighted probability/selection, not die rolls.
- `travel-manage.ts` `rollLoot` weighted table — weighted random choice, not a die roll.