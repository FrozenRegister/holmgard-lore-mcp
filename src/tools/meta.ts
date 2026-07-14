export async function handle_append_event({ c, id, args }: TypedToolContext<typeof appendEventSchema>): Promise<Response> {
  const entityKey = args.entity_key.trim().toLowerCase()
  const eventsKey = `events:${entityKey}`
  const now = args.at ?? new Date().toISOString()

  const newEvent: Record<string, string> = { at: now, verb: args.verb }
  if (args.object !== undefined) newEvent.object = args.object
  if (args.location !== undefined) newEvent.location = args.location
  if (args.thread !== undefined) newEvent.thread = args.thread
  if (args.detail !== undefined) newEvent.detail = args.detail

  // D1 primary path — world_id is now required by schema.
  // When RPG_DB is unavailable (test environments / local dev without D1),
  // fall back gracefully to KV-only instead of hard-erroring.
  let d1EventId: string | null = null
  if (c.env.RPG_DB) {
    const db = c.env.RPG_DB

    // Validate FK constraints before INSERT
    const worldExists = await db.prepare('SELECT id FROM worlds WHERE id = ?').bind(args.world_id).first() as { id: string } | null
    if (worldExists) {
      // Derive entity_id from entity_key when entity_id is omitted
      if (!args.entity_id) {
        const row = await db.prepare(
          'SELECT id FROM characters WHERE lore_key = ?'
        ).bind(entityKey).first() as { id: string } | null
        if (row) {
          args.entity_id = row.id
        }
      }

      if (args.entity_id) {
        const entityExists = await db.prepare('SELECT id FROM characters WHERE id = ?').bind(args.entity_id).first() as { id: string } | null
        if (!entityExists) {
          return c.json(makeError(id, -32602, `Character not found: ${args.entity_id}`, null), 200)
        }
      }

      const eventId = randomUUID()
      const createdAt = new Date().toISOString()
      try {
        await db.prepare(
          `INSERT INTO timeline_events (id, world_id, thread_id, event_at, verb, entity_id, object_entity, location_id, detail, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          eventId,
          args.world_id,
          args.thread ?? 'main',
          now,
          args.verb,
          args.entity_id ?? null,
          args.object ?? null,
          args.location ?? null,
          args.detail ?? null,
          createdAt,
        ).run()
        d1EventId = eventId
      } catch (err) {
        const msg = String(err)
        if (msg.includes('FOREIGN KEY')) {
          return c.json(makeError(id, -32603, `Foreign key constraint violation: ${msg}`, null), 200)
        }
        throw err
      }
    }
    // world not found — fall through to KV-only without error
  }
  // RPG_DB unavailable or world not found — proceed KV-only

  const kv = getKV(c)
  let events: typeof newEvent[] = []
  if (kv) {
    try { const r = await kv.get(eventsKey); if (r) events = JSON.parse(r) } catch {
      // silently ignore if events don't exist
    }
  }

  const nowMs = new Date(now).getTime()
  const duplicate = events.some(e => {
    const diff = Math.abs(new Date(e.at).getTime() - nowMs)
    return diff <= 1000 && e.verb === newEvent.verb && e.object === newEvent.object
  })

  if (!duplicate) {
    events.unshift(newEvent)
    if (events.length > 200) events = events.slice(0, 200)
    if (kv) await kv.put(eventsKey, JSON.stringify(events))
  }

  // Update thread index if thread is specified
  if (args.thread && !duplicate) {
    await updateIndexes(c, entityKey, `**Thread:** ${args.thread}`, null)
  }

  // #370: Auto-witness — when an event has a location, all OTHER entities at that
  // location automatically gain knowledge of this event.
  const autoWitnessed: string[] = []
  if (args.location && !duplicate && d1EventId && c.env.RPG_DB) {
    try {
      const locationKey = args.location.trim().toLowerCase()
      // Find occupants at this location via D1 characters table
      const { results: occupants } = await c.env.RPG_DB.prepare(
        'SELECT id, name FROM characters WHERE current_room_id = ? AND id != ?'
      ).bind(locationKey, args.entity_id ?? '').all()

      const witnessTopic = `${args.verb}${args.object ? `:${args.object}` : ''}`
      const witnessDetail = args.detail ?? ''
      for (const occ of occupants as Array<{ id: string; name: string }>) {
        const knowledgeId = randomUUID()
        try {
          await c.env.RPG_DB.prepare(
            `INSERT OR IGNORE INTO entity_knowledge (id, entity_id, topic, knowledge_type, source, acquired_at, detail, confidence, is_current)
             VALUES (?, ?, ?, 'fact', 'witnessed', ?, ?, 90, 1)`
          ).bind(knowledgeId, occ.id, witnessTopic, now, witnessDetail).run()
          autoWitnessed.push(occ.id)
        } catch {
          // Best-effort per occupant
        }
      }
    } catch {
      // Auto-witness is best-effort
    }
  }

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `Event "${newEvent.verb}" appended to "${entityKey}"${duplicate ? ' (duplicate skipped)' : ''}.` }],
    metadata: { entity_key: entityKey, event_count: events.length, duplicate, d1_event_id: d1EventId, thread: args.thread, auto_witnessed: autoWitnessed.length > 0 ? autoWitnessed : undefined }
  }), 200)
}