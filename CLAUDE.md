# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm test                        # run Workers runtime tests (vitest run)
pnpm test:coverage               # run Workers tests and generate coverage (lcov → ./coverage/lcov.info)
pnpm test:live                   # run live production smoke tests (vitest run --config vitest.live.config.ts)
pnpm test -- --reporter=verbose  # Workers test output with per-test names
pnpm run type-check              # TypeScript type checking
pnpm run lint                    # ESLint validation
pnpm run build                   # wrangler deploy --dry-run --outdir dist (bundle check)
pnpm run deploy                  # wrangler deploy to Cloudflare
wrangler dev                     # local dev server (uses wrangler.jsonc main)
```

To run a single test file or describe block:

```bash
pnpm test -- --reporter=verbose tests/worker/admin.test.ts
```

Live smoke tests require `MCP_API_KEY` set in the environment. `ADMIN_SECRET` is optional (admin tests skip if unset).

```powershell
$env:MCP_API_KEY = "your-key"; pnpm test:live
```

**See [Testing and Linting Guide](./docs/testing-and-linting-guide.md) for details on test status, known linting issues, and how to fix them.**

## Pre-Commit Validation

**Policy: run fast checks locally, let CI be the full gate.** The full `pnpm test` suite is slow on a local Windows machine (~5–6 min, dominated by filesystem I/O) and the istanbul coverage run is slower still. GitHub Actions runs the *entire* gate — Node 20 + Node 22 matrix, coverage, type-check, lint, and build — in parallel in **~2 minutes** wall-clock. So locally you should validate fast and cheaply, then push and rely on CI to run the full matrix and enforce 100% patch coverage.

What this means in practice:

- **Locally (every iteration):** type-check, lint, and the *specific test file(s) you touched* — not the whole suite.
- **CI (the real gate):** full suite across both Node versions + coverage. Coverage failures surface there with a ~2-min feedback loop; you do **not** need to run istanbul coverage locally.

> Run the full `pnpm test` / `pnpm test:coverage` locally only when you specifically want to (e.g. debugging a cross-cutting change, or no network/CI available). It is no longer a required pre-commit step.

### Automated Setup (Recommended)

The git hook is enabled automatically — `pnpm install` runs `scripts/setup-git-hooks.mjs` via the `prepare`
lifecycle script, which sets `core.hooksPath` to `scripts/` so the fast checks run on every commit with no
manual step. If you ever need to (re)do it by hand:

```powershell
git config core.hooksPath scripts
```

The hook runs in `-SkipTests` mode by default under this policy — it validates test file layout, type-check,
and markdown formatting, but leaves the full suite to CI.

### Manual Validation

```powershell
.\scripts\pre-commit-validate.ps1 -SkipTests  # Fast local gate (type-check, markdown) — default
.\scripts\pre-commit-validate.ps1             # Full validation incl. tests — optional, when you want it
```

### What Gets Checked

| Check | Where | Notes |
| --- | --- | --- |
| **Test file layout** (`pnpm run check:test-layout`) | Local + CI | Fails if any `*.test.ts` lives outside `tests/{unit,worker,live}/` — see [Tests](#tests). Instant; no `pnpm install` needed. |
| **TypeScript type checking** (`pnpm run type-check`) | Local + CI | Fast; always run locally |
| **Lint** (`pnpm run lint`) | Local + CI | Fast; always run locally |
| **Markdown** (`pnpm fix:md`) | Local + CI | Auto-fixes where possible |
| **Changelog fragment** | CI | **Required if you modify `src/`, `docs/`, `wrangler.jsonc`, or `CLAUDE.md`**. Add a `.md` file under `.changelog/fragments/`. Fragments are assembled at release time — no merge conflicts. |
| **Touched test file(s)** | Local | `pnpm test -- tests/worker/<file>.test.ts` for the area you changed |
| **Full test suite** (Node 20 + 22 matrix) | **CI** | Slow locally; CI runs both versions in parallel |
| **Coverage** (100% patch, istanbul) | **CI** | `coverage` CI job is the enforced gate — fails if patch coverage drops below 100%. Codecov upload is advisory only. |
| **Documentation** | CI | PRs must either modify `docs/` files OR include a `## Documentation` section in PR body. Dependencies-only and internal refactors can use `skip-quality-checks` label. |

### Pre-Commit Checklist (Before Pushing)

**Run these locally — fast:**

