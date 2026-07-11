### CI — auto-merge.yml now explicitly closes linked issues after merging
- GitHub's own closing-keyword automation ("Closes #N") does not fire for merges performed via the API using a workflow's default `GITHUB_TOKEN` — only for merges attributed to a real user. Every PR `auto-merge.yml` has ever merged silently left its linked issue open.
- The workflow now scans the merged PR's body for `closes/fixes/resolves #N` and closes each match itself (best-effort — a bad issue number is logged, never fails the job). Requires `issues: write`, added alongside the fix.
- See `docs/issues/HIGH-auto-merge-github-token-does-not-close-linked-issues.md` for the full discovery writeup. Issues #274/#275/#276/#277/#280 were closed manually as part of finding this.
