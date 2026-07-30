# Implement dissolution_flag tick hook

Implement the `dissolution_flag` hook in `src/rpg/handlers/tick-hooks.ts` (#502). The hook scans D1 `characters` rows in a world with `death_mode = 'staged'` and reports them as flagged for narrator review, without ever auto-advancing dissolution stages. Uses the `dissolutionStageCheck()` utility to determine which characters are in active dissolution stages.
