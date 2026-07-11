# auto-merge.yml never closed linked issues — GITHUB_TOKEN merges don't trigger closing-keyword automation

## Symptom

Every PR merged by `auto-merge.yml` (attributed to `github-actions[bot]`) left its `Closes #N` issue open, even though the PR body had the correct closing keyword and the merge succeeded. PRs merged by a real user (via the web UI, or via a session's own authenticated merge call) closed their linked issues correctly.

## Discovered while

Auditing issues #274/#275/#276/#277/#280 after their PRs (#289/#292/#293/#294/#296, all merged by `auto-merge.yml`) had been merged for a while — all five were still open. Compared against PR #279 (merged by a human user, `merged_by: "FrozenRegister"`), whose linked issue #267 closed at the exact same timestamp as the merge. Every `auto-merge.yml`-merged PR checked showed `merged_by: "github-actions[bot]"` and a still-open linked issue.

## Root cause

GitHub's closing-keyword automation (the feature that closes an issue when a PR containing "Closes #N" merges) does not fire for merges performed via the API using a workflow's default `GITHUB_TOKEN`. This is a real, if under-documented, GitHub Actions limitation — the same category of restriction as `GITHUB_TOKEN`-created events not being able to trigger other workflows (both exist to prevent recursive automation loops), but it specifically affects the linked-issue-closing feature, not just workflow triggering.

## Impact

Every PR this repo's auto-merge workflow has ever merged has silently failed to close its linked issue, defeating the "Closes #N" convention this repo's `CLAUDE.md` documents as required practice. Issues accumulate as falsely-open despite their work having shipped and merged.

## Status

**Fixed** — `auto-merge.yml` now explicitly scans the merged PR's body for `closes/fixes/resolves #N` keywords and calls `issues.update({ state: 'closed', state_reason: 'completed' })` for each match, immediately after a successful merge. Best-effort per issue (a bad/already-closed issue number is logged, never fails the job). Requires `issues: write` permission, added alongside the fix.

Issues #274, #275, #276, #277, #280 were closed manually as part of discovering this.

## Suggested follow-up

None needed for the immediate fix. If this workflow is ever ported to another repo (as `auto-merge.yml`'s reliability fixes have been between `holmgard-lore-editor` and `holmgard-lore-mcp` this session), carry this fix along with it.
