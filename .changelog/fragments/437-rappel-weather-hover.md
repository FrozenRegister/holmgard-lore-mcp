## Slice 2: Weather Modifiers and Pilot Hover Stability Check

**Added to `travel.rappel` action (slice 2 of #437):**

- **Weather modifiers**: The action now queries the weather forecast for the rappel's world/day. If weather data exists:
  - Wind > 25 knots applies -4 penalty
  - Rain/light precipitation applies -2 penalty (wet rope)
  - Storm prevents rappelling entirely (no roll attempted)
  - Clear weather applies no modifier
  - If weather data is missing (`found: false`), no modifier applied (consistent with #436 slice 2 treatment)

- **Pilot hover-stability check**: Added optional `pilotCharacterId` and `pilotProficient` parameters.
  - **Standard conditions** (no adverse weather): Pilot auto-passes, no roll needed
  - **Adverse weather**: Pilot makes a skill check using the same dice infrastructure as the rappeller (DC 12, same weather modifier applied)
    - Success: Hover holds stable, no penalty to rappeller
    - Failure: Hover unstable, rappeller gets additional -2 penalty
    - Critical failure (nat 1): Pilot loses control; rappeller must make DEX save (DC 12) or take fall damage from full height
  - Under-fire pilot checks remain deferred (no combat-state integration in this slice)

- **Combined modifiers**: All modifiers (height, weather, pilot failure) stack correctly in the `roll.modifier` field.

**Deferred for later slices:**
- Persistent character proficiency storage (still open schema question)
- Equipment/rappel-kit durability tracking
- Multi-personnel sequencing and advantage mechanic
