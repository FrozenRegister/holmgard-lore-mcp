# Remote Branch Cleanup — July 30, 2026

## Branches Recommended for Deletion

This document records the analysis and recommendations for cleaning up merged and superseded remote branches as of 2026-07-30.

### Deletion Candidates (Safe to Delete)

#### 1. `feat/dissolution-phase0-config`
- **Tip SHA:** `4886e204f8b2765f843944ee6b725cc4a5ba992e`
- **Status:** Fully merged (ancestor of `main`)
- **Commits:** 22 total, 0 unique to this branch
- **Safety:** ✅ Safe — all commits reachable from main
- **Rationale:** This branch's work has been squash-merged into main via multiple PRs (#443, #438, #435, #434, #428, #427, etc.). No unique work remains.

#### 2. `fix/dissolution-variable-stages`
- **Tip SHA:** `4886e204f8b2765f843944ee6b725cc4a5ba992e`
- **Status:** Fully merged (ancestor of `main`, identical commit to above)
- **Commits:** 22 total, 0 unique to this branch
- **Safety:** ✅ Safe — all commits reachable from main
- **Rationale:** Related branch that tracks the same merged work. Can be safely deleted.

#### 3. `fix/issue-templates-reviews`
- **Tip SHA:** `5c3ce66db7749e2f83f15a08e1abf1b81a0f56da`
- **Status:** Fully merged (ancestor of `main`)
- **Commits:** 25 total, 0 unique to this branch
- **Safety:** ✅ Safe — all commits reachable from main
- **Rationale:** All work from this branch landed in main via merged PRs (#469, #458, #459, etc.). No unique commits.

#### 4. `claude/pr-568-restore-lines-sv9eld`
- **Tip SHA:** `a3254afde0126a39262c48e477e34cd5571677de`
- **Status:** Closed PR (#571, not merged; superseded by #568)
- **Unique commits:** 1 — `a3254af` "fix: extend patch pipeline to src/ and tests/ without truncating CLAUDE.md"
- **Safety:** ✅ Safe — the meaningful content landed in main via PR #568 (merged as `cb4f96b`)
- **Verification:**
  - ✓ `apply-patches.yml` has `src/*|tests/*` allowlist (line 46)
  - ✓ Type-check gate documented in code (lines 64–72)
  - ✓ Changelog fragment exists: `.changelog/fragments/567-patch-pipeline-src-tests-typecheck.md`
  - ✓ `CLAUDE.md` intact (576 lines, includes type-check documentation)
- **Rationale:** PR #571 was closed in favor of merging #568 directly. The one unique commit's work is now in main. The branch is a historical record of an attempt that was superseded.

### Branches to Keep (Active/Open PRs)

- **`dependabot/npm_and_yarn/zod-4.4.3`** (PR #602) — Open Dependabot automation
- **`feat/546-shared-dispatch-tool-call`** (PR #613) — Open feature work

## Deletion Commands

To delete these branches from GitHub, run one of:

### Via Git (on a branch with push access)
```bash
git push origin --delete feat/dissolution-phase0-config
git push origin --delete fix/dissolution-variable-stages
git push origin --delete fix/issue-templates-reviews
git push origin --delete claude/pr-568-restore-lines-sv9eld
```

### Via GitHub CLI
```bash
gh repo delete-branch feat/dissolution-phase0-config
gh repo delete-branch fix/dissolution-variable-stages
gh repo delete-branch fix/issue-templates-reviews
gh repo delete-branch claude/pr-568-restore-lines-sv9eld
```

### Via GitHub Web UI
1. Navigate to the repository's **Branches** page
2. Click the trash icon next to each branch name in the list above

## Verification Checklist

Before deletion:
- [ ] All 4 branches are confirmed as merged or superseded
- [ ] No open PRs target these branches
- [ ] The unique commit on `claude/pr-568-restore-lines-sv9eld` is verified in main
- [ ] Branch SHAs recorded for recovery (see below)

## Recovery (If Needed)

All branch tips can be recovered via their SHAs if deletion is undone:

```bash
git branch feat/dissolution-phase0-config 4886e204f8b2765f843944ee6b725cc4a5ba992e
git branch fix/dissolution-variable-stages 4886e204f8b2765f843944ee6b725cc4a5ba992e
git branch fix/issue-templates-reviews 5c3ce66db7749e2f83f15a08e1abf1b81a0f56da
git branch claude/pr-568-restore-lines-sv9eld a3254afde0126a39262c48e477e34cd5571677de
git push origin <branch> refs/heads/<branch>
```

## Summary

**Before cleanup:** 7 non-main branches (2 open PRs, 1 Dependabot, 4 merged/superseded)  
**After cleanup:** 3 non-main branches (2 open PRs, 1 Dependabot)  
**Impact:** Removes 57% of non-main clutter while preserving all active work

All deleted branches are reachable from main via their merged commits. This cleanup improves branch list clarity and makes it easier to identify current active work.
