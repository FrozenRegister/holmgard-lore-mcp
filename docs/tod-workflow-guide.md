# Tod Workflow Guide

This document captures institutional knowledge about the "Tod" automation agent that operates against this repository. Tod runs two distinct pipelines — nightly PR review (read-only) and day-time issue fixes (code changes) — plus a scratchpad pattern for multi-step data aggregation. The workflows below describe how Tod uses GitHub MCP tooling, sandboxed code execution, and branch-based staging to automate routine tasks without external service dependencies.

## Midnight Review (read-only pipeline)

Runs nightly at ~7:30 PM EDT in a dedicated chat room.

```
1. GitHub MCP: list_pull_requests → open PRs, oldest-first
2. GitHub MCP: pull_request_read (get, get_files, get_diff, get_comments, get_review_comments, get_reviews, get_status, get_check_runs) — 8 parallel calls
3. Review: synthesize findings in-thread
4. GitHub MCP: add_issue_comment → post review on PR
5. If no open PRs: report and done
```

**Tools used:** GitHub MCP only. Zero Composio. Zero sandbox. Zero gists.

**Why this works:** The GitHub MCP returns full responses directly — no truncation, no cross-boundary handoff. The gist bridge was an artifact of assuming Composio would be in the loop. It isn't needed here.

---

## Day-Time Fix Pipeline (code changes)

Runs in a separate chat room when issues are marked for Tod to resolve.

```
1. Sandbox: generate/edit code, run tests, verify
2. I read sandbox output (stdout, file contents)
3. GitHub MCP: create_branch('shapes/fix-{issue-number}')
4. GitHub MCP: push_files(to: 'shapes/fix-{issue-number}', files: [{path, content}])
5. GitHub MCP: create_pull_request(head: 'shapes/fix-{issue-number}', base: 'main')
6. GitHub MCP: delete_branch when merged/closed
```

**Tools used:** Sandbox (`SHAPES_RUN_CODE`) + GitHub MCP. No `gh` CLI needed.

**What went wrong before (lockfile adventure):** Tod tried to use `gh` CLI from inside the sandbox to push. That requires separate GitHub auth inside the sandbox, which breaks. The fix is to read sandbox output and pipe it to `push_files` in the MCP layer — the MCP is already authed as FrozenRegister.

**Key insight:** The MCP `push_files` takes file content as a string parameter. No need to push from inside the sandbox. Generate in sandbox → pass content to MCP → MCP writes to GitHub.

---

## Branch-as-Scratchpad (multi-step aggregation)

When intermediate data needs to be staged between steps:

```
1. Composio/sandbox stages data → GitHub MCP: push_files to shapes/scratch
2. GitHub MCP: get_file_contents(ref: shapes/scratch) reads it back
3. Process, review, act
4. GitHub MCP: delete branch shapes/scratch
```

**Why this over gists:** The GitHub MCP can natively read/write branches but not gists. Gists route through a different API (`gist.github.com`) that the MCP's Repos API doesn't recognize (confirmed 404). The branch IS the git repo that gists pretend to be — except the MCP has the tools.

---

## Tool Capability Matrix

| Capability | GitHub MCP | Composio | Sandbox (`gh` CLI) |
|---|---|---|---|
| List/open/read PRs | ✅ | ✅ | ✅ |
| Post comments/reviews | ✅ | ✅ | ✅ |
| Read/write repo files | ✅ | ✅ | ❌ (needs auth) |
| Create/delete branches | ✅ | ✅ | ❌ (needs auth) |
| Create fork & cross-repo PR | ✅ | ✅ | ❌ (needs auth) |
| Gist CRUD | ❌ | ✅ | ✅ |
| Run code/tests | ❌ | ❌ | ✅ |

**Rule: GitHub MCP first. Sandbox for execution. Composio only when the MCP can't reach something (gists).**
