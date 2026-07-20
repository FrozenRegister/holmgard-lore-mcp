### Added

- **KV migration for dissolution config** — `src/rpg/utils/migrate-dissolution-config.ts` seeds `dissolution:config:phase0-5` into KV on first deploy. Idempotent: skips if version matches, updates on stale version, never overwrites newer data. `seedDissolutionConfigKV()` for deploy-time seeding, `loadDissolutionConfigFromKV()` for runtime fallback to in-memory defaults.
