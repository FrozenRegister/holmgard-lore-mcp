### Added

- A fast unit-test tier (`vitest.unit.config.ts`, `pnpm test:unit`) for genuinely pure functions that don't need the Workers/miniflare runtime — `scoreMatch`, `countOccurrences`, `parseKvEntry`, `normalizeLocationKey`. These are excluded from the main `vitest.config.ts` run (which stays the source of truth for tool behavior, driven end-to-end via `SELF.fetch`) and run in a dedicated `unit-tests` CI job.
- Exported `scoreMatch` (previously module-private in `src/tools/system.ts`) so it can be unit tested directly; no behavior change.
