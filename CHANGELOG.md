# Changelog

## [Unreleased]

### Added

- **Phase 3: Mnehmos RPG engine tools (27 tools + 2 meta)** — Ported 27 transport-agnostic `(env, args) => McpResponse` handlers from Mnehmos v1.0.3 (`2feba24`) into `src/rpg/handlers/`. Each handler is wrapped into the existing `ToolHandler` format via a `wrap()` factory in `src/rpg/registry.ts`. Tool definitions live in `src/rpg/definitions.ts` and `src/rpg/meta-definitions.ts`, merged into the top-level `toolDefinitions` array so `tools/list` on both MCP paths now returns 88 tools (59 existing + 27 RPG + 2 meta). Handlers cover: `math_manage`, `world_manage`, `character_manage`, `party_manage`, `quest_manage`, `item_manage`, `inventory_manage`, `corpse_manage`, `narrative_manage`, `secret_manage`, `theft_manage`, `aura_manage`, `improvisation_manage`, `npc_manage`, `session_manage`, `combat_manage`, `combat_action`, `combat_map`, `spawn_manage`, `strategy_manage`, `turn_manage`, `spatial_manage`, `world_map`, `batch_manage`, `travel_manage`, `perception_manage`, `scene_manage`, plus meta-tools `search_tools` (fuzzy name/description search) and `load_tool_schema` (return full JSON schema by name). All 16 RPG integration tests pass in `src/__tests__/rpg-tools.test.ts` covering world/character/party/quest/scene/strategy/math/combat/spatial round-trips against a miniflare D1 instance seeded via `setupRpgDb`. Protocol-basics and DO-transport tests updated to assert 88 tools.

- **Phase 2: Admin map routes** — Implemented `POST /admin/map/push-hexes` and `POST /admin/map/push-landmarks` endpoints in the Hono admin router (`src/admin/routes.ts`). Both routes accept the same three-path auth as existing admin routes (`X-Admin-Secret` header, `X-Api-Key` header, or `body.secret`). Hexes are upserted into the D1 `hexes` table with `INSERT OR REPLACE`, mapping editor fields (`name` → `label`, `description` → `data` JSON). Landmarks are upserted into `landmarks`, mapping `type` → `category` and packing `notes`, `attributes`, `linkedMapId`, `visible`, `linkedLoreKey` into the `data` JSON column. Both routes chunk requests at 100 rows per D1 `batch()` call to stay within D1 per-call limits. Response: `{ ok: true, count: N }`. Added 18 vitest tests in `src/__tests__/admin-map.test.ts` covering insert, upsert, default `map_id`, empty payloads, field storage, and auth rejection for both routes. Satisfies `mapSync.ts` contract in `holmgard-lore-editor`.

- **Phase 1: D1 database schema** — Created `schema/rpg-schema.sql`, a consolidated D1-compatible schema ported from the Mnehmos RPG engine (`migrations.ts`). All incremental `ALTER TABLE` migrations are collapsed into clean `CREATE TABLE` definitions ordered by FK dependency. Adds 49 tables covering worlds, regions, characters, encounters, combat, items, inventory, quests, parties, nations, secrets, agents, narrative notes, scenes, and spatial/perception systems. Adds two new tables not in Mnehmos (`hexes` and `landmarks`) for the hex map editor backed by `/admin/map/*` routes. Added `RPG_DB: D1Database` binding to `wrangler.jsonc` (production ID `17fa8cb0`, preview ID `a4e1cfb9`), `AppBindings`, and `DOEnv`. Added `src/__tests__/setup-d1.ts` helper (`setupRpgDb`) for seeding D1 in Workers runtime tests via a `?raw` SQL import. Schema applied to both production and preview databases; verified via `sqlite_master` (50 tables including `hexes` and `landmarks`).

