# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                        # run all tests (vitest, Workers runtime)
npm test -- --reporter=verbose  # test output with per-test names
npm run build                   # esbuild bundle → dist/index.js
npm run deploy                  # wrangler deploy to Cloudflare
wrangler dev                    # local dev server (uses wrangler.toml main)
```

To run a single test file or describe block:
```bash
npm test -- --reporter=verbose src/__tests__/worker.test.ts
```

## Architecture

**Single file worker**: all logic lives in `src/index.ts` — a [Hono](https://hono.dev/) app exported as the Workers default export.

**Two storage layers** (in priority order):
1. `LORE_DB` — Cloudflare KV binding, source of truth in production
2. `loreDB` — module-level `Record<string, string>` fallback used only when KV is unavailable (local dev without bindings). Persists across requests within a worker instance.

**KV value format**: entries are stored as `JSON.stringify({ text: string, meta: { version, updatedAt, createdAt } })`. The `parseKvEntry()` helper handles both this format and legacy plain-string values.

**Routes**:
- `POST /mcp` — JSON-RPC 2.0 endpoint. Handles MCP protocol methods (`initialize`, `ping`, `tools/list`, `tools/call`) plus legacy bare methods (`list_topics`, `get_lore`).
- `POST /admin/set-lore` / `POST /admin/delete-lore` — HTTP endpoints protected by `ADMIN_SECRET` env var (set via `wrangler secret put ADMIN_SECRET` in production; injected via `vitest.config.ts` miniflare bindings in tests).

**12 MCP tools** via `tools/call`: `ping_tool`, `list_topics`, `get_lore`, `get_lore_batch`, `set_lore`, `delete_lore`, `search_lore`, `validate_topic_exists`, `list_consumption_timelines`, `list_active_threads`, `increment_topic_field`, `patch_lore`.

## Key logic worth knowing

**`patch_lore`** (`replace`/`append`/`delete_field`) uses exact substring matching. It rejects ambiguous targets (>1 occurrence) and missing targets with descriptive messages rather than JSON-RPC errors — the response is always `result`, never `error`, even for user mistakes.

**`increment_topic_field`** parses `**fieldname:** 10` markdown syntax from lore text, increments the numeric prefix, and writes back. Non-numeric fields return a JSON-RPC error.

**`list_consumption_timelines`** scans only `character:*` keys. It looks for `**Consumption-Timeline:**` (primary) or `**Projected-Consumption-Timeline:**` (legacy fallback). The `status_filter` param (`all`/`imminent`/`days-to-weeks`/`weeks-to-months`/`consumed`) filters by substring patterns in the timeline value.

## Tests

Tests run inside the actual Workers runtime via `@cloudflare/vitest-pool-workers` (vitest 4 plugin API — `cloudflareTest()` in `vitest.config.ts`). KV is in-memory miniflare storage; `ADMIN_SECRET` is `test-secret-123`.

`reset()` from `cloudflare:test` is called `afterEach` to wipe all KV between tests. Seed KV directly with `env.LORE_DB.put(key, JSON.stringify({ text, meta }))` rather than going through `set_lore` — this avoids writing to the module-level `loreDB` fallback and keeps test isolation clean.

## Deployment notes

`wrangler.toml` has the real KV namespace ID (`67b47914eb094043ab777f4f34da8bfc`). `ADMIN_SECRET` must be set as a Cloudflare secret — it is intentionally absent from `wrangler.toml`.
