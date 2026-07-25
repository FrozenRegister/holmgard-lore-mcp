# Holmgard MCP — Architecture

This document covers the *how* — request flow, storage layers, and the key design
patterns a contributor needs before touching handler code. For the *what* (tool
inventory, input/output shapes), see `COMPLETE_TOOL_REFERENCE.md`. For AI-agent-facing
conventions and gotchas, see `CLAUDE.md`.

## Scale and constraints — read this before proposing infrastructure

**This is one Cloudflare Worker, not a distributed system.** Every design proposal,
red-team review, or CI-tooling suggestion should be checked against what's actually
here before it's written down:

- **One process, one deploy target.** `wrangler deploy` ships a single Worker script.
  There is no fleet, no cluster, no multi-region rollout, and no container of any
  kind — no Dockerfile exists in this repo and none is planned.
- **One CI runner per job, on GitHub-managed infrastructure.** GitHub Actions already
  timestamps every step and isolates every job's resource usage. There is no
  clock-drift risk to detect (nothing coordinates across independent machines) and
  no capacity-planning need (Cloudflare's platform limits, not our CI runners, are
  the actual constraint).
- **A small, closed tool surface.** ~15 MCP tools total, all defined in this repo,
  all reviewed by the same people. This is not a plugin ecosystem or a multi-tenant
  API — proposals that assume untrusted third-party integrations or a large surface
  area to defend don't apply here.
- **Storage is free-tier KV + a small D1 database**, not a data platform. See
  `docs/storage-selection-kv-vs-d1.md` before proposing new storage tooling.

**If a proposal reaches for concepts from distributed-systems ops** (clock-drift
detection, per-service resource telemetry, container image diffing, schema-registry
validation frameworks, multi-run correlation IDs) **— check first whether the thing
it protects against can actually happen at this scale.** Issue #484 is a worked
example: a CI-artifact design proposal accumulated several enterprise-scale
recommendations (Dockerfile diffing in a repo with no Docker; clock-drift detection
for a single GitHub-managed runner) that didn't survive a check against this section.
The fix in each case wasn't a bigger tool — it was reading this file first.

## Two subsystems, one worker

The codebase grew in two phases and both are live in production:

1. **The lore system** (`src/tools/`) — five top-level `*_manage` tools
   (`lore_manage`, `entity_manage`, `world_manage`, `scene_manage`,
   `continuity_manage`), each an action-dispatcher over a flat markdown-in-KV
   store. This is the original system and is what `CLAUDE.md` documents in depth.
2. **The RPG engine** (`src/rpg/`) — combat, inventory, NPCs, quests, spatial
   reasoning, etc. Exposes a handful of top-level tools (`rpg`, `agent_manage`,
   `character_manage`, `search_tools`, `load_tool_schema`) plus a single-dispatcher
   pattern: `rpg({ sub, action, ...rest })` routes to one of ~46 handler files under
   `src/rpg/handlers/`. Character data here is migrating from KV to D1
   (`src/rpg/utils/kv-to-d1.ts` maps KV character text to D1 rows;
   `migrate-kv-to-d1-bulk.ts` does the bulk backfill) — see issue #154 for the
   in-progress KV→D1 unification design.

Both subsystems register into the same flat `toolRegistry` (`src/tools/registry.ts`
merges `rpgToolRegistry` from `src/rpg/registry.ts`) and are dispatched identically
by the MCP entry point — an agent calling `tools/call` can't tell which subsystem
it's talking to, and doesn't need to.

## Request flow

```
HTTP request
  → Hono app (src/index.ts)
  → rate-limit middleware (src/middleware/rate-limit.ts)
  → CORS middleware
  → route match:
      POST /mcp  → Streamable HTTP? → HolmgardMCP Durable Object (McpAgent)
                 → else             → legacy hand-rolled JSON-RPC handler
      /admin/*   → src/admin/routes.ts   (ADMIN_SECRET-gated REST)
      /internal/* → src/internal/routes.ts (ADMIN_SECRET-gated REST, editor↔worker ops)
      /api/entities/* → src/api/entity-reads.ts (open, D1-backed list reads)
      /changes   → src/changes/route.ts (delta sync for the editor)
      /health, /csp-report → inline handlers
  → tools/call: toolRegistry[toolName]({ c, id, args, isAuthenticated })
  → Zod schema validation → handler logic → KV/D1 read-write → JSON-RPC response
```

### Why two `/mcp` code paths

`/mcp` serves two kinds of clients from one route:

- **Streamable HTTP clients** (spec 2025-03-26, detected via `Mcp-Session-Id` header
  or an `Accept: application/json, text/event-stream` pair) are handed off to the
  `HolmgardMCP` Durable Object (`src/do/HolmgardMCP.ts`), an `McpAgent` from the
  `agents` SDK. It builds a synthetic Hono-like context (`src/do/context-adapter.ts`)
  so the *same* tool handlers run unmodified inside the DO.
