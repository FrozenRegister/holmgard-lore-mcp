### Character State Snapshots: Phase A (Issue #228)

- **New `character_snapshots` table** — Temporal versioning for D1 characters with columns for stats, HP, AC, level, custom state, and narrative notes
- **`snapshot` action in character_manage** — Captures current character state at a point in time; accessible via `snap` and `save_state` aliases  
- **Migration 0007** — Creates indexed character_snapshots table with FKs to characters and timeline_events  
- **Test coverage** — 8 test cases for snapshot creation, multiple snapshots, state preservation, custom data, and action aliases  
- **Unblocks Phase B** (auto-trigger on timeline events) and **Phase C** (jump_to integration for time-travel state restoration)

Enables character versioning for historical playback and timeline jumps (#216, #217).
