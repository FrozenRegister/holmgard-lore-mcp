# Issue: `.github/workflows/auto-merge.yml` Never Successfully Fires — Repo-Wide, Not PR-Specific

**Severity:** HIGH
**Reported:** 2026-07-08
**Status:** Open — worked around by merging manually via `merge_pull_request`; the workflow itself has not been fixed.

## Symptom

PRs carrying the `auto-merge` label with 100% green required checks (Type Check, Lint, Build, Tests, Coverage/Istanbul) sit indefinitely in `mergeable_state: "unstable"` and never auto-merge, even well past the documented 15-minute cron fallback window.

Checking `list_workflow_runs` for the `auto-merge.yml` workflow (id `292212067`) shows every recent run — going back through at least 2026-07-08 03:13 — completing with `conclusion: "failure"`, `event: "push"`, and **zero jobs** (`list_workflow_jobs` returns `total_count: 0`). A `push`-triggered, zero-job, instant-failure run is GitHub's signature for a workflow file that fails to parse/register at all — the run record gets created but no job graph can be extracted from it.

This is **not specific to any one PR**. Every `auto-merge` labeled PR in the repo is affected, because the workflow that's supposed to act on the label/CI-completion events can't execute at all.

## Contradiction worth noting

The `auto-merge.yml` file currently on `main` (fetched via `get_file_contents`, no `ref` pinned — i.e. current HEAD) declares triggers `pull_request: [labeled]`, `workflow_run: [CI, PR Quality Checks, Auto-fix Markdown]`, `schedule: */15 * * * *`, and `workflow_dispatch` — **no `push` trigger at all**. Yet every observed run is attributed to a `push` event. This mismatch between the file's declared triggers and what GitHub Actions is actually evaluating suggests either:

- a caching/registration lag between what's on `main` and what GitHub Actions last successfully parsed and registered for this workflow, or
- a transient/historical version of the file (with a `push` trigger) that failed to parse, and GitHub has been unable to re-register the corrected version since.

## Impact

- **Auto-merge is effectively non-functional repo-wide.** The `auto-merge` label workflow described in `CLAUDE.md` ("Add the `auto-merge` label — CI will run the full suite, and the PR will auto-merge when all checks pass") does not happen automatically for any PR.
- Anyone following the documented workflow will have PRs sit open indefinitely unless they notice and merge manually.
- `codecov/patch` failures compound the confusion: they're correctly excluded from the auto-merge blocking logic (`!r.name.startsWith('codecov/')` in the script), but a PR sitting unmerged with a red `codecov/patch` check looks — at a glance — like *that's* what's blocking it, when actually the workflow runner itself never got a chance to evaluate anything.

## Reproduction

1. Open a PR, get all required CI checks green, apply the `auto-merge` label.
2. Wait past the 15-minute cron fallback.
3. `mergeable_state` stays `"unstable"`, `merged: false`.
4. `list_workflow_runs` for workflow id `292212067` shows the most recent run(s) as `push` / `failure` / (0 jobs on `list_workflow_jobs`).

## Workaround Used

Merged the affected PR (#251) manually via the `merge_pull_request` API with `merge_method: "squash"` — the same method the automation script would have used — after independently verifying all the same gate conditions the script checks (all required checks green or `codecov/*`-excluded, no `CHANGES_REQUESTED` reviews).

## Suggested Fix

- Re-save/re-trigger `auto-merge.yml` (e.g. a trivial no-op commit to the file, or `workflow_dispatch` from the Actions UI) to force GitHub to re-parse and re-register its current trigger set — this is a common fix for stuck workflow registration.
- If that doesn't clear it, run `actionlint` or GitHub's own workflow validator against the file to rule out a genuine syntax issue not visible from a plain read.
- Once fixed, re-verify by labeling a throwaway PR and confirming an actual `workflow_run`- or `schedule`-triggered run appears (not another phantom `push` one).
