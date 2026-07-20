// #316 — conflict type taxonomy: physical, social, and hybrid scenes for
// dual-agent routing. Global (not per-world) taxonomy, same shape as #311's
// event_verb_taxonomy: seeded with the three core types (migration 0035),
// runtime-extensible here without a code deploy.

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError, CRUD_ALIASES } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const RESOLVERS = ['combat', 'drama', 'both'] as const

export const ACTIONS = ['list', 'create', 'update', 'delete'] as const
type ConflictTypeAction = typeof ACTIONS[number]
const ALIASES: Record<string, ConflictTypeAction> = {
  ...CRUD_ALIASES,
  register: 'create', add: 'create',
  remove: 'delete',
} as Record<string, ConflictTypeAction>

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  resolver: z.enum(RESOLVERS).optional(),
})

export async function handleConflictTypeManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'list': {
      const { results } = await db.prepare('SELECT * FROM conflict_types ORDER BY name').all()
      return ok({ success: true, actionType: 'list', conflictTypes: results, count: results.length })
    }
    case 'create': {
      if (!a.name) return err('"name" is required')
      if (!a.resolver) return err('"resolver" is required (one of: combat, drama, both)')
      const existing = await db.prepare('SELECT id FROM conflict_types WHERE name = ?').bind(a.name).first()
      if (existing) return err(`Conflict type "${a.name}" already exists`)
      const id = a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      await db.prepare('INSERT INTO conflict_types (id, name, description, resolver, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(id, a.name, a.description ?? null, a.resolver, now).run()
      return ok({ success: true, actionType: 'create', conflictTypeId: id, name: a.name, resolver: a.resolver })
    }
    case 'update': {
      if (!a.id) return err('"id" is required')
      const existing = await db.prepare('SELECT id FROM conflict_types WHERE id = ?').bind(a.id).first()
      if (!existing) return err(`Conflict type not found: ${a.id}`)
      const sets: string[] = []
      const vals: unknown[] = []
      if (a.description !== undefined) { sets.push('description = ?'); vals.push(a.description) }
      if (a.resolver !== undefined) { sets.push('resolver = ?'); vals.push(a.resolver) }
      if (sets.length === 0) return err('No fields to update provided')
      vals.push(a.id)
      await db.prepare(`UPDATE conflict_types SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
      return ok({ success: true, actionType: 'update', conflictTypeId: a.id })
    }
    case 'delete': {
      if (!a.id) return err('"id" is required')
      const existing = await db.prepare('SELECT id FROM conflict_types WHERE id = ?').bind(a.id).first()
      if (!existing) return err(`Conflict type not found: ${a.id}`)
      const sceneRef = await db.prepare('SELECT 1 FROM scenes WHERE conflict_type_id = ? LIMIT 1').bind(a.id).first()
      if (sceneRef) return err(`Cannot delete conflict type "${a.id}" — referenced by existing scenes`)
      await db.prepare('DELETE FROM conflict_types WHERE id = ?').bind(a.id).run()
      return ok({ success: true, actionType: 'delete', conflictTypeId: a.id })
    }
  }
}
