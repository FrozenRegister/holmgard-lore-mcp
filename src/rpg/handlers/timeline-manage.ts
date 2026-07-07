// src/rpg/handlers/timeline-manage.ts
// D1-backed narrative timeline: events, branches, perspectives, gap analysis.

import { z } from 'zod'
import { randomUUID } from 'crypto'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = [
  'get_events',
  'get_gap',
  'get_perspectives',
  'create_branch',
  'switch_branch',
  'compare_branches',
  'merge_branch',
] as const
type TimelineAction = typeof ACTIONS[number]
const ALIASES: Record<string, TimelineAction> = {
  events:     'get_events',
  list:       'get_events',
  gap:        'get_gap',
  between:    'get_gap',
  characters: 'get_perspectives',
  pov:        'get_perspectives',
  branch:     'create_branch',
  fork:       'create_branch',
  switch:     'switch_branch',
  compare:    'compare_branches',
  diff:       'compare_branches',
  merge:      'merge_branch',
}

const InputSchema = z.object({
  action:          z.string(),
  world_id:        z.string().optional(),
  thread:          z.string().optional(),
  from:            z.string().optional(),
  to:              z.string().optional(),
  entity_id:       z.string().optional(),
  verb:            z.string().optional(),
  canonical_only:  z.boolean().optional(),
  before_event_id: z.string().optional(),
  after_event_id:  z.string().optional(),
  name:            z.string().optional(),
  forked_at_event_id: z.string().optional(),
  reason:          z.string().optional(),
  branch_id:       z.string().optional(),
  branch_a:        z.string().optional(),
  branch_b:        z.string().optional(),
  source_branch_id: z.string().optional(),
  target_branch_id: z.string().optional(),
  event_ids:       z.array(z.string()).optional(),
  limit:           z.number().int().min(1).max(500).optional(),
})

type TimelineEvent = {
  id: string
  world_id: string
  thread_id: string
  event_at: string
  verb: string
  entity_id: string | null
  object_entity: string | null
  location_id: string | null
  detail: string | null
  is_canonical: number
  branch_id: string | null
  created_at: string
}

