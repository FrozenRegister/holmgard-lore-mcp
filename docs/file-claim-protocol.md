# File-Claim Protocol for Parallel Agent Work

GitHub has no native "check out this file" lock for source files. `.gitattributes`
`lockable` + Git LFS locks exist, but they're designed for binary assets edited by
humans in GUI tools (Unity scenes, Photoshop files) — they don't apply to text-based
source, and most agent tooling (including Claude Code sessions) won't check or honor
them anyway.

When multiple agents are resolving different GitHub Issues in this repo at the same
time, the real risk isn't a missing OS-level lock — it's two agents independently
editing the same file on different branches with no visibility into each other's
work, discovering the conflict only when one PR merges and the other's CI goes red
or its diff no longer applies cleanly. This protocol closes that gap using only
things GitHub already gives us: issue comments and draft PRs.

## The protocol

### 1. Claim files when you start, not when you finish

As soon as an agent begins Phase 2/3 of issue resolution (see
`ISSUE_RESOLUTION_PROTOCOL.md`) and knows which files it's about to touch, it posts a
comment on the GitHub Issue it's working listing them:

```markdown
**Claiming files** (working on #123):
- src/tools/lore-manage.ts
- src/lib/kv.ts
- tests/worker/lore-manage.test.ts
```

Post this *before* writing code, not as a summary afterward — the whole point is
making the claim visible to other agents while it's still useful to them.

### 2. Open a draft PR early

Don't wait until the change is complete to open a PR. Open it as a **draft** as soon
as there's a branch with at least one commit. An early draft PR does two things a
late one can't:

- Its **Files changed** tab becomes the authoritative, always-current list of what
  this agent is touching — more reliable than the issue comment, which can go stale
  as work evolves.
- Anyone (human or agent) doing the check in step 3 can find it via
  `list_pull_requests` (state: open) without needing the issue comment at all.

### 3. Before starting new work, check for existing claims

Before an agent starts writing code for a new issue, it should:

1. List open PRs (`list_pull_requests`, state `open`) and, for any whose title/branch
   suggests overlap, check their changed files (`pull_request_read` with the diff/files
   method, or `get_file_contents` on the branch).
2. Grep open issues for recent "Claiming files" comments
   (`search_issues` / `list_issues` with recent activity) that mention paths the new
   work is also expected to touch.
3. If there's overlap on a file the new work needs to modify (not just read), don't
   silently proceed. Either:
   - Sequence the work — note the dependency in the new issue and wait, or
   - Coordinate scope — split so each agent's changes land in non-overlapping
     regions of the file, or
   - Escalate — ask the human (`AskUserQuestion` or an issue comment) which order is
     preferred, per this repo's existing default of confirming before large
     reversible-but-costly rework.

A same-file overlap that's read-only for one side (e.g. one agent reads
`src/index.ts` to understand routing but doesn't edit it) is not a conflict and needs
no coordination.

### 4. Claims release automatically

There's no separate "release" step. A claim is implicitly released when its PR merges
or closes — at that point the file reflects the merged state and the next agent's
"check for existing claims" step (looking at *open* PRs and *recent* issue comments)
naturally stops surfacing it. If an issue is abandoned without a PR, close the issue
or comment that the claim is dropped so it doesn't mislead a future scan.

### 5. If a conflict is discovered mid-work anyway

This can still happen — an agent's claim comment predates another agent's start, or
two agents start within the same short window. If your branch's base has moved out
from under you because another claimed-file PR merged first, this is an ordinary git
merge conflict, not a protocol failure: follow the existing merge-conflict guidance in
`CLAUDE.md`'s PR-activity section (fetch, merge/rebase onto the updated base, resolve,
push) rather than treating it as something requiring a new mechanism.

## What this protocol deliberately doesn't do

- **It's not enforced by GitHub or CI.** There's no bot rejecting a PR for touching an
  unclaimed-but-overlapping file. It's a convention agents follow, the same way
  `ISSUE_RESOLUTION_PROTOCOL.md`'s phases are conventions, not gates.
- **It doesn't replace small, frequent PRs.** The best defense against conflicts is
  still keeping each PR's file footprint small and merging quickly — claims reduce
  wasted work when overlap is unavoidable, they don't excuse letting a branch sit
  open for days touching a wide swath of `src/`.
- **It's not a substitute for the existing D1 `world_locks` / `claims.ts` runtime
  locking** described in `CLAUDE.md`'s Simulation Layer section. That system
  serializes concurrent *simulation ticks* at request time; this protocol serializes
  concurrent *agents editing the repository's source*. Different problems, same
  "atomic claim, detect collision" shape.
