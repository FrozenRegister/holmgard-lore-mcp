feat(character): kill with atomic batch, event log, corpse creation, and production pulse (#369)

kill action uses db.batch() for atomicity: HP->0, conditions->dead, clear location, INSERT corpse + timeline_events + optional event_inbox emission. Returns structured character/event/corpse/productionPulse envelope. Added location, triggerProductionPulse, killedBy fields to schema.