### CI — auto-merge.yml now deletes the source branch after merging
- `tryMerge`'s squash-merge step never deleted the PR's head branch, so merged feature branches accumulated indefinitely regardless of any repo-level "auto-delete head branches" setting (the workflow's API-driven merge doesn't get that behavior for free — it has to call it explicitly).
- After a successful merge, the workflow now calls `git.deleteRef` for the head branch (best-effort — a delete failure, e.g. an already-deleted or protected branch, is logged but never fails the job, since the merge itself already succeeded).
