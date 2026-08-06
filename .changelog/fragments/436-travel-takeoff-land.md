## feat: add travel.takeoff and travel.land actions (slice 2 of #436)

Add two new actions to the `travel` dispatcher for aircraft landing-zone mechanics:

- **`travel.takeoff`** — Aircraft departure from a hex. Checks landing-zone class against aircraft-class minimum requirements, applies weather gate (storm/heavy precipitation/low visibility/high crosswind block), then resolves via pilot skill check with LZ-class-based DC modifier. Outcomes: success (clean departure), aborted (fuel wasted, retry), crash (runway overrun damage).
- **`travel.land`** — Aircraft arrival at a hex. Same LZ validation and weather gate as takeoff, then pilot skill check resolves via landing-specific outcomes: success (clean landing), go-around (fuel wasted, retry), hard_landing (airframe/gear damage), crash.

Both actions compute the destination hex's landing zone from biome + slope (reusing the `computeLandingZone` helper from world-map.ts, #656) and implement the weather gate by calling `handleWeatherManage` (if weather.found === false, proceeds as clear). Aircraft class (e.g., "light_fixed_wing", "rotorcraft") is caller-supplied as a string parameter; minimum LZ requirements are defined inline per class. Difficulty modifier (-5 to 0) applies based on LZ class (runway easiest, unlandable hardest).

Deferred (not in scope): `landing_zone_override` D1 column for manually-cleared strips, aircraft-class registry.

Includes comprehensive test coverage for LZ class rejection, weather gating, and each outcome tier across both actions. Ensures test parameters allow reachable outcome branches (e.g., hard_landing reachable at clearing difficulty, not just at natural 1 crit).