- **Legacy raw JSON-RPC clients** (older MCP clients, and the bare-method aliases
  like `get_lore`/`list_topics`/`get_lore_batch`/`get_topic_histories` used by the
  editor's `rpc()` transport) are handled directly in `src/index.ts`'s `app.post('/mcp')`.

Both paths call into the same `toolRegistry`, so a handler is written once and
works from either transport.

### Auth model

Two independent secrets gate two independent surfaces:

- `MCP_API_KEY` (header `X-Api-Key`) gates the agent-facing MCP surface
  (`tools/call`, legacy bare methods). `lore_manage`'s `ping`/`auth_check` actions
  are always open so a client can probe connectivity/auth before authenticating.
- `ADMIN_SECRET` (header `X-Admin-Secret` or `X-Api-Key`, see `checkSecret()` in
  `src/internal/routes.ts`) gates `/admin/*` (bulk/privileged writes) and
  `/internal/*` (editor↔worker operational calls, e.g. map readback pushes).

`/api/entities/*` and `/changes` are intentionally open — they're read-only list/delta
endpoints, consistent with `/mcp`'s own read paths.

## Storage layers

| Binding | Type | Role |
|---|---|---|
| `LORE_DB` | KV namespace | Source of truth for the lore system. Falls back to a module-level `loreDB` in-memory object when the binding is absent (local dev without bindings) — see `src/lib/kv.ts`. |
| `RPG_DB` | D1 database | Source of truth for RPG character data (in-progress migration off KV) and the read-only `/api/entities/*` list endpoints. |

KV entries are stored as `JSON.stringify({ text, meta: { version, updatedAt, createdAt } })`;
`parseKvEntry()` handles this plus the legacy plain-string format.

## Key patterns

### Index-fallback pattern

Three index families keep common lookups off full KV scans:
`_idx:location:<key>`, `_idx:thread:<id>`, `_idx:prefix:<prefix>` (see `src/lib/indexes.ts`).

1. Try the index first (`getIndexedKeys()`) — O(1).
2. If it doesn't exist (fresh store, or a location/thread index that was never
   built), fall back to `kvList()` + filtering — O(n), but keeps tests and
   fresh deployments working without a backfill step.
3. `updateIndexes()` is called after every lore write (`set_lore`, `batch_set_lore`,
   `batch_mutate`, `delete_lore`) to keep indexes current.

Index writes are **best-effort, not atomic** — KV has no compare-and-swap, so two
concurrent writers updating the same index can lose an update. Acceptable for the
current traffic profile; moving index writes to a Durable Object would fix it if
it ever isn't (noted inline in `src/lib/indexes.ts`).

### History snapshots and the changelog

- **History** (`src/lib/history.ts`): before any overwrite, `pushHistory()` unshifts
  the pre-write raw value onto `_history:<key>` (array, capped at `HISTORY_DEPTH`).
  This is what `restore_lore` rolls back to, and what makes destructive-looking
  operations (like `check_continuity`'s `auto_fix`) safely reversible.
- **Changelog** (`_changelog`, capped at `CHANGELOG_MAX`): every write appends
  `{ key, version, updatedAt, op }` via `appendChangelog()`. The editor's `/changes`
  endpoint reads this single key to do delta-only sync instead of re-fetching
  every topic.

### Action-dispatcher tools

Every `*_manage` tool (lore system) and the RPG engine's `rpg` tool follow the same
shape: a thin dispatcher (`continuity-manage.ts`, `rpg-handler.ts`, etc.) maps an
`action` (or `sub`+`action`) string to a handler function, validates the rest of
`args` with a per-action Zod schema, and returns a uniform JSON-RPC result. This
keeps the MCP tool count low (agents see 10 top-level tools — 5 lore-system
`*_manage` tools plus `rpg`, `agent_manage`, `character_manage`, `search_tools`,
`load_tool_schema` — not 70+) while still exposing fine-grained operations.

## Patch pipeline for remote agents

This repo includes an async patch pipeline (issue #554) for remote AI agents that
need to make small, targeted edits to a narrow allowlist of low-risk paths
(`docs/**`, `.changelog/fragments/**`, `README.md`, `CONTRIBUTING.md`, `TODO.md`)
without rewriting entire files. See [`docs/patch-pipeline-agent-guide.md`](docs/patch-pipeline-agent-guide.md)
for the full agent-facing documentation and [`.patches/README.md`](.patches/README.md)
for the step-by-step mechanics.

**This is not the primary repo-update mechanism.** Normal file pushes
(`create_or_update_file` / `PUT`) are the default. The patch pipeline exists for
the narrow case where a file is too large to push whole (e.g. `package-lock.json`,
generated files with thousands of lines) and only 1–2 lines need to change.

**Security model (summarized):**

- Path allowlist/deny-list enforced via `git apply --numstat` before applying
- Every patch goes through `git apply --check` (reject anything that doesn't apply cleanly)
- ~200KB size cap
- `.github/**`, `CLAUDE.md`, protocol documents, and this file (`ARCHITECTURE.md`) are explicitly denied
- Patches land on a PR branch with the same CI and CODEOWNERS review as any human-authored PR; nothing is auto-merged
- The workflow is at `.github/workflows/apply-patches.yml`

## Design decisions

- **Why Hono?** Lightest router with good middleware support for Cloudflare Workers.
- **Why Zod?** Runtime validation with TypeScript inference, and its `safeParse`
  errors feed directly into `invalidParamsError()` for consistent, example-bearing
  error payloads (see `docs/holmgard-user-guide.md` for the resulting agent-facing
  error contract).
- **Why KV for the lore system?** Eventually-consistent, free-tier-friendly key-value
  store — acceptable for a narrative database where a read shortly after a write
  being slightly stale is a non-issue.
- **Why D1 for the RPG engine?** Character/combat state benefits from relational
  queries (party membership, faction standing, D1-backed `/api/entities/*` list
  reads) that don't fit KV's get/list/put model well — hence the in-progress
  KV→D1 migration for that subsystem specifically, not the whole worker.
