# Handoff: AI Automation Setup for holmgard-lore-editor

This document provides a complete handoff packet for implementing the same GitHub Actions automation pipeline in the `holmgard-lore-editor` repository that was just completed in `holmgard-lore-mcp`.

## What Was Done in holmgard-lore-mcp

The following automation infrastructure was implemented:

### Workflows Created (8 total)
1. **setup-labels.yml** — Bootstrap all 24 GitHub labels via manual dispatch
2. **issue-tagger.yml** — Auto-label opened/edited issues by surface area & depth
3. **parallelize-issues.yml** — Group open issues into parallelizable batches
4. **agent-assignment.yml** — Auto-assign AI agents when batch label applied
5. **agent-trigger.yml** — Post standardized work-order comments
6. **pr-quality.yml** — Enforce CHANGELOG.md and docs changes in PRs
7. **auto-merge.yml** — Auto-merge PRs after CI checks pass
8. **validate-workflows.yml** — Validate workflow YAML syntax on changes

### CI Enhancements
- **ci.yml** updated with `type-check` and `lint` jobs
- Migrated from `npm` to `pnpm` (with exact version `11.5.1`)
- All tests passing (384 tests)

### Documentation Created
- `docs/ai-automation-pipeline.md` — 550+ line comprehensive guide
- `docs/testing-and-linting-guide.md` — Testing process & known lint issues
- Updated CLAUDE.md with links and command reference

## Implementation Plan for holmgard-lore-editor

### Phase 1: Copy and Adapt Workflows

**Source**: `holmgard-lore-mcp/.github/workflows/`
**Destination**: `holmgard-lore-editor/.github/workflows/`

Copy these files exactly:
- `setup-labels.yml`
- `issue-tagger.yml`
- `parallelize-issues.yml`
- `agent-assignment.yml`
- `validate-workflows.yml`
- `auto-merge.yml`

**Adapt these files** (editor-specific changes):
- `agent-trigger.yml` — Update work-order comment for editor context
- `pr-quality.yml` — Check for docs changes (editor has different docs structure)

**Enhance** (editor-specific additions):
- `ci.yml` — Add test/lint/type-check jobs similar to mcp, but use `pnpm` commands specific to editor build

### Phase 2: Configuration Updates

#### package.json
- [x] Already has `packageManager: pnpm@9` — **Update to `pnpm@11.5.1`** (exact version)
- [x] Already has `pnpm run vendor:build`, `pnpm run vendor:fetch` in scripts — Already migrated

#### .github/workflows/ci.yml
Create/enhance with:
```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm test

  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm check
```

### Phase 3: Documentation

Create these files in `holmgard-lore-editor/docs/`:

1. **ai-automation-pipeline.md**
   - Copy from mcp repo
   - Update example issue titles to be editor-context (e.g., "Add hexmap layer", "Fix map sync")
   - Update tool references (mcp has 15 tools, editor architecture is different)
   - Keep label system identical for consistency

2. **testing-and-linting-guide.md**
   - Copy from mcp repo
   - Adjust test command to `pnpm test` (editor uses vitest + playwright)
   - Note any pre-existing lint issues in editor
   - Update CI job names to match editor's ci.yml

3. Update **CLAUDE.md**
   - Add link to testing guide
   - Add lint/test commands
   - Reference ai-automation-pipeline.md

### Phase 4: Label Bootstrap

Manual one-time setup (after PR merged):
1. Go to GitHub repo settings → Labels
2. Click "Run workflow" on `setup-labels.yml`
3. Verify all 24 labels created (same as mcp):
   - 7 surface areas (API, state, utils, build, docs, tests, admin)
   - 5 depths (0-4)
   - 3 batches (1-3)
   - 2 agents (claude, cline)
   - 7 quality/process labels

### Phase 5: Testing & Validation

