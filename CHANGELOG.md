# Changelog

## [Unreleased]

### Changed

- **Changelog format migrated to fragments** — PRs no longer edit `CHANGELOG.md` directly. Each PR adds a `.md` file under `.changelog/fragments/`; fragments are assembled into this file at release time, eliminating merge conflicts on parallel PRs. See `.changelog/fragments/` for pending entries.

- **API surface convention documented; D1 map readback re-specced as MCP, not REST** — Added an "API surface convention" section to `CLAUDE.md`: reads/queries belong on `POST /mcp` (JSON-RPC, as `tools/call` tools plus bare-method aliases like `get_lore`/`list_topics`), while privileged writes and bulk admin ops stay on `POST /admin/*` gated by `ADMIN_SECRET`. Reworked `docs/d1-readback-api-design.md` accordingly: the planned map readback is now three `/mcp` methods (`get_map_hexes`, `get_map_landmarks`, `get_map_meta`) returning structured JSON in `result`, instead of the previously-drafted `GET /map/{mapId}/...` REST routes. Map **push** endpoints (`/admin/map/push-*`) are unchanged. Planning/docs only — no code change yet; the MCP methods remain in the backlog.

- **Pre-commit policy: fast local gate, CI as the full gate** — Shifted the local validation workflow away from running the full `pnpm test` suite (~5–6 min on Windows) before every commit. Locally you now run the fast checks (type-check, lint, markdown) plus only the test file(s) you touched; the full Node 20 + 22 matrix and 100% patch coverage run in CI (~2 min wall-clock). Updated `CLAUDE.md` (Pre-Commit Validation, Git workflow, Coverage sections) and reworked `scripts/pre-commit-validate.ps1` / `.sh` to add type-check + lint steps and make the full suite opt-in (`-WithTests` / `--with-tests`) instead of on-by-default. Also corrected a stale `@vitest/coverage-v8` reference in `CLAUDE.md` (the project uses `@vitest/coverage-istanbul`), and set MD024 `siblings_only` in `.markdownlint.yaml` so the Keep-a-Changelog `### Added`/`### Changed`/`### Fixed` headings can legitimately repeat across versions.

### Added

