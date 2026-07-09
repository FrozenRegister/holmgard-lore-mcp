### scene_manage: render_with_rolls action (#260)
- Adds `render_with_rolls` to `scene_manage` — combines `render_pov`'s narrative/visibility computation with the existing dice engine (`rpg({sub:'math', action:'roll'})`, reused via `handleMathManage`, same pattern as combat's `rollD20Once`) in a single call
- Accepts a `rolls` array (`label` + dice `expression`); each roll's result (`total`, `rolls`, `critical`, `calculationId`) is logged to D1's `calculations` table by the shared dice engine — mechanical/queryable state stays in D1, the narrative render itself stays KV/freeform (see `docs/storage-selection-kv-vs-d1.md`)
- A malformed roll expression records a per-roll `error` rather than failing the whole request
- Refactors `render_pov`'s narrative/visibility logic into a shared `buildPovRenderData()` helper, reused by both actions — no behavior change to the existing `render_pov` action
- Addresses one of the gaps from #260 (dice-driven scene rendering); freeform scene creation and autonomous transitions remain out of scope for this change
