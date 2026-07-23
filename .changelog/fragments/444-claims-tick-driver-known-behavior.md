### Documented tick-driver / claims Known Behavior, closing out #444's docs checklist

- Added a "Simulation Layer — Tick Driver and Claims" section to `CLAUDE.md` covering: `runTickDriver` executes hooks once per call (no per-day batching), the world-level lock, `claimed_at`/`claimed_until` being in-game simulation time (never wall-clock), `resolveTickConflicts` returning one verdict per resource lock rather than per event, and that stale-claim detection is reactive only (no proactive death-clearing until #445).
- Flags the still-open `dry_run`/atomicity gap in the tick driver (tracked in #512) that needs resolving before Phase 3 (#445) starts performing real per-tick writes.
