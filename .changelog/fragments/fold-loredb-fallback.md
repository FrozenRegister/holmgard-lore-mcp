## Refactor

Fold in-memory `loreDB` fallback writes into `kvPut` and `kvDelete` helpers to eliminate duplicated fallback logic across ~34 call sites, fixing a silent payload shape divergence between dev-without-KV and production (dev was storing bare text, KV was storing full JSON with metadata).
