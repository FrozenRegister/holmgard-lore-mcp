# Holmgard MCP — Backlog

## ~~Narrative Event Log (deferred)~~ — Done

The dedicated tool this item deferred building has since been implemented: `continuity_manage`'s
`append_event`/`get_event_log` actions (`handle_append_event`/`handle_get_event_log` in
`src/tools/meta.ts`) write and read per-entity `events:<entityKey>` KV logs — the same convention
this item proposed, just as a first-class tool rather than a `patch_lore`-append convention. Covered
by `tests/worker/thread-tracking.test.ts` and `tests/worker/narrative.test.ts`. `events:*` keys are
also already excluded from `kvList()` (see `src/lib/kv.ts` and CLAUDE.md's "Exclude Indexes from
kvList" section).
