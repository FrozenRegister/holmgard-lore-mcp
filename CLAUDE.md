# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm test                        # run all tests (vitest, Workers runtime)
pnpm test -- --reporter=verbose  # test output with per-test names
pnpm run type-check              # TypeScript type checking
pnpm run lint                    # ESLint validation
pnpm run build                   # esbuild bundle → dist/index.js
pnpm run deploy                  # wrangler deploy to Cloudflare
wrangler dev                     # local dev server (uses wrangler.toml main)
```

To run a single test file or describe block:

```bash
pnpm test -- --reporter=verbose src/__tests__/worker.test.ts
```

**See [Testing and Linting Guide](./docs/testing-and-linting-guide.md) for details on test status, known linting issues, and how to fix them.**

## Pre-Commit Validation

Before pushing code, run local validation to catch common issues **without waiting for GitHub Actions**:

**On Windows (PowerShell):**

```powershell
.\scripts\pre-commit-validate.ps1          # Run full validation (includes tests)
.\scripts\pre-commit-validate.ps1 -SkipTests  # Skip tests (faster iteration)
```

**What gets checked:**

1. **Markdown Linting** — `pnpm fix:md` (validates all `.md` files, auto-fixes where possible)
2. **CHANGELOG.md** — Requires entry if modifying `src/`, `docs/`, `wrangler.jsonc`, or `CLAUDE.md`
3. **Tests** — Full `pnpm test` suite (can skip with `-SkipTests` for faster iteration)

**Why run locally?** These checks run on GitHub Actions but fail *after* pushing. Running them locally saves CI time and prevents PR quality check failures.

**Setup (optional):** Git can auto-run validation on commit:

```powershell
git config core.hooksPath scripts
```

## Workflows & Protocols

**To resolve a GitHub Issue autonomously:**

```powershell
.\resolve-issue.ps1 -IssueNumber 42
```

This fetches the Issue and generates a copy-paste prompt for Claude Code. See [PROTOCOL_INVOCATION.md](./PROTOCOL_INVOCATION.md) for details.

**Full Issue Resolution Protocol:** See [ISSUE_RESOLUTION_PROTOCOL.md](./ISSUE_RESOLUTION_PROTOCOL.md) for the complete workflow (branching, testing, documentation, PR creation).

## Architecture

**Single file worker**: all logic lives in `src/index.ts` — a [Hono](https://hono.dev/) app exported as the Workers default export.

**Two storage layers** (in priority order):

1. `LORE_DB` — Cloudflare KV binding, source of truth in production
2. `loreDB` — module-level `Record<string, string>` fallback used only when KV is unavailable (local dev without bindings). Persists across requests within a worker instance.

**KV value format**: entries are stored as `JSON.stringify({ text: string, meta: { version, updatedAt, createdAt } })`. The `parseKvEntry()` helper handles both this format and legacy plain-string values.

**Routes**:

- `POST /mcp` — JSON-RPC 2.0 endpoint. Handles MCP protocol methods (`initialize`, `ping`, `tools/list`, `tools/call`) plus legacy bare methods (`list_topics`, `get_lore`).
- `POST /admin/set-lore` / `POST /admin/delete-lore` — HTTP endpoints protected by `ADMIN_SECRET` env var (set via `wrangler secret put ADMIN_SECRET` in production; injected via `vitest.config.ts` miniflare bindings in tests).

**15 MCP tools** via `tools/call`: `ping_tool`, `list_topics`, `get_lore`, `get_lore_batch`, `set_lore`, `delete_lore`, `search_lore`, `validate_topic_exists`, `list_consumption_timelines`, `list_active_threads`, `increment_topic_field`, `patch_lore`, `restore_lore`, `batch_set_lore`, `batch_mutate`.

## Key logic worth knowing

**`patch_lore`** (`replace`/`append`/`delete_field`) uses exact substring matching. It rejects ambiguous targets (>1 occurrence) and missing targets with descriptive messages rather than JSON-RPC errors — the response is always `result`, never `error`, even for user mistakes.

**`increment_topic_field`** parses `**fieldname:** 10` markdown syntax from lore text, increments the numeric prefix, and writes back. Non-numeric fields return a JSON-RPC error.

**`list_consumption_timelines`** scans only `character:*` keys. It looks for `**Consumption-Timeline:**` (primary) or `**Projected-Consumption-Timeline:**` (legacy fallback). The `status_filter` param (`all`/`imminent`/`days-to-weeks`/`weeks-to-months`/`consumed`) filters by substring patterns in the timeline value.

**`batch_set_lore`** writes multiple entries in parallel (`Promise.all`). Not transactional — partial success is possible; per-key results are returned in `results`. Pushes history for each overwritten key.

**`batch_mutate`** applies a list of `increment` or `patch` mutations sequentially (order matters; same key may appear twice). Each mutation reads, modifies, and writes its key. Failures are recorded per-mutation and do not stop the remaining mutations.

**`countOccurrences`** is a module-level helper (extracted from the `patch_lore` handler) used by both `patch_lore` and `batch_mutate` for exact substring counting.

## KV Access Rules (Batch Reads and Index-on-Write)

### Batch Reads — Always Parallelize

When reading multiple KV keys from a list, **never** perform sequential `await` inside a loop.  
Always fetch all values in parallel with `Promise.all`, then process the results:

**Forbidden pattern:**

```typescript
for (const key of keys) {
  const raw = await kvGet(c, key)  // N+1 latency
}
```

**Required pattern:**

```typescript
const raws = await Promise.all(keys.map(k => kvGet(c, k)))
for (let i = 0; i < keys.length; i++) {
  const raw = raws[i]
  if (!raw) continue
  const key = keys[i]
  const { text } = parseKvEntry(raw)
  // ...
}
```

### Index-on-Write System

Indexes are maintained automatically when lore entries are written. Three types of indexes track location, thread membership, and key prefix:

- `_idx:location:<location-key>` — array of entity keys at this location
- `_idx:thread:<thread-id>` — array of entity keys in this thread
- `_idx:prefix:<prefix>` — array of keys starting with this prefix (e.g., `character`, `setup`)

These are built and updated by `updateIndexes(c, key, newText, oldText)` in:

1. `set_lore` — when a lore entry is created or modified
2. `batch_set_lore` — for each entry in the batch
3. `batch_mutate` — after increment or patch mutations
4. `delete_lore` — when an entry is removed

Indexes are **read-through**, not write-through: `getIndexedKeys(c, indexKey)` returns the index if it exists, or falls back to kvList + filtering (for test compatibility where indexes may not be pre-built). For prefix indexes (`_idx:prefix:`), the fallback is fully functional; for location/thread indexes, tools add their own fallback scans if needed.

### Tools Using Indexes (optimized, not full-scan)

- `list_consumption_timelines` — reads `_idx:prefix:character`
- `list_unpaid_setups` — reads `_idx:prefix:setup`
- `get_location_occupants` — reads `_idx:location:<key>`
- `process_stage_batch` — reads `_idx:location:<key>`
- `thread_tick` — reads `_idx:thread:<id>` for the target thread, then kvList for global sync
- `get_thread_comparison` — reads `_idx:thread:<a>` and `_idx:thread:<b>`
- `check_convergence` — reads `_idx:thread:<a>` and `_idx:thread:<b>`
- `scene_brief` — reads `_idx:location:<key>` and `_idx:prefix:setup`

### Exclude Indexes from kvList

Index keys (`_idx:*`) are automatically excluded from `kvList()` results, along with system keys (`_history:*`, `_changelog`, `events:*`, etc.).

## Tests

Tests run inside the actual Workers runtime via `@cloudflare/vitest-pool-workers` (vitest 4 plugin API — `cloudflareTest()` in `vitest.config.ts`). KV is in-memory miniflare storage; `ADMIN_SECRET` is `test-secret-123`.

`reset()` from `cloudflare:test` is called `afterEach` to wipe all KV between tests. Seed KV directly with `env.LORE_DB.put(key, JSON.stringify({ text, meta }))` rather than going through `set_lore` — this avoids writing to the module-level `loreDB` fallback and keeps test isolation clean.

**REQUIRED: Any change to MCP tools or worker logic must update BOTH test suites in the same turn:**

1. **Vitest** (`src/__tests__/worker.test.ts`) — unit/integration tests running in the Workers runtime
2. **Pester integration tests** (`tests/run-all.ps1`) — end-to-end remote tests against the deployed worker

Do not wait to be asked. Both suites must be updated whenever a tool is added, removed, or its behavior changes.

## Git workflow

**Commit messages** should follow conventional commits (`feat:`, `fix:`, `test:`, `refactor:`) and mention the specific tools or routes affected. Example: `feat: add resolve_interaction tool with utility scoring`.

**Before pushing**, always run `npm test` and confirm it passes. Push only to `main` unless working on an isolated experiment.

## Deployment notes

**KV Namespace Isolation (Critical)**: `wrangler.jsonc` has separate production and preview KV namespaces:

- Production `id`: `67b47914eb094043ab777f4f34da8bfc` (LORE_DB) — used by `wrangler deploy`
- Preview `preview_id`: `d99c543e9ccf46dca6900cc28d93362a` (LORE_DB_PREVIEW) — used by `wrangler dev`

This separation is critical: **never allow these IDs to be identical**, or `wrangler dev` will read from and write to production data, corrupting production lore. See [Issue #6](https://github.com/your-repo/issues/6) for details.

`ADMIN_SECRET` must be set as a Cloudflare secret — it is intentionally absent from `wrangler.jsonc`.
