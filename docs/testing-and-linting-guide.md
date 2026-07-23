# Testing and Linting Guide

This guide documents the testing and linting process for this project, including known issues and how to continue fixing them.

## Quick Start

```bash
pnpm test              # Run all vitest tests (should pass: 384 tests)
pnpm run type-check    # Run TypeScript type checking (should pass)
pnpm run lint          # Run ESLint (currently has pre-existing issues)
```

## Local Development Setup

### Pre-commit hook

Enable the fast local gate (type-check, lint, markdown, changelog fragment) to run automatically on every commit:

```powershell
git config core.hooksPath scripts
```

This wires up `scripts/pre-commit`, which delegates to `scripts/pre-commit-validate.ps1` (Windows) / `.sh`
(bash). Bypass in an emergency with `git commit --no-verify`. The full test suite + coverage are intentionally
left to CI (see [Pre-Commit Validation](../CLAUDE.md#pre-commit-validation) in CLAUDE.md); pass `--with-tests`
(`-WithTests` on Windows) to run the full suite locally when you specifically want it.

### Local D1 database

Bootstrap the local `holmgard-rpg` D1 database (used by `wrangler dev`; the vitest suite applies migrations
automatically via `vitest.global-setup.ts` and doesn't need this):

```bash
pnpm run db:setup   # idempotent — creates the DB from schema/rpg-schema.sql and applies pending migrations
pnpm run db:reset    # wipes local D1 state and re-runs db:setup
pnpm run db:status   # shows which migrations are applied/pending locally
```

`db:setup` reads the migration filenames from `schema/migrations/*.sql` at runtime. A couple of migrations
(currently `0012_encounter_resolution.sql` and `0021_gotland_waypoints_and_party_march.sql`) add columns that
are already present in the consolidated `schema/rpg-schema.sql` base schema — `db:setup` detects the resulting
duplicate-column error, marks just that migration applied, and continues, so a fresh local setup doesn't abort
partway through.

## Two Test Tiers

Almost all tests live under `tests/worker/**/*.test.ts` and drive the worker end-to-end via `SELF.fetch`/`callTool`
against a real (miniflare) KV/D1 instance — that's the source of truth for tool behavior, and it's what `pnpm test`
runs (`vitest.config.ts`, which explicitly includes `tests/worker/**/*.test.ts`).

A small second tier, `tests/unit/**/*.test.ts`, covers genuinely pure functions (no I/O, no bindings — e.g.
`scoreMatch`, `countOccurrences`, `parseKvEntry`, `normalizeLocationKey`) directly, with no Workers runtime to boot:

```bash
pnpm test:unit          # run the fast unit tier (sub-second)
pnpm test:unit:watch    # watch mode for the fast unit tier
```

Selection between tiers is directory-based, not filename-based: `vitest.config.ts` includes only
`tests/worker/**`, and `vitest.unit.config.ts` includes only `tests/unit/**` — a test file's location determines
which runtime it gets, so there's no ambiguity from a magic filename suffix. (Files that are also genuinely
suffix-tagged `*.unit.test.ts`, like `tests/unit/lib/score-match.unit.test.ts`, keep that naming as an extra
signal, but it's the directory that the config actually keys off.) They have their own `unit-tests` CI job, so
they give fast feedback without duplicating the integration suite. When adding a new pure helper function,
prefer a file under `tests/unit/` over routing the test through a tool call.

### Layout is enforced, not just convention

`pnpm run check:test-layout` (`scripts/check-test-layout.mjs`) scans all tracked `*.test.ts` files and fails if any
live outside `tests/{unit,worker,live}/`. It runs as its own fast `Test Layout` CI job (no `pnpm install` needed —
just `git ls-files`) and as the first step of the local pre-commit gate. This exists because a misplaced test file
isn't just unlinted or uncounted — it's silently never executed at all, since none of the three Vitest configs'
`include` globs would ever reach it (see #490).

## Test Suite Status

### ✅ Tests (384 passing)

- **Status**: All tests pass locally and in CI
- **Tool**: Vitest with Workers runtime via `@cloudflare/vitest-pool-workers`
- **Coverage**: Unit and integration tests for all MCP tools, KV operations, and admin routes
- **Command**: `pnpm test`

Tests run inside the actual Cloudflare Workers runtime with in-memory miniflare KV storage. `ADMIN_SECRET` is injected via `vitest.config.ts`.

### ✅ Type Checking (passes)

- **Status**: All TypeScript types check out
- **Tool**: TypeScript compiler via `tsc --noEmit`
- **Command**: `pnpm run type-check`

### ⚠️ Linting (284 problems: 220 errors, 64 warnings)

- **Status**: Pre-existing issues not caused by recent changes
- **Tool**: ESLint with `@eslint/js` and `typescript-eslint`
- **Command**: `pnpm run lint`
- **Not CI-blocking**: Main branch passes CI despite these errors

## Known Lint Issues

The following 284 lint problems are pre-existing across test files:

### Categories of Errors (220 total)

1. **`@typescript-eslint/no-unused-vars`** (~150+ errors)
   - Unused imports in test files (e.g., `rpc`, `callTool`, `seedKV`, `parseEncounterTable`)
   - Unused destructured variables from test helpers (e.g., `env`, `SELF`, `beforeEach`)
   - Files affected: All test files in `tests/worker/`

2. **`no-empty`** (5+ errors)
   - Empty block statements (e.g., `catch () {}`, `try {} catch {}`)
   - Files: `src/tools/scene.ts`, `src/tools/resolver.ts`

3. **`deprecation/deprecation`** (2 errors)
   - Deprecation rule definition not found (likely ESLint config issue)

### Categories of Warnings (64 total)

1. **`@typescript-eslint/no-explicit-any`** (~64 warnings)
   - Use of `any` type without specification
   - Not blocking but indicates areas for stronger typing
   - Set to `warn` in `eslint.config.mjs` to avoid blocking builds

## Fixing Lint Errors

### Strategy: Prioritize by Impact

**High Priority** (blocking or widespread):

- `no-unused-vars` in test files — Remove unused imports/variables
- `no-empty` in core files — Add comment or proper error handling

**Medium Priority** (code quality):

- Deprecation rule errors — Fix ESLint config or update deprecated usage

**Low Priority** (typing):

- `no-explicit-any` warnings — Migrate to proper types (non-blocking)

### Process for Fixing

#### Step 1: Auto-fix what you can

```bash
pnpm run lint --fix
```

Note: don't write this as `pnpm run lint -- --fix` — pnpm inserts its own literal `--` before forwarded
args, so `-- --fix` becomes `eslint src -- --fix`, which eslint parses as a positional path argument, not
the `--fix` flag (same gotcha documented in [CLAUDE.md](../CLAUDE.md#tests) for vitest). Passing the flag
with no manual `--` (`pnpm run lint --fix`) forwards it correctly.
This fixes:

- `prefer-const`: Variables declared as `let` that are never reassigned
- Simple formatting issues

#### Step 2: Manual fixes for unused variables

For each file with `no-unused-vars` errors:

**Example**: `tests/worker/admin.test.ts`

```typescript
// Before
import { rpc, callTool, callToolWithApiKey, seedKV, parseEncounterTable } from './helpers'

// After (if none are used in the file)
// Remove the unused imports entirely

// Or if some are used:
import { callToolWithApiKey, parseEncounterTable } from './helpers'
```

**Find unused imports in a file**:

```bash
pnpm run lint tests/worker/admin.test.ts 2>&1 | grep "no-unused-vars"
```

#### Step 3: Fix empty block statements

**Example**: `src/tools/scene.ts:220`

```typescript
// Before
if (!condition) {
} else {
  doSomething()
}

// After
if (condition) {
  doSomething()
}

// Or with comment (if intentional)
if (!condition) {
  // No action needed
}
```

#### Step 4: Test and commit

After each batch of fixes:

```bash
pnpm test              # Verify tests still pass
pnpm run type-check    # Verify no new type errors
pnpm run lint          # Check remaining issues
git add src/
git commit -m "fix: clean up unused imports in test files"
```

## Linting Configuration

**File**: `eslint.config.mjs`

- Extends `@eslint/js` recommended config
- Uses `typescript-eslint` for TypeScript rules
- `@typescript-eslint/no-explicit-any` set to `warn` (not blocking)
- Ignores: `dist/`, `node_modules/`, `test-run-output.txt`
- `eslint-config-prettier` is applied last, disabling any ESLint stylistic rule that would conflict with
  Prettier's formatting output — code style is Prettier's job (`.prettierrc.json`), not ESLint's

## Code Formatting

**Prettier** formats `.ts`/`.mjs` files under `src/`, `tests/`, `scripts/`, and root-level config files
(`.prettierrc.json` for config, `.prettierignore` to exclude markdown — that's markdownlint-cli2's job — and
generated/vendor paths). Run `pnpm run format` to fix, `pnpm run format:check` to check without writing.
Not wired into `pnpm run lint` — it's a separate concern, matching how markdown formatting is separate from
markdown *content* checks.

## CI/CD Pipeline

### Workflows Involved

1. **CI** (`.github/workflows/ci.yml`)
   - `unit-tests` job: runs the `*.unit.test.ts` tier directly via `pnpm exec vitest` (Node 22)
   - `test` job: runs the full suite on Node 22, sharded 1/4–4/4 via `pnpm exec vitest run --shard=N/4` (not `pnpm test` — see the pnpm `--`-forwarding gotcha above)
   - `type-check` job: Runs `pnpm run type-check`
   - `lint` job: Runs `pnpm run lint`

2. **Validate Workflows** (`.github/workflows/validate-workflows.yml`)
   - Validates YAML syntax of workflow files
   - Checks for required workflow fields

3. **PR Quality** (`.github/workflows/pr-quality.yml`)
   - Requires CHANGELOG.md update
   - Requires documentation changes (or docs section in PR body)

4. **Auto-fix Markdown** (`.github/workflows/markdownlint-fix.yml`) and **Auto-fix Code Formatting**
   (`.github/workflows/prettier-fix.yml`)
   - Both trigger on any PR touching their file type (`**.md` / `.ts`+`.mjs` respectively), check out the
     PR's actual head branch, run the fixer (`pnpm fix:md` / `pnpm run format`), and — if anything changed —
     commit and push the fix directly back to the PR branch via `git-auto-commit-action`. Neither is a
     blocking check; they're self-correcting. This is the only mechanism in this repo where CI itself writes
     a commit back to your branch.

### CI Status on Main

- **Latest run**: PASSING ✅
- **Test failures**: None (384/384 tests pass)
- **Type-check failures**: None
- **Lint failures**: Exists but not CI-blocking (pre-existing)

## Development Workflow

### When Adding New Code

1. Write code + tests
2. `pnpm test` — verify tests pass
3. `pnpm run type-check` — verify types are correct
4. `pnpm run lint --fix` — auto-fix what you can
5. `pnpm run lint` — check remaining issues
6. Commit with conventional-commit message

### When Fixing Lint Issues

1. Identify problematic file: `pnpm run lint | grep "filename.ts"`
2. Understand the issue (see categories above)
3. Apply fix
4. Re-run: `pnpm run lint`
5. Verify tests still pass: `pnpm test`
6. Commit: `git commit -m "fix: [category] [brief description]"`

### Bulk Fixing Unused Imports

If tackling multiple files:

```bash
# Find all no-unused-vars errors
pnpm run lint 2>&1 | grep "no-unused-vars" > /tmp/unused.txt

# Review file by file
cat /tmp/unused.txt

# Fix each file
# Then verify:
pnpm test && pnpm run type-check && pnpm run lint
```

## Future Improvements

- [ ] Reduce `no-explicit-any` usage across the codebase
- [ ] Eliminate all unused test imports
- [ ] Fix empty block statements
- [ ] Fix deprecation warnings in ESLint config
- [ ] Consider stricter ESLint rules (currently permissive)

## Related Documentation

- [Agent CI Artifacts Guide](./agent-ci-artifacts-guide.md) — for agents diagnosing a failing PR: what structured artifacts CI already produced (coverage, lint, type-check, test results) and how to read them instead of rerunning the suite
- [AI Automation Pipeline](./ai-automation-pipeline.md) — GitHub Actions workflows for issue triage and agent assignment
- [CLAUDE.md](../CLAUDE.md) — Main development guidance
