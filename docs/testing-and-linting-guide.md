# Testing and Linting Guide

This guide documents the testing and linting process for this project, including known issues and how to continue fixing them.

## Quick Start

```bash
pnpm test              # Run all vitest tests (should pass: 384 tests)
pnpm run type-check    # Run TypeScript type checking (should pass)
pnpm run lint          # Run ESLint (currently has pre-existing issues)
```

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
   - Files affected: All test files in `src/__tests__/`

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
pnpm run lint -- --fix
```
This fixes:
- `prefer-const`: Variables declared as `let` that are never reassigned
- Simple formatting issues

#### Step 2: Manual fixes for unused variables

For each file with `no-unused-vars` errors:

**Example**: `src/__tests__/admin.test.ts`
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
pnpm run lint -- src/__tests__/admin.test.ts 2>&1 | grep "no-unused-vars"
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

## CI/CD Pipeline

### Workflows Involved
1. **CI** (`.github/workflows/ci.yml`)
   - `test` job: Runs `pnpm test` on Node 20 & 22
   - `type-check` job: Runs `pnpm run type-check` on Node 22
   - `lint` job: Runs `pnpm run lint` on Node 22

2. **Validate Workflows** (`.github/workflows/validate-workflows.yml`)
   - Validates YAML syntax of workflow files
   - Checks for required workflow fields

3. **PR Quality** (`.github/workflows/pr-quality.yml`)
   - Requires CHANGELOG.md update
   - Requires documentation changes (or docs section in PR body)

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
4. `pnpm run lint -- --fix` — auto-fix what you can
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

- [AI Automation Pipeline](./ai-automation-pipeline.md) — GitHub Actions workflows for issue triage and agent assignment
- [CLAUDE.md](../CLAUDE.md) — Main development guidance
