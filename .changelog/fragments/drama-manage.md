### feat: add `drama` sub — narrative conflict resolution

New `rpg{sub:"drama"}` handler with five actions for literary and political storylines:

- **`opposed_check`** — two characters roll specified abilities against each other; returns winner, margin, nat-1/nat-20 flags
- **`group_check`** — groups of characters vs groups with three aggregation modes (`best`, `sum`, `pool`)
- **`social_combat`** — multi-round leverage contest; nat-20 grants +2 momentum; tracks running leverage scores
- **`dramatic_conflict`** — multi-tick campaign with external modifiers; each side's best actor rolls; momentum shifts determine winner
- **`roll_ability`** — convenience action: look up a D1 character's stat and roll `1d20+mod` in one call

All character stats read exclusively from D1 `characters` table. Dice routed through `math_manage` (crypto-backed RNG). Events emitted to `event_inbox` after each resolution.
