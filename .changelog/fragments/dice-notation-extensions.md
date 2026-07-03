### Added

- `math_manage`'s `roll` action now supports percentile (`d%`), Fudge/Fate (`dF`), reroll-once (`r1`), and success-counting (`>N`) dice notation, alongside the existing `NdM`/drop/keep/explode/modifier grammar.
- `roll` responses now include a `critical: "success" | "failure" | null` field for single-d20 checks and advantage/disadvantage pairs (`2d20kh1`/`2d20kl1`), omitted entirely for anything else.
- New `get_history` action on `math_manage` reads back past rolls/probability calculations from the `calculations` table (filterable by `sessionId`, `kind`, or `calculationId`) — previously write-only telemetry.
- Dice/probability rolls are now backed by `crypto.getRandomValues` (rejection-sampled to avoid modulo bias) instead of `Math.random()`; the Monte-Carlo `probability` sampling loop keeps a fast `Math.random`-backed source since cryptographic unpredictability isn't needed there.
- `search_tools({query:'dice'})` and `load_tool_schema({toolName:'math_manage'})` now resolve — `math_manage` previously had no discoverable schema anywhere despite being a real capability of the `rpg` tool.

See issue #209. `seed` remains cosmetic (deferred); consolidating the ad-hoc `Math.random()` rolls in `combat_action`/`combat_manage`/`perception_manage`/`aura_manage`/`travel_manage`/`entity.ts` onto this engine is tracked separately in #210.
