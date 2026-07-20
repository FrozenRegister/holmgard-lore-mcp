## Wire dissolution config resolution into advance_stage (#472, #471)

### Fixed

- `entity_manage.advance_stage` no longer silently no-ops sensory/mechanical dissolution mutations for stages beyond 5 (#471). It now resolves a per-character `DissolutionConfig` (via the new `dissolution_id` → per-instance KV config → seeded default → in-memory default lookup chain) instead of always using the hardcoded 5-stage table introduced in #441 and left unwired by #448/#473.
- Added a `stage_exceeds_config` response flag for the remaining edge case (an entity's own tracked stage total exceeds what its resolved config actually defines) — surfaced instead of silently doing nothing.

### Changed

- `resolveDissolutionConfig`/`loadDissolutionConfigFromKV` moved from `migrate-dissolution-config.ts` into `dissolution.ts` — these are live request-path reads, not one-time migration operations, so they belong outside the `migrate-*.ts` coverage-gate exclusion in `vitest.config.ts`.
- `migrate-dissolution-config.ts` now only contains the one-time `seedDissolutionConfigKV` deploy step; `SerializedConfig` gained a `terminalStage` field (version bumped to 2 — nothing has ever been seeded in production, so no live data migration is needed).
