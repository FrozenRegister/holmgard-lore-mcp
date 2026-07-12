// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/narrative-manage.ts

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError, CRUD_ALIASES } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['create', 'get', 'list', 'update', 'delete', 'archive', 'resolve'] as const
type NarrativeAction = typeof ACTIONS[number]
const ALIASES: Record<string, NarrativeAction> = {
  ...CRUD_ALIASES,
  add_note: 'create', log: 'create', record: 'create',
  close: 'archive', hide: 'archive',
  complete: 'resolve', finish: 'resolve',
} as Record<string, NarrativeAction>

const NoteTypeEnum = z.enum(['plot_thread', 'canonical_moment', 'npc_voice', 'foreshadowing', 'session_log'])
const VisibilityEnum = z.enum(['dm_only', 'player_visible'])

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  worldId: z.string().optional(),
  type: NoteTypeEnum.optional().default('session_log'),
  content: z.string().optional(),
  visibility: VisibilityEnum.optional().default('dm_only'),
  tags: z.array(z.string()).optional(),
  entityId: z.string().optional(),
  entityType: z.string().optional(),
  status: z.enum(['active', 'resolved', 'dormant', 'archived']).optional(),
  metadata: z.record(z.unknown()).optional(),
  filter: z.object({ type: NoteTypeEnum.optional(), status: z.string().optional(), entityId: z.string().optional() }).optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
})

export async function handleNarrativeManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'create': {
      if (!a.worldId || !a.content) return err('"worldId" and "content" are required')
      const id = crypto.randomUUID()
      await db.prepare('INSERT INTO narrative_notes (id, world_id, type, content, metadata, visibility, tags, entity_id, entity_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, a.worldId, a.type, a.content, JSON.stringify(a.metadata ?? {}), a.visibility, JSON.stringify(a.tags ?? []), a.entityId ?? null, a.entityType ?? null, 'active', now, now).run()
      return ok({ success: true, actionType: 'create', noteId: id, type: a.type })
    }
    case 'get': {
      if (!a.id) return err('"id" (the note UUID returned by create, "noteId") is required. Use "list" with worldId to find narrative note IDs. Example: { action: "get", id: "uuid-of-the-note", worldId: "..." }')
      const row = await db.prepare('SELECT * FROM narrative_notes WHERE id = ?').bind(a.id).first()
      if (!row) return err(`Note not found: ${a.id}`)
      return ok({ success: true, actionType: 'get', note: { ...row, metadata: JSON.parse((row as any).metadata ?? '{}'), tags: JSON.parse((row as any).tags ?? '[]') } })
    }
    case 'list': {
      let query = 'SELECT id, type, content, status, visibility, created_at FROM narrative_notes WHERE world_id = ?'
      const binds: unknown[] = [a.worldId ?? '']
      if (a.filter?.type) { query += ' AND type = ?'; binds.push(a.filter.type) }
      if (a.filter?.status) { query += ' AND status = ?'; binds.push(a.filter.status) }
      if (a.filter?.entityId) { query += ' AND entity_id = ?'; binds.push(a.filter.entityId) }
      query += ' ORDER BY created_at DESC LIMIT ?'; binds.push(a.limit)
      const { results } = await db.prepare(query).bind(...binds).all()
      return ok({ success: true, actionType: 'list', notes: results, count: results.length })
    }
    case 'update': {
      if (!a.id) return err('"id" is required')
      const sets: string[] = ['updated_at = ?']; const vals: unknown[] = [now]
      if (a.content) { sets.push('content = ?'); vals.push(a.content) }
      if (a.visibility) { sets.push('visibility = ?'); vals.push(a.visibility) }
      if (a.tags) { sets.push('tags = ?'); vals.push(JSON.stringify(a.tags)) }
      if (a.status) { sets.push('status = ?'); vals.push(a.status) }
      if (a.metadata) { sets.push('metadata = ?'); vals.push(JSON.stringify(a.metadata)) }
      vals.push(a.id)
      await db.prepare(`UPDATE narrative_notes SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
      return ok({ success: true, actionType: 'update', id: a.id })
    }
    case 'delete': {
      if (!a.id) return err('"id" is required')
      await db.prepare('DELETE FROM narrative_notes WHERE id = ?').bind(a.id).run()
      return ok({ success: true, actionType: 'delete', id: a.id })
    }
    case 'archive': {
      if (!a.id) return err('"id" is required')
      await db.prepare("UPDATE narrative_notes SET status = 'archived', updated_at = ? WHERE id = ?").bind(now, a.id).run()
      return ok({ success: true, actionType: 'archive', id: a.id, status: 'archived' })
    }
    case 'resolve': {
      if (!a.id) return err('"id" is required')
      await db.prepare("UPDATE narrative_notes SET status = 'resolved', updated_at = ? WHERE id = ?").bind(now, a.id).run()
      return ok({ success: true, actionType: 'resolve', id: a.id, status: 'resolved' })
    }
  }
}
