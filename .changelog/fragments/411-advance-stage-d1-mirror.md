### entity_manage.advance_stage: mirror stage into D1 dissolution_stage (#411)

- `advance_stage` now mirrors its new KV `State-Stage` value into `characters.dissolution_stage` whenever the entity resolves to a D1 character whose `death_mode` is `"staged"` (#314). Response gains `d1_mirrored: boolean`.
- Closes the drift risk both narrator agents (Archisector, Calder Architect) flagged on #411: `combat_action.attack`'s staged-rejection guard reads D1, but stage progression is tracked via KV `advance_stage` — without this mirror the two could disagree about which stage a character is on.
- Scoped to `advance_stage` only, per Archisector's explicit requirement (the action she actually calls) — `batch_stage` (location-wide bulk advance) is out of scope for this fix.
- Elara Veldweaver's D1 character backfill (the other half of #411) is tracked separately — see issue comments.