#### Local Testing
```bash
# Navigate to editor repo
cd holmgard-lore-editor

# Run tests
pnpm test

# Run type check
pnpm check

# Run lint
# (Note: editor may have different linting setup)
```

#### CI Validation
1. Create PR with workflow changes
2. Verify all CI jobs run:
   - test job passes
   - check job passes (svelte-check)
   - validate-workflows passes
3. Check that workflow labels appear as expected
4. Merge PR

#### Workflow Testing
1. Open test issue in editor repo
2. Verify issue-tagger auto-labels it with surface area + depth
3. Run parallelize-issues manually to batch it
4. Verify agent-assignment applies agent label
5. Verify agent-trigger posts work-order comment

## Key Differences from mcp → editor

### Architecture
- **mcp**: Single Workers file (src/index.ts)
- **editor**: SvelteKit frontend + Tauri desktop app

### CI Jobs
- **mcp**: test (Node 20/22), type-check, lint
- **editor**: test, check (svelte-check), potentially e2e tests

### Documentation Structure
- **mcp**: src/ and docs/
- **editor**: src/, src-tauri/, docs/

### Issue Context
- **mcp**: MCP tools, KV operations, admin routes
- **editor**: UI components, world-building features, hexmap visualization

## Critical Implementation Notes

1. **Exact pnpm version**: Use `11.5.1` to avoid CI warnings
2. **Label colors**: Keep identical across repos for consistency (same palette)
3. **Work-order template**: Update agent-trigger.yml to reference editor-specific tasks/features
4. **PR quality checks**: Editor docs structure may differ — adjust doc check paths if needed
5. **Workflow names**: Keep names identical where possible for consistency

## Files to Copy/Reference

**From mcp repo**:
- `.github/workflows/setup-labels.yml` → Copy as-is
- `.github/workflows/issue-tagger.yml` → Copy as-is
- `.github/workflows/parallelize-issues.yml` → Copy as-is
- `.github/workflows/agent-assignment.yml` → Copy as-is
- `.github/workflows/validate-workflows.yml` → Copy as-is
- `.github/workflows/auto-merge.yml` → Copy as-is
- `.github/workflows/agent-trigger.yml` → Adapt for editor context
- `.github/workflows/pr-quality.yml` → Adapt for editor doc paths
- `docs/ai-automation-pipeline.md` → Adapt with editor examples
- `docs/testing-and-linting-guide.md` → Adapt for editor test setup

**From mcp CLAUDE.md**:
- Commands section → Update for editor scripts
- Link to testing/linting guides

## Success Criteria

When complete, the editor repo should have:

✅ All 8 workflows in `.github/workflows/`
✅ Exact pnpm version (`11.5.1`) in package.json
✅ Enhanced ci.yml with test/check/lint jobs
✅ All 24 labels bootstrapped
✅ Documentation in docs/ (ai-automation-pipeline.md, testing-and-linting-guide.md)
✅ CLAUDE.md updated with references
✅ One test PR created and successfully:
  - Auto-labeled by issue-tagger
  - Batched by parallelize-issues
  - Agent assigned by agent-assignment
  - Work order commented by agent-trigger
  - CI passes on workflow changes

## Implementation Steps (TL;DR)

1. Create branch: `issue/editor-automation-setup`
2. Copy workflows from mcp (adapt agent-trigger, pr-quality)
3. Update package.json: `pnpm@11.5.1`
4. Create/enhance ci.yml
5. Copy and adapt documentation
6. Update CLAUDE.md
7. Create PR, verify CI passes
8. Merge to main
9. Run setup-labels manually
10. Create test issue to verify automation works

## Questions?

Refer to:
- `holmgard-lore-mcp/docs/ai-automation-pipeline.md` — Full system explanation
- `holmgard-lore-mcp/docs/testing-and-linting-guide.md` — Testing & CI details
- `holmgard-lore-mcp/.github/workflows/` — Source workflow implementations

Good luck! 🚀