- **Live production smoke tests (Vitest)** — Replaced Pester PowerShell integration tests with TypeScript Vitest tests in `tests/live/`. 88 tests across 15 files cover all existing tool behaviours; tests run in the VS Code test explorer alongside the Workers runtime suite. `vitest.workspace.ts` defines two projects: `workers` (miniflare, existing) and `live` (node, production HTTP). `pnpm test` still runs only the Workers suite; `pnpm test:live` runs smoke tests against the deployed worker. Requires `MCP_API_KEY` env var; admin tests skip if `ADMIN_SECRET` is unset.

- **Phase 0: McpAgent Durable Object transport (Streamable HTTP)** — Wired `HolmgardMCP extends McpAgent` alongside the existing hand-rolled JSON-RPC handler with zero behavior changes for legacy clients. Requests carrying `Accept: application/json, text/event-stream` or `Mcp-Session-Id` are routed to the DO via `HolmgardMCP.serve()` middleware; all other `/mcp` traffic (legacy JSON-RPC POSTs, bare methods, GET probes) falls through to the existing Hono handler verbatim. The DO exposes all 59 tools using the SDK's low-level `Server` class with `toolDefinitions` returned byte-identical from `ListToolsRequestSchema`, dispatching into the existing `toolRegistry` via a synthetic Hono context adapter. Adds `nodejs_compat` flag, `MCP_OBJECT` DO binding + `new_sqlite_classes` migration to `wrangler.jsonc`, and 13 new vitest tests covering routing, auth, initialize, tools/list, and tools/call on the DO path.

