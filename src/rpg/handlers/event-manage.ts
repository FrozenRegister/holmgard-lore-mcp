// Poll-based analogue of Mnehmos's subscribe_to_events/unsubscribe_from_events —
// implemented per issue #206. Cloudflare Workers has no long-lived connection to
// push events over, so this exposes the existing (previously unused) event_inbox
// table as an emit/poll/ack queue instead of true WebSocket pub/sub.

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const KNOWN_EVENT_TYPES = ['npc_action', 'combat_update', 'world_change', 'quest_update', 'time_passage', 'environmental', 'system', 'crate_drop', 'perimeter_contraction', 'audience_vote', 'production_intervention', 'predator_release', 'shelter_collapse', 'weather_shift', 'echo_activation'] as const
const SOURCE_TYPES = ['npc', 'combat', 'world', 'system', 'scheduler'] as const

const ACTIONS = ['emit', 'poll', 'ack', 'list_types'] as const
type EventAction = typeof ACTIONS[number]
const ALIASES: Record<string, EventAction> = {
  publish: 'emit', send: 'emit', notify: 'emit',
  subscribe: 'poll', list: 'poll', get_events: 'poll', unsubscribe: 'poll',
  consume: 'ack', mark_read: 'ack', dismiss: 'ack',
  types: 'list_types', topics: 'list_types',
}

const InputSchema = z.object({
  action: z.string(),
  eventType: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
  sourceType: z.enum(SOURCE_TYPES).optional(),
  sourceId: z.string().optional(),
  priority: z.number().int().optional().default(0),
  id: z.number().int().optional(),
  ids: z.array(z.number().int()).optional(),
  unconsumedOnly: z.boolean().optional().default(true),
  limit: z.number().int().min(1).max(200).optional().default(50),
})

export async function handleEventManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!

  switch (match.matched) {
    case 'emit': {
      if (!a.eventType || !a.payload) return err('"eventType" and "payload" are required')
      const result = await db.prepare('INSERT INTO event_inbox (event_type, payload, source_type, source_id, priority) VALUES (?, ?, ?, ?, ?)')
        .bind(a.eventType, JSON.stringify(a.payload), a.sourceType ?? null, a.sourceId ?? null, a.priority).run()
      return ok({ success: true, actionType: 'emit', eventId: result.meta.last_row_id, eventType: a.eventType })
    }
    case 'poll': {
      const conditions: string[] = []
      const binds: unknown[] = []
      if (a.eventType) { conditions.push('event_type = ?'); binds.push(a.eventType) }
      if (a.unconsumedOnly) conditions.push('consumed_at IS NULL')
      let query = 'SELECT * FROM event_inbox'
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ')
      query += ' ORDER BY priority DESC, created_at DESC LIMIT ?'
      binds.push(a.limit)
      const { results } = await db.prepare(query).bind(...binds).all()
      const events = (results as Array<Record<string, unknown>>).map(r => ({ ...r, payload: JSON.parse(r.payload as string) }))
      return ok({ success: true, actionType: 'poll', events, count: events.length })
    }
    case 'ack': {
      const ids = a.ids ?? (a.id !== undefined ? [a.id] : [])
      if (ids.length === 0) return err('"id" or "ids" is required')
      const now = new Date().toISOString()
      for (const id of ids) await db.prepare('UPDATE event_inbox SET consumed_at = ? WHERE id = ?').bind(now, id).run()
      return ok({ success: true, actionType: 'ack', acked: ids.length })
    }
    case 'list_types': {
      return ok({ success: true, actionType: 'list_types', eventTypes: KNOWN_EVENT_TYPES, sourceTypes: SOURCE_TYPES, note: 'eventType accepts any string; these are known types but custom types are permitted' })
    }
  }
}
