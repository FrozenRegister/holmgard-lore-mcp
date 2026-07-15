### scene_manage: commit_choice bridges to D1 timeline_events (#350)

- `commit_choice` now mirrors a committed choice into D1 `timeline_events` (`verb: "chose"`) whenever the KV entity resolves to a real D1 character with a `world_id`, reusing the existing `resolveEntityToCharacterId` lookup (`meta.d1_id`, falling back to name match).
- Best-effort only: if the entity has no matching D1 character, or the character has no `world_id`, the bridge write is skipped silently and `commit_choice` behaves exactly as before. The KV choice commit is never blocked or errored by a D1/timeline issue.
- Response now includes `timeline_event_id` (the new event's id, or `null` when skipped).
- This is a narrow bridge, not the full KV/D1 scene unification — see the open architecture question on #350.
