### character_manage / combat_action: death_mode and staged dissolution (#314)

- `characters` gains `death_mode` (`'instant'` default, or `'staged'`), plus generic `dissolution_stage`/`dissolution_stages`/`dissolution_terminal`/`dissolution_id` columns (migration 0034). No fixed stage-name enum or stage-count assumption — different staged-dissolution mechanisms (Mycelium integration, parasitic assimilation, dispatch protocols) can coexist across characters with their own stage counts.
- `character_manage`'s `update` action gains `deathMode`/`dissolutionStage`/`dissolutionStages`/`dissolutionTerminal`/`dissolutionId` fields.
- `combat_action`'s `attack` action now rejects outright (no damage roll) when any target has `death_mode = 'staged'` — staged-dissolution characters are non-combatants; a scroller/tactical agent must not attack them.
