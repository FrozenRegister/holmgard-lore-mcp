# Add party cohesion system with d20 checks and event tracking

- Added database migration to add `cohesion_score` column to parties table (distinct from morale)
- Added `cohesion_check` action: d20 roll with stress/cooperation modifiers, returns cohesion tier and typed fracture outcomes (betrayal/abandonment/violence/mutual)
- Added `group_break` action: dissolve party with method-specific handling (abandonment, betrayal, death, mutual)
- Added `cohesion_shift` action: apply event-based cohesion deltas using predefined event taxonomy (shared_kill, saved_member, supply_theft_discovered, etc.)
- Implements cohesion tracking independent of morale for Isle of Dissolution narrative gameplay (fixes #306)
