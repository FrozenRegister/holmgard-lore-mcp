### Fixed

- `entity_manage`'s `advance_stage` action now reacts to a terminal stage instead of only reporting
  it: writes a `**Terminal-Status:**` KV field (using the linked D1 character's
  `dissolution_terminal` descriptor when resolvable, else a generic fallback), and logs a
  discoverable `timeline_events` row (`verb: 'dissolved'`) when the entity resolves to a
  world-scoped D1 character. Never auto-modifies D1 `hp`/`conditions` — matches `morale_roll`'s
  report-don't-auto-apply precedent. (#420)
