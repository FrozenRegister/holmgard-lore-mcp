### Feature — Character co-habitation (Phase 2, #226)
- Adds `host_body_id`/`active` columns to the D1 `characters` table so multiple character rows can represent consciousnesses sharing one physical body, with exactly one active at a time.
- Adds `character_manage` actions `activate` (atomically activate one consciousness and deactivate its siblings via `db.batch()`) and `list_passengers` (list the dormant consciousnesses sharing a host body, plus which one is currently active).
- This is a mechanical layer alongside — not a replacement for — the existing Phase 1 KV `co-habitating:<tag>` freeform tag (#226), which is unchanged.
