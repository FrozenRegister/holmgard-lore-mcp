---
type: fix
issue: 225
---

## character.update now recomputes derived fields when stats change

When `update` is called with a `stats` object, the handler now automatically
recomputes `ac`, `perception_bonus`, and `stealth_bonus` from the new ability
scores — unless the caller explicitly passed those fields, in which case the
explicit values take priority.

Previously, updating stats left the three derived columns stale (containing
their old defaults or previous values), and the `parseChar()` read-time
fallback (`??`) never triggered because the columns held non-null stale
values rather than `NULL`. The only workaround was a manual
`recompute_derived` call after every stats update.