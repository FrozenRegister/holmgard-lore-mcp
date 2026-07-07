### Character Update PATCH Semantics & Ability Modifiers

**Fixed Issue #225** — character.update data loss and missing computations.

**Breaking behavior fixes:**
- Update now uses PATCH semantics: fields not provided in the update request are preserved. This fixes data loss where level and HP were silently reset to defaults.
- `characterClass` parameter now accepted and respected in update (was hardcoded to "Fighter").
- `born` field now supported on both create and update (required for timeline.get_age).
- `race` field now accepted on update (was ignored).

**Auto-computed fields** — returned in character.get:
- `ability_modifiers` — derived from stats using D&D 5e formula: (stat - 10) / 2, floored.
- `ac` — defaults to 10 + DEX modifier if not explicitly set.
- `perception_bonus` — defaults to WIS modifier if not explicitly set.
- `stealth_bonus` — defaults to DEX modifier if not explicitly set.

**Schema improvements:**
- Removed `.default()` values from InputSchema to prevent defaults being applied during updates. Defaults now apply only during character creation.

**Tests:**
- Added 13 test cases covering ability modifier computation, PATCH semantics preservation, and new field support.
- All 1725+ test cases pass with 100% patch coverage.