- **Explicit entity relations (Phase 9 — Holmgard OS #161)** — New `entity_relations` D1 table (`schema/migrations/0004_entity_relations.sql`) supporting typed, bidirectional relations between any two entities (characters, locations, nations, regions, quests, items). New read endpoint `GET /api/entities/:type/:id/relations` merges both directions (from + to) ordered by pinned-first. Three admin endpoints: `POST /admin/relations` (create with full field set), `PATCH /admin/relations/:id` (update relation_type/attitude/is_bidirectional/color/is_pinned/is_private/notes), `DELETE /admin/relations/:id`. All admin routes require `X-Admin-Secret` header. Full integration test suite in `src/__tests__/entity-relations.test.ts` (35 cases). `normaliseRelation` exported for future reuse.
- **Test coverage for 16 unregistered RPG handlers** — Added direct-import test files for all handlers not wired into `rpgToolRegistry`: `aura-manage`, `batch-manage`, `corpse-manage`, `improvisation-manage`, `inventory-manage`, `item-manage`, `narrative-manage`, `npc-manage`, `perception-manage`, `secret-manage`, `session-manage`, `spawn-manage`, `theft-manage`, `travel-manage`, `turn-manage`, `world-map`. Also fixed a bug in `world-map` handler where `overview` queried non-existent `theme` and `lore_summary` columns from the `worlds` table.
- **Entity detail endpoints for nations, regions, quests, quest log, and items (Phase 8 — Holmgard OS)** — `GET /api/entities/nations/:id`, `GET /api/entities/regions/:id` (with LEFT JOIN to `nations` for `owner_nation_name`), `GET /api/entities/quests/:id`, `GET /api/entities/quests/:id/log` (returns `quest_logs` entries ordered by `created_at`), and `GET /api/entities/items/:id`. Existing list endpoints refactored to use shared normaliser functions (`normaliseNation`, `normaliseRegion`, `normaliseQuest`, `normaliseItem`) for consistency. 20 new unit tests (4 per endpoint: happy path, 404, missing-field default, 500 on throw). (part of holmgard-lore-editor#143)
- **Location detail + occupants endpoints (Phase 6 — Holmgard OS)** — `GET /api/entities/locations/:id` returns a single room_node by id with `biome_context`, `base_description`, `visited_count`, `last_visited_at`, `local_x`, `local_y`, `network_id`; `GET /api/entities/locations/:id/occupants` returns all characters with `current_room_id = id`. Character list and single-character endpoints now include `current_room_id` so editors can link characters to their current location. Normaliser updated; 11 new unit tests (total entity-reads tests: 55). (part of holmgard-lore-editor#143)
- **Character relationship + inventory endpoints (Phase 5 — Holmgard OS)** — `GET /api/entities/characters/:id/relationships` returns bidirectional NPC relationships (from `npc_relationships`, both directions) and co-party members (from `party_members` + `parties` join); `GET /api/entities/characters/:id/inventory` returns `inventory_items` joined with `items`. Both normalise missing fields to safe defaults. 8 new unit tests (total entity-reads tests: 44). (part of holmgard-lore-editor#143)
- **Edge-case tests for `GET/PATCH /characters/:id`** — 5 new unit tests covering partially-populated D1 rows, single-field PATCH, `X-Api-Key` fallback auth, 200 for non-existent character id, and silent dropping of `id`/`kv_origin`.
- **Coverage: 503/500 error paths for `GET/PATCH /characters/:id`** — Added `/* c8 ignore next */` on unreachable 503 guards and 4 new tests covering null RPG_DB and throw scenarios.
- **Character detail + write endpoints (Phase 2+3)** — `GET /api/entities/characters/:id` and `PATCH /api/entities/characters/:id`.
- **REST entity list endpoints for D1 reads** — `src/api/entity-reads.ts` Hono sub-router with six GET endpoints.
- **`entity_manage` consumption timeline actions** — `create_consumption_timeline` and `set_consumption_timeline`.
- **`agent_manage` test suite expanded** — 88 total tests (64 integration + 24 unit).
- **`agent_manage` characterId support** — slice, journal, and secrets operations now accept `characterId`.
- **`character_manage` test suite** — 46 tests; registered in `rpgToolRegistry`.

### Fixed

- **`mockD1Meta` type annotation** — Changed to `D1Meta & Record<string, unknown>` to fix TS2322 errors.
- **Codecov patch branch coverage for catch-block ternaries** — Added `/* istanbul ignore next */` to unreachable `String(e)` branches in `entity-reads.ts`.
- **Per-action `inputSchema` for all consolidated MCP tools** (closes #144) — Replaced `OPEN_SCHEMA` with per-tool `oneOf` JSON Schema definitions.
- **WebSocket reconnect rate limiting** — 10 WebSocket upgrade attempts per IP per 60 seconds; returns 429 with `Retry-After`.
- **Slack alert on WebSocket rate limit** — Posts to `SLACK_WEBHOOK_URL` on first excess request per window.
- **CSP reports no longer stored in KV** (closes #135) — `/csp-report` endpoint now logs to `console.log` only; `/admin/gc` purges existing `_csp_report:*` keys.
- **`POST /internal/map-readback`** — Internal endpoint for hex map cold-start readback.
- **`POST /admin/set-lore-batch` and `POST /admin/delete-lore-batch`** — Bulk admin endpoints; reduces sync from 101 HTTP requests to 2.
- **Request-scoped KV list caching** (closes #26) — `src/lib/cache.ts` eliminates redundant `kvList()` calls within a single request.
- **`resolveIndexedEntities` utility extraction** (#9) — Extracted repeated index-fallback-scan pattern to `src/lib/indexes.ts`.
- **`list_consumption_timelines` pagination** (closes #4) — Added `limit` and `offset` parameters.
- **Tool Definitions Type Safety** — Added proper TypeScript type definition for `toolDefinitions` array (closes #12).
- **`continuity_manage.list_tags`** (closes #58) — Enumerates all tags via `_tags:*` KV keys.
- **`get_sensory_profile` species fallback with source tracking** (#44) — Fixed namespace prefix bug; added `sensory_source` field.
- **`get_faction_standing` Tags fallback** (#46) — Extended to check `Tags:` field; added `membership_source` field.
- **`get_lore_section` semantic suggestions** (#43) — Returns `suggestions` field with synonym matching and Levenshtein scoring.
- **`get_inventory` / `transfer_item` line-separated inventory** (#41) — Parser now accepts both comma-separated and line-separated formats.
- **`extractActiveThreads` regex** (closes #152) — Changed `(\w+)` to `([^)]+)` to capture full lore keys including colons and dashes.

### Closed (Triage)

- **Issue triage & cleanup** — Closed 14 stale/superseded issues from the #108 cluster map.
