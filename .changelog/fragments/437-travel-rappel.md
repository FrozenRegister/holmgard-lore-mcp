# travel.rappel action (slice 1 of #437)

## Feature
Add new `travel.rappel` action for rotorcraft personnel insertion without landing.

### Parameters
- `characterId` (required): Character to rappel down
- `worldId` (required): World context
- `height` (required): Height tier — `"low"` (5–15m), `"high"` (15–30m), or `"extreme"` (30–60m)
- `proficient` (required): Caller-supplied boolean — whether character has rappel proficiency (no persistent schema yet, deferred to #437 Phase 2)

### Logic
- Height-tier DEX modifier: `low` → 0, `high` → -2, `extreme` → -5
- Untrained + extreme height → automatic failure (no roll attempted)
- Otherwise: DEX check with advantage/disadvantage based on proficiency
  - Proficient: standard 1d20 roll
  - Untrained (non-extreme): disadvantage (2d20, keep lowest)
- DC 12 (placeholder — tune once broader skill-DC convention established)
- Outcome via injury table:
  - Success (margin ≥ 0): clean landing, no damage
  - Fail by 1–5: rough landing, 1d4 damage, half speed 1 hour
  - Fail by 6–10: hard landing, 2d6 damage, half speed 24h + disadvantage on DEX
  - Fail by >10: fall, 4d6 + 1d6 per height tier above low
  - Critical fail (natural 1): equipment failure, damage ×1.5

### Out of Scope (Phase 2+)
- Persistent character proficiency storage / schema
- Weather modifiers
- Pilot hover-stability check
- Equipment durability tracking (resource subsystem)
- Multi-personnel sequencing / advantage mechanic