export async function handleTimelineManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data

  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)

  const db = env.RPG_DB!

  switch (match.matched) {
    case 'get_events': {
      if (!a.world_id) return err('"world_id" is required')
      const limit = a.limit ?? 100
      const parts: string[] = ['SELECT * FROM timeline_events WHERE world_id = ?']
      const binds: unknown[] = [a.world_id]
      if (a.thread)         { parts.push('AND thread_id = ?'); binds.push(a.thread) }
      if (a.entity_id)      { parts.push('AND entity_id = ?'); binds.push(a.entity_id) }
      if (a.verb)           { parts.push('AND verb = ?');      binds.push(a.verb) }
      if (a.from)           { parts.push('AND event_at >= ?'); binds.push(a.from) }
      if (a.to)             { parts.push('AND event_at <= ?'); binds.push(a.to) }
      if (a.canonical_only) { parts.push('AND is_canonical = 1') }
      if (a.branch_id)      { parts.push('AND (branch_id = ? OR branch_id IS NULL)'); binds.push(a.branch_id) }
      parts.push('ORDER BY event_at ASC LIMIT ?')
      binds.push(limit)
      const rows = await db.prepare(parts.join(' ')).bind(...binds).all() as { results: TimelineEvent[] }
      return ok({ success: true, actionType: 'get_events', world_id: a.world_id, count: rows.results.length, events: rows.results })
    }

    case 'get_gap': {
      if (!a.before_event_id) return err('"before_event_id" is required')
      if (!a.after_event_id)  return err('"after_event_id" is required')
      const [before, after] = await Promise.all([
        db.prepare('SELECT * FROM timeline_events WHERE id = ?').bind(a.before_event_id).first() as Promise<TimelineEvent | null>,
        db.prepare('SELECT * FROM timeline_events WHERE id = ?').bind(a.after_event_id).first() as Promise<TimelineEvent | null>,
      ])
      if (!before) return err(`Event not found: ${a.before_event_id}`)
      if (!after)  return err(`Event not found: ${a.after_event_id}`)
      const canonical = await db
        .prepare('SELECT * FROM timeline_events WHERE world_id = ? AND event_at > ? AND event_at < ? AND is_canonical = 1 ORDER BY event_at ASC')
        .bind(before.world_id, before.event_at, after.event_at)
        .all() as { results: TimelineEvent[] }
      const chars = await db
        .prepare('SELECT DISTINCT entity_id FROM timeline_events WHERE world_id = ? AND event_at > ? AND event_at < ? AND entity_id IS NOT NULL')
        .bind(before.world_id, before.event_at, after.event_at)
        .all() as { results: Array<{ entity_id: string }> }
      return ok({
        success: true, actionType: 'get_gap',
        before_event: before, after_event: after,
        canonical_events_in_gap: canonical.results,
        present_characters: chars.results.map(r => r.entity_id),
      })
    }

    case 'get_perspectives': {
      if (!a.world_id) return err('"world_id" is required')
      if (!a.from)     return err('"from" is required')
      if (!a.to)       return err('"to" is required')
      const rows = await db
        .prepare('SELECT DISTINCT entity_id FROM timeline_events WHERE world_id = ? AND event_at >= ? AND event_at <= ? AND entity_id IS NOT NULL')
        .bind(a.world_id, a.from, a.to)
        .all() as { results: Array<{ entity_id: string }> }
      return ok({ success: true, actionType: 'get_perspectives', world_id: a.world_id, from: a.from, to: a.to, characters: rows.results.map(r => r.entity_id) })
    }

    case 'create_branch': {
      if (!a.world_id)           return err('"world_id" is required')
      if (!a.name)               return err('"name" is required')
      if (!a.forked_at_event_id) return err('"forked_at_event_id" is required')
      const pivot = await db.prepare('SELECT id FROM timeline_events WHERE id = ?').bind(a.forked_at_event_id).first() as { id: string } | null
      if (!pivot) return err(`Pivot event not found: ${a.forked_at_event_id}`)
      const branchId = randomUUID()
      const now = new Date().toISOString()
      await db.prepare(
        'INSERT INTO timeline_branches (id, world_id, name, forked_at_event_id, fork_reason, is_active, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
      ).bind(branchId, a.world_id, a.name, a.forked_at_event_id, a.reason ?? null, now).run()
      return ok({ success: true, actionType: 'create_branch', branch_id: branchId, world_id: a.world_id, name: a.name, forked_at_event_id: a.forked_at_event_id })
    }

    case 'switch_branch': {
      if (!a.world_id)   return err('"world_id" is required')
      if (!a.branch_id)  return err('"branch_id" is required')
      const branch = await db.prepare('SELECT id FROM timeline_branches WHERE id = ? AND world_id = ?').bind(a.branch_id, a.world_id).first() as { id: string } | null
      if (!branch) return err(`Branch not found: ${a.branch_id}`)
      await db.prepare('UPDATE timeline_branches SET is_active = 0 WHERE world_id = ?').bind(a.world_id).run()
      await db.prepare('UPDATE timeline_branches SET is_active = 1 WHERE id = ?').bind(a.branch_id).run()
      return ok({ success: true, actionType: 'switch_branch', world_id: a.world_id, active_branch_id: a.branch_id })
    }

    case 'compare_branches': {
      if (!a.branch_a) return err('"branch_a" is required')
      if (!a.branch_b) return err('"branch_b" is required')
      const [rowsA, rowsB] = await Promise.all([
        db.prepare('SELECT id FROM timeline_events WHERE branch_id = ?').bind(a.branch_a).all() as Promise<{ results: Array<{ id: string }> }>,
        db.prepare('SELECT id FROM timeline_events WHERE branch_id = ?').bind(a.branch_b).all() as Promise<{ results: Array<{ id: string }> }>,
      ])
      const setA = new Set(rowsA.results.map(r => r.id))
      const setB = new Set(rowsB.results.map(r => r.id))
      const shared     = [...setA].filter(id => setB.has(id))
      const onlyInA    = [...setA].filter(id => !setB.has(id))
      const onlyInB    = [...setB].filter(id => !setA.has(id))
      return ok({ success: true, actionType: 'compare_branches', branch_a: a.branch_a, branch_b: a.branch_b, shared_count: shared.length, only_in_a: onlyInA, only_in_b: onlyInB })
    }

    case 'merge_branch': {
      if (!a.source_branch_id) return err('"source_branch_id" is required')
      if (!a.target_branch_id) return err('"target_branch_id" is required')
      if (!a.event_ids || a.event_ids.length === 0) return err('"event_ids" must be a non-empty array')
      let merged = 0
      for (const eid of a.event_ids) {
        const row = await db.prepare('SELECT branch_id FROM timeline_events WHERE id = ? AND branch_id = ?').bind(eid, a.source_branch_id).first() as { branch_id: string } | null
        if (!row) continue
        await db.prepare('UPDATE timeline_events SET branch_id = ? WHERE id = ?').bind(a.target_branch_id, eid).run()
        merged++
      }
      return ok({ success: true, actionType: 'merge_branch', source_branch_id: a.source_branch_id, target_branch_id: a.target_branch_id, merged_count: merged })
    }
  }
}
