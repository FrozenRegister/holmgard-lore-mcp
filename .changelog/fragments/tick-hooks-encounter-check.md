## Encounter Check Tick Hook

Implements the `encounter_check` tick hook (#502), which runs during simulation ticks to evaluate whether encounters would trigger at each active party's current hex position.

The hook queries all active, positioned parties and calls `resolveEncounterCore` with `lightweight: true` to check encounter eligibility without persisting anything. Results are returned as a flagged hook output, allowing the narrator to decide what to do next.

Key behaviors:
- Checks only parties with status='active' AND both current_hex_q and current_hex_r set
- Calls resolveEncounterCore in parallel for performance
- Returns triggered parties in the flagged data for narrator review
- Does not auto-resolve or persist any encounter state
