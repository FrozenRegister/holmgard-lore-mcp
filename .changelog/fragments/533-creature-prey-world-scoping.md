## Scoped creature-AI prey to the creature's world (#533 Gap 1)

### Fixed

- `creature_ai_tick`'s prey query now filters by `characters.world_id` in
  addition to hex-position presence. Previously every positioned character
  across every world was a candidate prey for any creature, so two worlds
  sharing hex coordinates could let a creature in world A detect and hunt a
  character positioned in world B. A character with no `world_id` set
  (legacy rows predating migration 0009, or created without one) is now
  simply not eligible prey in any world, rather than eligible prey in every
  world.

### Not changed

- Gap 2 from #533 (a Shaper's `yield_preference` being inert because
  characters carry no yield-grade field) is unaffected and remains open.