```powershell
pnpm run check:test-layout                       # Guard test files stay under tests/
pnpm run type-check                              # Catch type errors early
pnpm run lint                                    # Lint
pnpm fix:md                                      # Fix markdown formatting
# If src/, docs/, wrangler.jsonc, or CLAUDE.md changed — add a changelog fragment:
# New-Item .changelog\fragments\my-feature.md    # PowerShell
# touch .changelog/fragments/my-feature.md       # bash
pnpm test -- tests/worker/<touched-file>.test.ts  # Only the tests you touched
.\scripts\pre-commit-validate.ps1 -SkipTests     # Fast local gate
```

Then push and let CI run the full matrix + coverage (~2 min). Treat green CI as the bar.

### Common Failures

- **Type errors** — Run `pnpm run type-check` to identify and fix. In tests, use type assertions with `as` for dynamic values: `const result = (await response.json()) as { ok: boolean; ... }`
- **Coverage below 100% on new code (CI)** — **If you're an agent, don't reproduce this locally first.** Download the `coverage-report` artifact from the failed run and read `patch-coverage-report.json` — it already lists the exact uncovered file:line pairs. See [CI Artifacts for Agents](#ci-artifacts-for-agents) below.
- **Changelog fragment missing** — Create a `.md` file under `.changelog/fragments/` describing your changes (e.g. `.changelog/fragments/my-feature.md`)
- **Documentation update suggested** — Either (1) modify files under `docs/`, or (2) add a `## Documentation` section to your PR body describing the change, or (3) apply the `skip-quality-checks` label if documentation truly isn't needed (e.g., internal refactors, fixes to unreleased code, dependencies-only updates)
- **Markdown formatting** — Run `pnpm fix:md` to auto-correct (e.g., table spacing)
- **Tests failing in CI** — **If you're an agent, don't rerun the suite first.** Download the relevant `test-results-*` artifact and read the structured failure — see [CI Artifacts for Agents](#ci-artifacts-for-agents) below. Rerun locally only once you're iterating on an actual fix.

## CI Artifacts for Agents

**If you are an AI agent working on this repo: read this before running `pnpm test`, `pnpm run lint`, `pnpm run type-check`, or `pnpm test:coverage` to diagnose a failing PR.** Every one of those already ran in CI, and the results already exist as small, structured, downloadable artifacts — re-running them to find out what already failed wastes the exact time this system exists to save. Full guide with file formats and exact field names: **[`docs/agent-ci-artifacts-guide.md`](./docs/agent-ci-artifacts-guide.md)**.

The short version:

| Failing check | Artifact | File | Answers |
|---|---|---|---|
| `Coverage` | `coverage-report` | `patch-coverage-report.json` | Exact uncovered file:line pairs |
| `Lint` | `lint-report-{sha}` | `eslint-report.json` | Exact rule/file/line for every violation |
| `Type Check` | `typecheck-report-{sha}` | `tsc-diagnostics.txt` | Compiler errors, plain text |
| `Unit Tests` | `test-results-unit-{sha}` | `test-results-unit.json` | Structured pass/fail + failure messages |
| `Tests (shard N/4)` | `test-results-shard-{N}-{sha}` | `test-results-shard-{N}.json` | Same, per shard |

Find and download via the GitHub MCP tools already available in-session — no `gh` CLI, no new auth: `actions_list(method: "list_workflow_run_artifacts", resource_id: <run_id>)` to find the artifact (its response includes `workflow_run.head_sha` — check this against the PR's current head before trusting it, no download needed), then `actions_get(method: "download_workflow_run_artifact", resource_id: <artifact_id>)` for the download URL.

**Rerunning locally is fine when you're actively iterating on a fix** (write code, run the one file you touched, repeat) — it's only wasteful when you're using it to find out why an *already-completed* CI run failed, which the artifacts above already answer.

## Workflows & Protocols

**To resolve a GitHub Issue autonomously:**

```powershell
.\resolve-issue.ps1 -IssueNumber 42
```

This fetches the Issue and generates a copy-paste prompt for Claude Code. See [PROTOCOL_INVOCATION.md](./PROTOCOL_INVOCATION.md) for details.

**Full Issue Resolution Protocol:** See [ISSUE_RESOLUTION_PROTOCOL.md](./ISSUE_RESOLUTION_PROTOCOL.md) for the complete workflow (branching, testing, documentation, PR creation).

### Delegation triage — when an issue is a cheaper-agent candidate

**Whenever you pick up a GitHub Issue in this repo — for any reason, not just when explicitly asked — classify it before writing code.** Some issues are worth executing directly; others are pure spec-following work that a cheaper/faster agent (DeepSeek v4 Pro, DeepSeek v4 Flash, GLM-5.2, Kimi K2.5, Kimi K2.7-Code, MiMo-v2.5, MiMo-v2.5-Pro, MiniMax-M3, Qwen3.7-Max, Qwen3.7-Plus, or similar) can execute just as well once the judgment calls are already made. Getting this classification wrong in the "delegate" direction is expensive — the failure mode isn't slightly-worse code, it's a wrong architectural call (e.g. picking D1 where KV belongs, or guess-backfilling narrative data) that then needs a second pass to catch.

**Route to a cheaper agent when the issue itself is the spec** — every open question is already answered in the issue body, the task is "follow this pattern N times" (e.g. #66's file-by-file integration test list, each with a named pattern to copy), and it doesn't touch:

- The KV vs. D1 storage-selection decision (`docs/storage-selection-kv-vs-d1.md`)
- Migration safety / schema design (self-referential FKs, `ALTER TABLE` quirks under D1/miniflare)
- Data backfill or repair of production narrative content (guessing here breaks a session, not just a test)
- API surface placement (`MCP` vs. `/admin/*` — see the convention below)
- Any question the issue itself flags as open/undecided (e.g. #210's game-balance questions)

**Keep it with yourself (or escalate to a human decision via `AskUserQuestion`) when the remaining work is judgment, not typing** — anything on the list above, or any issue where you'd have to *decide* something not already decided by the issue text, prior art in the codebase, or this file. When in doubt, the cost asymmetry favors keeping it: a cheap agent executing a wrong call is more expensive to unwind than the tokens saved by delegating.

If you do delegate, the handoff prompt needs to carry the same context a fresh reader would need — file paths, the exact pattern to copy, and which of the constraints above are already resolved for this task — not just the issue text pasted verbatim.

## Architecture

**Modular Hono worker**: `src/index.ts` is a *slim entry point* — it wires middleware, the JSON-RPC `/mcp` handler, and the `/admin`, `/internal`, `/api/entities`, and `/changes` sub-routers, then exports the [Hono](https://hono.dev/) app as the Workers default export. The actual logic lives in modules under `src/tools/` (lore-system dispatchers), `src/rpg/handlers/` (RPG-system dispatchers), `src/lib/` (KV, RPC, history, indexes, and other shared helpers), and `src/admin/`, `src/api/`, `src/do/`. **For the full request flow and design patterns, read `ARCHITECTURE.md` — it is the authoritative, current description; this section is only a pointer.** (Historical note: the worker began life as a genuinely single-file `src/index.ts` and was later split; older docs and comments that say "all logic lives in `src/index.ts`" predate that split.)

**Two storage layers** (in priority order):

1. `LORE_DB` — Cloudflare KV binding, source of truth in production
2. `loreDB` — module-level `Record<string, string>` fallback used only when KV is unavailable (local dev without bindings). Persists across requests within a worker instance.

**KV value format**: entries are stored as `JSON.stringify({ text: string, meta: { version, updatedAt, createdAt } })`. The `parseKvEntry()` helper handles both this format and legacy plain-string values.

### Storage selection convention — KV vs. D1 is a data-kind decision, not an "old vs. new" one

**Read `docs/storage-selection-kv-vs-d1.md` before proposing a new table, column, or KV write path, or before migrating an existing KV content type to D1.** The repo is mid-migration toward a hybrid KV/D1 model (#154, #216, #217, #228, #231, #232), and it is tempting to treat every new storage decision as "D1 because that's the direction we're going." That default is wrong more often than it's right here, and getting it wrong breaks the thing that makes this MCP usable: an AI narrator improvising freeform content through tool calls, not a form-filling human.

The short version:

- **D1 owns mechanical/queryable state** — FK-checked relationships, numeric aggregation, transactional consistency, a stable well-known field set (character stats, timeline events, snapshots).
- **KV owns freeform/emergent content** — anything the AI narrator needs to invent mid-session without a schema migration (narrative fields, ad-hoc tags like `co-habitating:kat-sloane` from #226, prose). `patch_lore`'s exact-substring model depends on content staying text-shaped.
- **KV is not legacy and will not be fully removed.** A D1 migration for one entity type (e.g., characters) does not imply the same treatment for others (locations, setups, threads) unless the same field-level justification applies.
- If an issue is actually about **performance/batching/transport** of existing lore content (see #138 — batch admin endpoints for the editor sync path), that does not imply the storage target should move to D1. Batch KV writes, following the existing `batch_set_lore` pattern.
- When genuinely unsure which layer a new field belongs in, bias toward KV/freeform — the cost of guessing wrong toward "too structured" is a broken narrative session; the cost of guessing wrong toward "too freeform" is a missed query optimization, which is fixable later without narrative damage.

**Routes**:

- `POST /mcp` — JSON-RPC 2.0 endpoint. Handles MCP protocol methods (`initialize`, `ping`, `tools/list`, `tools/call`) plus legacy bare methods (`list_topics`, `get_lore`).
- `POST /admin/set-lore` / `POST /admin/delete-lore` — HTTP endpoints protected by `ADMIN_SECRET` env var (set via `wrangler secret put ADMIN_SECRET` in production; injected via `vitest.config.ts` miniflare bindings in tests).

### API surface convention — prefer MCP for reads, REST for privileged writes

This is a **read/write split + match-the-consumer** rule, not a blanket "MCP everywhere." When adding a new capability, decide by what the operation *is*:

- **Reads & queries → `POST /mcp` (JSON-RPC).** Add them as `tools/call` tools (discoverable via `tools/list`, so the agent can use them) **and**, when a programmatic client needs clean bulk JSON, register a **bare-method alias** that returns the structured payload directly in `result` — exactly how `get_lore` / `list_topics` work. Prefer this over adding ad-hoc REST `GET` routes: it keeps one discoverable read surface and reuses the editor's existing `rpc()` transport (`holmgard-lore-editor/src/lib/sync.ts`).
- **Privileged writes & bulk admin ops → `POST /admin/*` (REST), gated by `ADMIN_SECRET`.** This is where `set-lore`, `delete-lore`, the batch variants, migrations, and the map **push** endpoints live. Do **not** move these onto the public MCP surface — the secret gate must stay server-side.

Rationale: a single agent-usable read surface; secrets never exposed via MCP; bulk reads return structured JSON (not LLM content-blocks) by using the bare-method form. Worked example: **map readback** (`get_map_hexes`/`get_map_landmarks`/`get_map_meta` on `/mcp`; pushes stay on `/admin/map/*`) — see `docs/d1-readback-api-design.md`.

**10 top-level tools via `tools/call`** (see `ARCHITECTURE.md`'s "Action-dispatcher tools" section): 5 lore-system `*_manage` tools (`lore_manage`, `entity_manage`, `world_manage`, `scene_manage`, `continuity_manage`) plus 5 RPG-system tools (`rpg`, `agent_manage`, `character_manage`, `search_tools`, `load_tool_schema`). Each is an action-dispatcher, not a single operation — `lore_manage` alone routes 19 actions (`ping`, `auth_check`, `get`, `get_batch`, `get_section`, `list`, `list_maps`, `get_map`, `search`, `validate`, `set`, `delete`, `patch`, `batch_set`, `batch_mutate`, `restore`, `history`, `increment`, `append_section` — see `src/tools/lore-manage.ts`'s `ACTION_MAP` and the `ping`/`auth_check` special-casing in `src/index.ts`). The pre-consolidation flat names (`list_topics`, `get_lore`, `set_lore`, `search_lore`, etc.) referenced elsewhere in this file are the current bare-method JSON-RPC aliases for some of these actions, not separate `tools/call` tool names. `list_consumption_timelines` and `list_active_threads` (below) are actions of `entity_manage`, not `lore_manage`.

### RPG Handlers and Actions (Cluster 3 — #337, #340, #341)

**`travel-manage.ts`** — Party and character movement in dungeon/world contexts.

- `travel` — room-graph-based movement (existing, room_nodes model)
- `loot` — Search a room for items
- `rest` — Short/long rest, restore HP
- `move_hex` — **New (#337):** Hex-based party movement on world maps, updates `parties.current_hex_q/r`, optionally resolves encounters

**`spawn-manage.ts`** — Character and encounter creation.

- `spawn_character` — Generate a new NPC with random UUID
- `spawn_encounter` — Create a tactical combat setup
- `spawn_location` — Add a room node (dungeon location)
- `add_to_encounter` — Place character token on tactical grid
- `list_spawned` — Browse spawned NPCs/enemies
- `place_character` — **New (#340):** Position existing character on hex map, updates `characters.current_hex_q/r`, requires character to already exist (unlike `spawn_character`)

**`waypoint-manage.ts`** — Named locations for world-based party travel (#328, #341).

- `register` — Add a waypoint to a world (requires `q`/`r` hex coords **and** `lat`/`lon` real-world coords)
- `list`, `get`, `update`, `delete` — CRUD for waypoints
- `seed_defaults` — Load Gotland waypoints for a world
- `calibrate` — Set world geo-origin and km-per-hex scale
- `hex_to_latlon` — Convert hex coords to real-world lat/lon (only works if world is geo-calibrated)
- Status: #341 is largely resolved (q/r already required); `lat`/`lon` remain required per migration 0021 schema

## Documenting Discoveries (Capture Institutional Knowledge)

**Whenever you uncover something about how this system works that isn't obvious from a quick read of the code, write it down.** Don't let it get lost in the chat context.

### What to document

- **Non-obvious tool behavior** — How it actually works vs. what the name suggests
- **Hidden constraints** — Schema quirks, field format expectations, assumptions the system makes
- **Failure modes** — Things that look like they should work but don't, and why
- **Performance gotchas** — Expensive operations, token-heavy formats, missing batch operations
- **Edge cases** — Conditions that break under specific scenarios discovered during testing

### Where to put it

| What | Where |
| --- | --- |
| Tool behavior / quirks | `docs/holmgard-user-guide.md` — add a "Known Behavior" note under the relevant tool section |
| Broken things | `docs/issues/HIGH-*.md` — one file per issue with symptom, impact, reproduction, suggested fix |
| Performance notes | `docs/issues/performance-optimizations-for-slow-AI.md` — or inline in the user guide |
| Architecture gotchas | Inline code comments OR in `CLAUDE.md` under the relevant section |
| Workflow protocols | `CLAUDE.md` (this file) OR `docs/*.md` if complex enough for its own doc |

### The rule

**If you had to read the source code to understand how something works, or if you discovered something by experiment that wasn't documented, file it in docs/ within the same session.** Don't defer it — context windows expire.

## Key logic worth knowing

**`patch_lore`** uses exact substring matching and rejects ambiguous (>1 match) or missing targets with descriptive messages — response is always `result`, never `error`.

**`increment_topic_field`** parses `**fieldname:** 10` markdown syntax, increments the number, and writes back. Non-numeric fields error.

**`list_consumption_timelines`** scans only `character:*` keys for `**Consumption-Timeline:**` (primary) or `**Projected-Consumption-Timeline:**` (fallback). `status_filter` param (`all`/`imminent`/`days-to-weeks`/`weeks-to-months`/`consumed`) filters by substring.

**`batch_set_lore`** writes entries in parallel; not transactional (partial success possible). Per-key results in `results` array. Pushes history for overwrites.

**`batch_mutate`** applies `increment` or `patch` mutations sequentially (order matters). Failures recorded per-mutation; remaining mutations proceed.

**`countOccurrences`** helper (in `patch_lore` and `batch_mutate`) counts exact substring occurrences.

### Validate Before Read

Always validate before reading — use `lore_manage({ action: "validate", query_string: "..." })` to resolve ambiguous keys. The `validate` action returns `did_you_mean` with a `confidence` score (0.0–1.0) when the exact key doesn't exist. When a key is not found, `get_lore` also automatically scans for similar keys and returns `did_you_mean` plus up to 5 `alternatives` in the error payload — this eliminates the need for a separate `validate` call in most cases.

Confidence scoring (`scoreMatch` in `src/tools/system.ts`): exact match → 1.0 | prefix match → 0.9 | substring match → 0.5–0.85 (scaled) | initials/acronym → 0.7

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

Indexes are maintained automatically when lore entries are written. Four types of indexes track location, thread membership, key prefix, and a master list of all keys:

- `_idx:location:<location-key>` — array of entity keys at this location
- `_idx:thread:<thread-id>` — array of entity keys in this thread
- `_idx:prefix:<prefix>` — array of keys starting with this prefix (e.g., `character`, `setup`)
- `_idx:prefix:all` — master index of ALL lore keys; eliminates O(n) `kvList()` scans in `list_topics`, `get_lore` auto-suggest, and `validate_topic_exists` (#359). Read via `getAllKeys()` which falls back to `kvList()` when the index doesn't exist.

These are built and updated by `updateIndexes(c, key, newText, oldText)` in:

1. `set_lore` — when a lore entry is created or modified
2. `batch_set_lore` — for each entry in the batch
3. `batch_mutate` — after increment or patch mutations
4. `delete_lore` — when an entry is removed

Indexes are **read-through**, not write-through: `getIndexedKeys(c, indexKey)` returns the index if it exists, or falls back to kvList + filtering (for test compatibility where indexes may not be pre-built). For prefix indexes (`_idx:prefix:`), the fallback is fully functional; for location/thread indexes, tools add their own fallback scans if needed.

### Tools Using Indexes (optimized, not full-scan)

- `list_topics` (`lore_manage` action `list`) — reads `_idx:prefix:<prefix>` when a `prefix` arg is given (any prefix — indexes are built generically for every key's `key.split(':')[0]`, not just `character`)
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

**Every test file must live under `tests/{unit,worker,live}/`.** This is enforced by `pnpm run check:test-layout` (`scripts/check-test-layout.mjs`), which runs as its own `Test Layout` CI job and in the local pre-commit gate. A `*.test.ts` file placed anywhere else (colocated in `src/`, or a new stray `tests/` subdirectory) won't just fail this check — it will silently never run at all, since all three Vitest configs now have explicit `include` globs scoped to their own subdirectory (see #488/#489). The check fails fast and lists the offending paths.

**Gotcha — `pnpm run <script> -- <flags>` silently swallows the flags.** pnpm always inserts a literal `--` before args forwarded this way, regardless of whether the underlying script already has one. Vitest sees its *own* `--` and treats everything after it as a positional test-file filter, not CLI flags — so `pnpm test -- --shard=1/4` or `pnpm run test:unit -- --reporter=json` silently does nothing (no error, flag just never takes effect). This was discovered because `.github/workflows/ci.yml`'s sharded `test` job was invoking `pnpm test -- --shard=${{ matrix.shard }}/4` — every "shard" was actually running the full suite (~5 min each, matching full-suite time, not a 1/4 slice). Fixed by calling vitest directly: `pnpm exec vitest run --shard=1/4 ...` (verified locally: a real 1/4 slice runs in ~2 min against ~34 files, vs. the full suite's ~7 min). When adding CLI flags to any `pnpm run <script>` invocation in a workflow, always use `pnpm exec <bin> <args>` instead of `pnpm run <script> -- <args>`.

`reset()` from `cloudflare:test` is called `afterEach` to wipe all KV between tests. Seed KV directly with `env.LORE_DB.put(key, JSON.stringify({ text, meta }))` rather than going through `set_lore` — this avoids writing to the module-level `loreDB` fallback and keeps test isolation clean.

**REQUIRED: Any change to MCP tools or worker logic must update BOTH test suites in the same turn:**

1. **Vitest workers** (`tests/worker/**/*.test.ts`) — unit/integration tests running in the Workers runtime via miniflare
2. **Vitest live** (`tests/live/*.test.ts`) — end-to-end smoke tests against the deployed production worker

Do not wait to be asked. Both suites must be updated whenever a tool is added, removed, or its behavior changes.

### Type Safety in Tests

When tests call APIs that return `unknown` types (e.g., `response.json()`), always add explicit type assertions with `as`. This prevents type-check errors in CI:

```typescript
const result = (await response.json()) as {
  ok: boolean
  total: number
  migrated: number
  // ... other expected properties
}
expect(result.ok).toBe(true)
```

Never access properties on `unknown` without a type assertion — TypeScript will catch this in `pnpm run type-check` and fail the build.

## Git workflow

**Commit messages** should follow conventional commits (`feat:`, `fix:`, `test:`, `refactor:`) and mention the specific tools or routes affected. Example: `feat: add resolve_interaction tool with utility scoring`.

**Before pushing**, run the fast local gate (`pnpm run type-check`, `pnpm run lint`, and the test file(s) you touched) — see [Pre-Commit Validation](#pre-commit-validation). The full suite + coverage runs in CI (~2 min); treat green CI as the bar rather than grinding the whole suite locally.

### Branch naming

Every branch must use one of these prefixes, matching the conventional commit type for the primary change:

| Prefix | When to use |
|---|---|
| `feat/` | New feature or capability |
| `fix/` | Bug fix |
| `refactor/` | Code restructuring with no behavior change |
| `test/` | Adding or improving tests only |
| `docs/` | Documentation only |
| `chore/` | Maintenance — deps, config, CI, tooling |
| `perf/` | Performance improvement |

Example: `feat/batch-admin-endpoints`, `fix/ws-reconnect-rate-limit`, `chore/upgrade-vitest`.

**Never push directly to `main`.** All changes must go through a PR so CI runs first.

### Required workflow — every change

0. **Pull latest `main` from remote** before starting any work. This prevents working from stale code that causes accidental reverts:

   ```bash
   git fetch origin main && git merge origin/main --ff-only
   ```

   If the fast-forward merge fails (you have local changes on a branch), stash them first or rebase: `git rebase origin/main`. If you're on `main` itself, discard stale local changes with `git reset --hard origin/main`.

   > **⚠️ Critical:** Never assume your local workspace is up-to-date. The repository may have received commits from other sessions. Pushing stale files overwrites newer code with old versions — this breaks builds and tests in CI. Always pull first.

1. **Create a GitHub Issue** describing the problem or feature before writing any code. Use `gh issue create` or the GitHub UI. This gives the PR something to close and provides a paper trail.
2. **Create a branch** using the appropriate prefix: `git checkout -b feat/my-feature`
3. **Commit** locally with a conventional commit message
4. **Run the fast local gate** before pushing (type-check, lint, touched test file)
5. **Push** to the branch: `git push -u origin feat/my-feature`
6. **Create a PR** linking to the Issue (see [Pull Requests](#pull-requests-and-issue-linking) below) — this triggers CI

This workflow ensures CI always runs (full Node 20 + 22 matrix, 100% patch coverage) before code reaches `main`. PRs must pass all required checks, including the **coverage CI job (Istanbul)** which enforces **100% patch coverage on all new code** — this is not waived or advisable.

**"Single blue line"** — A linear git history with no branching or merge commits. When viewing the git graph in VS Code or on GitHub, all commits flow in a straight line (`*` symbols stacked vertically, no `|` branches). This is achieved by rebasing feature branches onto the target branch before merging, keeping history clean and readable. If you see branching in the graph, rebase to linearize it: `git rebase main && git push origin branch-name --force`.

### Pull Requests and Issue Linking

**Every PR should have clear linking to related Issues.** Use GitHub's auto-closing syntax to close issues when the PR merges:

**PR title format:** Keep it concise; the commit message (or summary of all commits) is the source of truth.

**PR body template:**

```markdown
## Summary
- One-liner describing what changed and why

## Related Issues
- Closes #123 (auto-closes when PR merges)
- Relates to #124 (reference without closing)
- Addresses the feedback from #125

## Test Plan
- [ ] Tested locally with `pnpm test`
- [ ] Validated on [specific scenario]
```

**Closing issues:** Use **"Closes #123"** (or "Closes #123, #124") in the PR body to auto-close issues when the PR merges. One issue per PR is ideal; multiple issues only if they're tightly coupled. Use **"Relates to #123"** or **"See #123"** to reference issues without closing.

**Important:** GitHub only processes closing keywords from the **PR body**, not the title. A keyword in the title (e.g. `feat: add X (closes #123)`) will not auto-close the issue.

**Cross-repo issues:** GitHub cannot auto-close an issue in a different repository. For changes that span both `holmgard-lore-mcp` and `holmgard-lore-editor`, close the issue manually after both PRs merge, or duplicate the issue in both repos.

**Creating the PR:** Use `gh pr create --title "..." --body "..."` or the GitHub web UI. Always run pre-commit validation before pushing to ensure the PR starts clean.

## Deployment notes

**KV Namespace Isolation (Critical)**: `wrangler.jsonc` has separate production and preview KV namespaces:

- Production `id`: `67b47914eb094043ab777f4f34da8bfc` (LORE_DB) — used by `wrangler deploy`
- Preview `preview_id`: `d99c543e9ccf46dca6900cc28d93362a` (LORE_DB_PREVIEW) — used by `wrangler dev`

This separation is critical: **never allow these IDs to be identical**, or `wrangler dev` will read from and write to production data, corrupting production lore.

`ADMIN_SECRET` must be set as a Cloudflare secret — it is intentionally absent from `wrangler.jsonc`.

**D1 migrations auto-apply to production on merge.** `.github/workflows/d1-migrate.yml` runs `wrangler d1 migrations apply holmgard-rpg --remote` on every push to `main` that touches `schema/migrations/**`. This is separate from Cloudflare Workers Builds (which deploys the *code* automatically on every push but has never run D1 migrations) — before this workflow existed, migrations required a manual `wrangler d1 migrations apply --remote` that nobody was reliably running, and migrations 0007/0008 sat unapplied in production for days, silently breaking every feature built on those columns (`character_snapshots`, `host_body_id`/`active`). **Do not remove this workflow or make merging to `main` depend on someone remembering to run migrations by hand again** — that's the failure mode it exists to close. Requires `CLOUDFLARE_API_TOKEN` (D1:Edit scope) and `CLOUDFLARE_ACCOUNT_ID` repo secrets.

**D1 migration tracking vs. file content**: `wrangler d1 migrations apply` decides what to run by checking the `d1_migrations` table for filenames already recorded there — it does not re-execute a file's SQL just because the file changes. If a migration ever partially fails against the *production* `holmgard-rpg` database (D1 wraps each file in a transaction, so a mid-file error rolls back the whole file) and gets hand-repaired, the fix belongs in the live database plus the `d1_migrations` tracking rows, not in a rewrite of the migration file — migration files are the historical record and should stay as originally written. See the note on `kv_origin` in `schema/migrations/0003_character_kv_fields.sql` for a worked example.

## Coverage and Codecov

**REQUIRED: 100% patch coverage on ALL new code.** Every line added to `src/`, `src-tauri/`, or tests must be covered by tests before deployment. This is **non-negotiable**. The CI `coverage` job (Istanbul) enforces this gate — PRs that fail coverage cannot merge.

### Coverage Targets by File Type

| Category | Requirement | Notes |
|---|---|---|
| **New utility functions** | 100% lines | All code paths, error cases, early returns |
| **New handler actions** | 100% lines | Happy path + error cases (missing fields, invalid inputs, DB failures) |
| **New MCP tools** | 100% lines + both Node versions | Must pass on Node 20 AND Node 22 |
| **Error handling** | 100% of try/catch paths | Both success and exception flows tested |
| **Conditional branches** | 100% coverage | All if/else/switch branches exercised |

### How to Maintain High Coverage

1. **Write tests alongside code** — don't add code first then tests later. Tests guide design and catch edge cases early.
2. **Test error paths explicitly** — every `try/catch`, every `if (!thing) return`, every `.bind(value)` that could fail
3. **Before pushing, run coverage locally:**

   ```bash
   pnpm test:coverage
   # Verify all lines added in this session are marked as covered:
   # Lines marked with X (red) = NOT covered — add tests
   # Lines marked with . (green) = covered — good to go
   ```

4. **Use Codecov diff view** — when CI runs, codecov shows exactly which lines in your diff lack coverage. Review those lines and add the missing test cases.

### Common Coverage Gaps (and How to Fix)

#### Gap: Error paths not tested

```typescript
// ❌ Untested error case
const row = await db.prepare('...').bind(id).first()
if (!row) return null  // This line has 0 coverage if tests never pass an invalid id
```

**Fix:** Add a test that passes a non-existent ID and verifies the null return.

#### Gap: Optional parameters

```typescript
// ❌ Untested when 'slug' is omitted
export async function syncToKv(env, charId, slug?: string) {
  const kvSlug = slug || charId.toLowerCase() // Second branch uncovered
}
```

**Fix:** Test both with and without the optional parameter.

#### Gap: Fallback/catch blocks

```typescript
// ❌ Exception path never triggered in tests
try {
  await db.query(...)
} catch {
  return 0  // Untested
}
```

**Fix:** Mock the db to throw an error and verify the catch returns 0.

### Coverage is Checked at

1. **Local pre-push** (optional but recommended):

   ```bash
   pnpm test:coverage && grep -E "^(src/|tests/).* (\d+\.\d+%|0%)" coverage/lcov.info
   ```

   Red flags: any file below 90% should be reviewed.

2. **CI (enforced gate)**: The `coverage` job runs on every PR, fails if any new line is uncovered. This blocks merge.

3. **Codecov (advisory)**: Shows uncovered lines in the diff view but doesn't block merging. Always review it — many coverage gaps are caught here.

### Coverage is generated by

`pnpm test:coverage` (`@vitest/coverage-istanbul`, configured via `provider: 'istanbul'` in `vitest.config.ts`) and uploaded to Codecov by the `coverage` job in `.github/workflows/ci.yml`. The lcov report lands at `./coverage/lcov.info`. Coverage runs in CI, not as a required local step (see [Pre-Commit Validation](#pre-commit-validation)).

**The enforced gate is the `coverage` CI job (Istanbul)**, not Codecov. Codecov is advisory — its `codecov/patch` check is uploaded for visibility but `fail_ci_if_error: false` means Codecov auth/rate-limit failures never block CI, and `auto-merge.yml` explicitly excludes any `codecov/*`-named check from its own failure gate (it also posts asynchronously, often after auto-merge has already evaluated — see #480).

**How the gate actually enforces 100% patch coverage (not just whole-repo %):** `vitest.config.ts`'s `coverage` block intentionally has no `thresholds` — vitest thresholds are whole-file/whole-repo, not diff-aware, so they can't express "100% of *changed* lines" without either breaking on pre-existing debt or missing a badly-covered new file. Instead, `pnpm run check:patch-coverage` (`scripts/check-patch-coverage.mjs`) runs after `pnpm test:coverage` in the `coverage` job: it parses `coverage/coverage-final.json` (needs the `json` istanbul reporter, already enabled), diffs the PR against its base branch, and fails the job if any added/changed line has zero hits. This is the actual mechanism behind the "100% patch coverage" requirement below — run it locally with `PATCH_COVERAGE_BASE_REF=origin/main pnpm run check:patch-coverage` after `pnpm test:coverage` to reproduce a CI failure.

**Sister repo sync**: `holmgard-lore-editor` uses the same `codecov/codecov-action@v5`. When upgrading the action version, update both repos' CI files at the same time. Coverage targets intentionally differ: this repo enforces **100% patch** (backend Worker — untested code reaches production directly); the editor uses **80% lines** (frontend UI code, enforced by Istanbul gap analysis).
