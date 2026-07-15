# Add comprehensive test coverage for Issue #391 Cluster 4 features

- Added 31 test cases for cohesion system (cohesion_check, group_break, cohesion_shift) covering d20 mechanics, tier classification, modifier application, weighted outcomes, and clamping
- Added 13 test cases for NPC CRUD operations (list, get, update, assign_to_location) covering all error paths and location/hex variants
- Added 3 test cases for custom and production event type emission
- Achieves 100% patch coverage on all new RPG handler code (fixes coverage gap from PR #396)
