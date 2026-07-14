## fix: make D1 the mandatory primary path for append_event

`append_event` now requires `world_id` (was optional) and always writes to D1. The D1 write is no longer gated on the parameter being present — it always runs and returns an error if the D1 database is unavailable. Entity ID is derived from `entity_key` when omitted, and FK validation ensures both world and entity exist. Auto-witness no longer requires a `d1EventId` to fire (triggers whenever a location is set). `get_event_log` metadata now includes `d1_count` and `kv_count`.
