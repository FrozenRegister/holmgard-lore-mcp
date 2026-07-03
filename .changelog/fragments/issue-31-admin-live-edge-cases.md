### Added

- `tests/live/admin.test.ts` gains malformed-request edge-case coverage for `/admin/set-lore` and `/admin/delete-lore` against the deployed worker (empty body, null/empty/whitespace/numeric key, empty/whitespace text, wrong secret, missing secret) — mirroring `src/__tests__/admin.test.ts`'s miniflare coverage but run live. (#31)