- **CSP violation reporting endpoint** — Implemented `POST /csp-report` Worker endpoint to collect Content-Security-Policy violations from browsers and Tauri apps. Violations are logged to console and stored in KV with timestamp, blocked-uri, violated-directive, and source-file information. Lays foundation for future CSP admin dashboard. (Issue #71)

- **Claude Code Protocol: Pre-Commit Validation Required** — Updated CLAUDE.md to explicitly state that pre-commit validation via `./scripts/pre-commit-validate.ps1` is REQUIRED before creating any commit. Formalizes that Claude Code acts as a team member and validates locally before committing, not waiting for GitHub Actions. Protocol documented in project memory system for consistency across sessions.

- **Pre-Commit Validation Scripts** — Added local validation to catch common issues without waiting for GitHub Actions. Includes PowerShell script for Windows developers (`scripts/pre-commit-validate.ps1`) and Bash hook for Unix users (`.git/hooks/pre-commit`). Validates markdown linting, CHANGELOG.md requirements, and test suite. Documented in CLAUDE.md with usage examples. (Issue #6)

- **Testing & Linting Documentation** — Created comprehensive `docs/testing-and-linting-guide.md` documenting test suite status (384 passing tests), type-check status, known linting issues (284 pre-existing problems), and step-by-step process for fixing lint errors. Referenced from CLAUDE.md for easy access during development.

- **Handoff Packet for Editor Automation Setup** — Created `docs/HANDOFF-editor-automation-setup.md` providing complete instructions for replicating the AI automation pipeline in holmgard-lore-editor repository. Includes phase-by-phase implementation plan, files to copy/adapt, architecture differences, key configuration notes, and success criteria.

- **GitHub Actions Automation Pipeline** — Implemented 8 new workflows for AI-driven issue triage, agent assignment, and PR quality enforcement. (Issue #33)
  - **Issue Tagger** (`issue-tagger.yml`) — Automatically labels issues by surface area (API, state, utils, build, docs, tests, admin) and complexity depth (0–4) using keyword heuristics.
  - **Parallelization** (`parallelize-issues.yml`) — Groups open issues into parallelizable batches on manual dispatch; issues in the same batch share surface areas and must run sequentially.
  - **Agent Assignment** (`agent-assignment.yml`) — Assigns AI agents to each batch (even batches → claude, odd → cline) when a batch label is applied.
  - **Agent Trigger** (`agent-trigger.yml`) — Posts standardized work-order prompts with full implementation workflow when an agent label is applied.
  - **PR Quality Enforcement** (`pr-quality.yml`) — Requires CHANGELOG.md and docs changes in every PR; includes `skip-quality-checks` escape hatch for hotfixes.
  - **Auto-Merge** (`auto-merge.yml`) — Queues PRs for auto-merge when `auto-merge` label is applied (after CI passes).
  - **Label Bootstrap** (`setup-labels.yml`) — Manual workflow to create all 24 required labels (surface, depth, batch, agent, quality).
  - **Enhanced CI** — Upgraded `ci.yml` to include `type-check` and `lint` jobs alongside tests; removed `continue-on-error: true` so CI failures block merges.
  - **Pipeline Documentation** (`docs/ai-automation-pipeline.md`) — Complete guide to the automation system, label meanings, workflow triggers, and troubleshooting.

### Fixed

- **TypeScript: `inject('d1Migrations')` type error** — Added `src/__tests__/vitest.d.ts` augmenting vitest's `ProvidedContext` interface with `d1Migrations: D1Migration[]`, resolving `TS2345: Argument of type '"d1Migrations"' is not assignable to parameter of type 'never'` in the CI type-check job.

- **Lint error in context-adapter.ts** — Removed unused `_status` parameter from the `json` stub in `makeSyntheticContext`. The declared return type (`status?: number`) still accepts the argument; the implementation simply ignores it. Clears the `@typescript-eslint/no-unused-vars` error that blocked CI on Phase 1 PR.

- **TypeScript constraint error in HolmgardMCP** — `McpAgent<Env extends Cloudflare.Env>` requires non-optional bindings. Added `DOEnv` type with required bindings (`LORE_DB`, `ADMIN_SECRET`, `MCP_API_KEY`, `MCP_OBJECT`) for what the DO receives at runtime; switched `HolmgardMCP` to `McpAgent<DOEnv>`. Expanded `src/__tests__/env.d.ts` to declare `MCP_API_KEY` and `MCP_OBJECT` bindings now present in `wrangler.jsonc`. Fixes VS Code test explorer showing all 32 test files as failed.

- **wrangler.jsonc & CLAUDE.md** — Documented KV namespace isolation to prevent production data corruption. Production (`id`: `67b47914eb094043ab777f4f34da8bfc`) and preview (`preview_id`: `d99c543e9ccf46dca6900cc28d93362a`) namespaces are intentionally separate so `wrangler dev` uses isolated preview storage while `wrangler deploy` uses production. Added deployment notes warning against allowing these IDs to be identical, which would cause local development to corrupt production data. (Issue #6)

- **PROTOCOL_INVOCATION.md** — Fixed markdown linting errors where emphasis was incorrectly used instead of headings (MD036/no-emphasis-as-heading). Changed bold text error descriptions to proper heading levels.

- **CI workflow (`.github/workflows/ci.yml`)** — Fixed `actions/setup-node` cache setup failures by installing pnpm *before* calling `setup-node` (moved `pnpm/action-setup@v2` before `actions/setup-node@v4` in all three jobs). Also downgraded pnpm from 11.5.1 to 10.15.0 to support Node 20 testing; pnpm 11.5.1 requires Node 22.13+. (Issue #37)

- **admin/routes.ts** — `POST /set-lore` now properly rejects empty, null, whitespace-only, and non-string keys (e.g. numbers, arrays) with a 400 response. Previously, non-string values slipped through to KV, potentially creating garbage entries with empty keys. The validation now uses `typeof` checks and a shared `extractKey()` helper used by all admin routes. (Issues #1, #7)

- **admin/routes.ts** — `extractText()` now trims whitespace, so whitespace-only text values are rejected with 400 instead of being stored.

### Changed

- **admin/routes.ts** — Extracted shared `extractKey()`, `extractText()`, `extractSecret()`, and `checkSecret()` helpers to eliminate copy-paste drift across `set-lore`, `delete-lore`, and `gc` routes. Auth checks now flow through a single `checkSecret()` function. (Issue #1)
