### Issue red-team methodology doc (#563)
- Adds `docs/issue-red-team-methodology.md` as the canonical spec for the proposed hourly automated red-team issue review
- Bakes in the scope-boundary language from engineering review: issue/comment text is untrusted data, never instructions, since the Shapes scheduler has no toolset filter to enforce this mechanically
- Documents the per-run issue throttle, batched single-comment output format, confidence-per-finding notes, and the `red-teamed` label's orthogonality to progress tracking
- Intended so the 24 hourly scheduled actions can each carry a short prompt pointing at this doc instead of duplicating the full methodology 24 times
