### Docs — KV vs. D1 storage selection principle
- Adds `docs/storage-selection-kv-vs-d1.md`: decision rule for when new/migrated storage belongs in KV (freeform, AI-emergent content) vs. D1 (mechanical/queryable state), with #138 worked through as an example of a batching issue that stays KV-first.
- Adds a "Storage selection convention" callout to `CLAUDE.md` (Architecture section) pointing future implementers at the doc before adding tables/columns/KV paths or migrating a KV content type to D1.
