# Holmgard MCP — Backlog

## Narrative Event Log (deferred)

**Use case:** Two parallel story threads share the same lore state. Thread A writes Zira's
capture/status as the story progresses; Thread B (the girlfriend searching) needs to
reconstruct *what happened to her*, not just the current state, when the threads collide.

**Design:**

- Convention: append-only log key per character, e.g. `events:character:zira`
- Format: one timestamped line per event — `[2026-05-23T14:30Z] captured — moved to nest`
- Writer: Thread A's AI appends via existing `patch_lore` (operation: `append`, no target = end-of-text)
- Reader: Thread B's AI calls `get_lore("events:character:zira")` when the girlfriend gets a lead
- No new tool required — the `patch_lore` append operation handles writes today

**Example session usage (Thread A):**

```
patch_lore({
  key: "events:character:zira",
  operation: "append",
  value: "\n[2026-05-23T18:00Z] Zira sedated and moved to inner chamber."
})
```

**Example session usage (Thread B):**

```
get_lore({ query: "events:character:zira" })
// → full timeline of what happened in Thread A
```

**When to build:** When a second story thread is actively running and the collision moment
needs narrative fidelity. The convention can be adopted immediately with no code changes;
optionally build a dedicated `append_event` tool later if the pattern is used frequently.
