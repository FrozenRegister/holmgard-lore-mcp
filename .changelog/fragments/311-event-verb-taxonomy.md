### continuity_manage: event verb taxonomy for tiered event filtering (#311)

- New D1 table `event_verb_taxonomy` (migration 0033), seeded with 63 verbs across `high`/`medium`/`low` tiers and `combat`/`narrative`/`social`/`production` categories — combining the issue's original 20-verb seed with real production vocabulary gathered from both live narrator agents during the issue's Q&A.
- `get_event_log` gains an optional `tier` param (e.g. `"high"` or `"high,medium"`) that filters returned events (both D1 `timeline_events` and KV `events:*` sources) against the taxonomy. Requires D1 — errors rather than silently ignoring the filter when `RPG_DB` is unavailable.
- Three new `continuity_manage` actions: `taxonomy_list` (optionally filtered by `tier`/`category`), `taxonomy_set` (runtime upsert, no code deploy needed to classify a new verb), `taxonomy_delete`.
