# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm test                        # run Workers runtime tests (vitest --project workers)
pnpm test:coverage               # run Workers tests and generate coverage (lcov → ./coverage/lcov.info)
pnpm test:live                   # run live production smoke tests (vitest --project live)
pnpm test -- --reporter=verbose  # Workers test output with per-test names
pnpm run type-check              # TypeScript type checking
pnpm run lint                    # ESLint validation
pnpm run build                   # esbuild bundle → dist/index.js
pnpm run deploy                  # wrangler deploy to Cloudflare
wrangler dev                     # local dev server (uses wrangler.jsonc main)
```

To run a single test file or describe block:

```bash
pnpm test -- --reporter=verbose src/__tests__/worker.test.ts
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

Enable the git hook so the fast checks run automatically on every commit:

```powershell
git config core.hooksPath scripts
```

The hook runs in `-SkipTests` mode by default under this policy — it validates type-check and markdown formatting, but leaves the full suite to CI.

### Manual Validation

```powershell
.\scripts\pre-commit-validate.ps1 -SkipTests  # Fast local gate (type-check, markdown) — default
.\scripts\pre-commit-validate.ps1             # Full validation incl. tests — optional, when you want it
```

### What Gets Checked

| Check | Where | Notes |
| --- | --- | --- |
| **TypeScript type checking** (`pnpm run type-check`) | Local + CI | Fast; always run locally |
| **Lint** (`pnpm run lint`) | Local + CI | Fast; always run locally |
| **Markdown** (`pnpm fix:md`) | Local + CI | Auto-fixes where possible |
| **Changelog fragment** | CI | **Required if you modify `src/`, `docs/`, `wrangler.jsonc`, or `CLAUDE.md`**. Add a `.md` file under `.changelog/fragments/`. Fragments are assembled at release time — no merge conflicts. |
| **Touched test file(s)** | Local | `pnpm test -- src/__tests__/<file>.test.ts` for the area you changed |
| **Full test suite** (Node 20 + 22 matrix) | **CI** | Slow locally; CI runs both versions in parallel |
| **Coverage** (100% patch, istanbul) | **CI** | `coverage` CI job is the enforced gate — fails if patch coverage drops below 100%. Codecov upload is advisory only. |

### Pre-Commit Checklist (Before Pushing)

**Run these locally — fast:**

```powershell
pnpm run type-check                              # Catch type errors early
pnpm run lint                                    # Lint
pnpm fix:md                                      # Fix markdown formatting
# If src/, docs/, wrangler.jsonc, or CLAUDE.md changed — add a changelog fragment:
# New-Item .changelog\fragments\my-feature.md    # PowerShell
# touch .changelog/fragments/my-feature.md       # bash
pnpm test -- src/__tests__/<touched-file>.test.ts  # Only the tests you touched
.\scripts\pre-commit-validate.ps1 -SkipTests     # Fast local gate
```

Then push and let CI run the full matrix + coverage (~2 min). Treat green CI as the bar.

### Common Failures

- **Type errors** — Run `pnpm run type-check` to identify and fix. In tests, use type assertions with `as` for dynamic values: `const result = (await response.json()) as { ok: boolean; ... }`
- **Coverage below 100% on new code (CI)** — Open the failing `coverage` job or the Codecov report to see uncovered lines, add tests, push again. To reproduce locally if needed: `pnpm test:coverage`, then inspect `coverage/lcov.info`.
- **Changelog fragment missing** — Create a `.md` file under `.changelog/fragments/` describing your changes (e.g. `.changelog/fragments/my-feature.md`)
- **Markdown formatting** — Run `pnpm fix:md` to auto-correct (e.g., table spacing)
- **Tests failing in CI** — Reproduce locally by running just that file (`pnpm test -- <file>`), fix, push again

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

### API surface convention — prefer MCP for reads, REST for privileged writes

This is a **read/write split + match-the-consumer** rule, not a blanket "MCP everywhere." When adding a new capability, decide by what the operation *is*:

- **Reads & queries → `POST /mcp` (JSON-RPC).** Add them as `tools/call` tools (discoverable via `tools/list`, so the agent can use them) **and**, when a programmatic client needs clean bulk JSON, register a **bare-method alias** that returns the structured payload directly in `result` — exactly how `get_lore` / `list_topics` work. Prefer this over adding ad-hoc REST `GET` routes: it keeps one discoverable read surface and reuses the editor's existing `rpc()` transport (`holmgard-lore-editor/src/lib/sync.ts`).
- **Privileged writes & bulk admin ops → `POST /admin/*` (REST), gated by `ADMIN_SECRET`.** This is where `set-lore`, `delete-lore`, the batch variants, migrations, and the map **push** endpoints live. Do **not** move these onto the public MCP surface — the secret gate must stay server-side.

Rationale: a single agent-usable read surface; secrets never exposed via MCP; bulk reads return structured JSON (not LLM content-blocks) by using the bare-method form. Worked example: **map readback** (`get_map_hexes`/`get_map_landmarks`/`get_map_meta` on `/mcp`; pushes stay on `/admin/map/*`) — see `docs/d1-readback-api-design.md`.

**15 MCP tools** via `tools/call`: `ping_tool`, `list_topics`, `get_lore`, `get_lore_batch`, `set_lore`, `delete_lore`, `search_lore`, `validate_topic_exists`, `list_consumption_timelines`, `list_active_threads`, `increment_topic_field`, `patch_lore`, `restore_lore`, `batch_set_lore`, `batch_mutate`.

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

`reset()` from `cloudflare:test` is called `afterEach` to wipe all KV between tests. Seed KV directly with `env.LORE_DB.put(key, JSON.stringify({ text, meta }))` rather than going through `set_lore` — this avoids writing to the module-level `loreDB` fallback and keeps test isolation clean.

**REQUIRED: Any change to MCP tools or worker logic must update BOTH test suites in the same turn:**

1. **Vitest workers** (`src/__tests__/worker.test.ts`) — unit/integration tests running in the Workers runtime via miniflare
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
7. **Add the `auto-merge` label** — CI will run the full suite, and the PR will auto-merge when all checks pass

This workflow ensures CI always runs (full Node 20 + 22 matrix, 100% patch coverage) before code reaches `main`.

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

**Gap: Error paths not tested**
```typescript
// ❌ Untested error case
const row = await db.prepare('...').bind(id).first()
if (!row) return null  // This line has 0 coverage if tests never pass an invalid id
```
**Fix:** Add a test that passes a non-existent ID and verifies the null return.

**Gap: Optional parameters**
```typescript
// ❌ Untested when 'slug' is omitted
export async function syncToKv(env, charId, slug?: string) {
  const kvSlug = slug || charId.toLowerCase() // Second branch uncovered
}
```
**Fix:** Test both with and without the optional parameter.

**Gap: Fallback/catch blocks**
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

**The enforced gate is the `coverage` CI job (Istanbul)**, not Codecov. Codecov is advisory — its `codecov/patch` check is uploaded for visibility but `fail_ci_if_error: false` means Codecov auth/rate-limit failures never block CI. The auto-merge workflow also ignores `codecov/*` check conclusions. If the `coverage` CI job passes (100% patch on new lines), the PR can merge regardless of Codecov status.

**Sister repo sync**: `holmgard-lore-editor` uses the same `codecov/codecov-action@v5`. When upgrading the action version, update both repos' CI files at the same time. Coverage targets intentionally differ: this repo enforces **100% patch** (backend Worker — untested code reaches production directly); the editor uses **80% lines** (frontend UI code, enforced by Istanbul gap analysis).
