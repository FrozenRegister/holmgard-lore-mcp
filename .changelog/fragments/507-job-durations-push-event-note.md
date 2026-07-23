### Clarified `job-durations-{sha}` push-event behavior in the agent CI artifacts guide

- Per PR #507 review feedback, added a note that `job-durations-{sha}` (unlike `build-diff-{sha}`, which is PR-only) is also generated on push-to-main events, useful there for duration baseline tracking over time.
