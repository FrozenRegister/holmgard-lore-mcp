feat(events): auto-witness knowledge injection on append_event (#370)

When append_event includes a location and world_id, after writing the D1 timeline_events row, queries characters WHERE current_room_id = ? for other occupants and inserts entity_knowledge rows (source: 'witnessed', confidence: 90) for each witness. Best-effort per occupant; returns auto_witnessed list in metadata.