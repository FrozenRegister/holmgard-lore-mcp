## Cross-tick Claims and Conflict Resolution

**Issue:** #444

### New Features
- **Database Migration:** Added `claimed_by`, `claimed_until`, and `claimed_at` columns to the `characters` table
- **Claims System:** New `src/rpg/utils/claims.ts` module with claim management functions
  - `getClaim()` - Retrieve claim information for a character
  - `setClaim()` - Set a claim with validation (rejects empty claimers, detects collisions)
  - `clearClaim()` - Clear existing claims
  - `isStaleClaim()` - Check if a claim has expired
  - `resolveTickConflicts()` - Conflict resolver for flagged events
- **Conflict Resolution:** Integrated into tick driver to handle multi-party resource conflicts
  - Returns discriminated union: `resolved | modified | deferred`
  - Orders by priority (CRITICAL > HIGH > MEDIUM > LOW) then FIFO
  - Handles "locked by me" vs "locked by others" scenarios
  - Includes narrative context for modified events

### Technical Details
- **Migration 0042:** Adds nullable claim columns with no DEFAULT clause
- **Claim Validation:** Rejects empty claimers, detects active claim collisions
- **Stale Claim Handling:** Treats expired claims as unclaimed
- **Conflict Resolution:** Provides narrative context for modified events
- **Tick Driver Integration:** Adds `conflict_resolutions` to tick output

### Use Cases
- Shaper tenderizing projects spanning multiple ticks
- Predator-prey interactions with resource locking
- Multi-party scenarios with deterministic resolution
- Narrative coherence in complex interaction webs

### Testing
- Comprehensive unit tests for all claim functions
- Integration tests for conflict resolution scenarios
- Edge case testing (stale claims, self-claiming, priority ordering)
- 100% patch coverage for new code