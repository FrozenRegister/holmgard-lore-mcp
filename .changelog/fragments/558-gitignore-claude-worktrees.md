issue: 558
summary: Add .claude/worktrees/ to .gitignore
---

- **`.gitignore`** — excludes `.claude/worktrees/`, the scratch directory created when a background subagent runs with worktree isolation. Previously untracked and would repeatedly trip the local stop-hook's untracked-files check until manually removed.
