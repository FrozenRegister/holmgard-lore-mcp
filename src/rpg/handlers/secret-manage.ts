// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/secret-manage.ts

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError, CRUD_ALIASES } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'
import { applyDynamicFields } from '../utils/dynamic-fields'

// #425 — notes/linked_entity_id/linked_entity_type/leak_patterns/category
// have no update path (present since the initial migration, not caused by a
// later ALTER TABLE — same structural gap, lower urgency). See dynamic-fields.ts.
const SECRET_FIELDS_BLACKLIST = ['id', 'created_at', 'updated_at', 'world_id'] as const

export const ACTIONS = ['create', 'get', 'list', 'update', 'delete', 'reveal', 'check_reveal'] as const
type SecretAction = typeof ACTIONS[number]
const ALIASES: Record<string, SecretAction> = {
  ...CRUD_ALIASES,
  add_secret: 'create', hide: 'create',
  expose: 'reveal', uncover: 'reveal', discover: 'reveal',
  check: 'check_reveal', can_reveal: 'check_reveal',
} as Record<string, SecretAction>

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  worldId: z.string().optional(),
  type: z.string().optional().default('lore'),
  category: z.string().optional().default('general'),
  name: z.string().optional(),
  publicDescription: z.string().optional(),
  secretDescription: z.string().optional(),
  linkedEntityId: z.string().optional(),
  linkedEntityType: z.string().optional(),
  revealConditions: z.array(z.string()).optional(),
  sensitivity: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
  revealedBy: z.string().optional(),
  filter: z.object({ revealed: z.boolean().optional(), linkedEntityId: z.string().optional() }).optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
  // #425 — arbitrary D1 column passthrough, valid on `update` only.
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
})

export async function handleSecretManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'create': {
      if (!a.worldId || !a.name || !a.publicDescription || !a.secretDescription) return err('"worldId", "name", "publicDescription", and "secretDescription" are required')
      const id = crypto.randomUUID()
      await db.prepare('INSERT INTO secrets (id, world_id, type, category, name, public_description, secret_description, linked_entity_id, linked_entity_type, reveal_conditions, sensitivity, leak_patterns, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, a.worldId, a.type, a.category, a.name, a.publicDescription, a.secretDescription, a.linkedEntityId ?? null, a.linkedEntityType ?? null, JSON.stringify(a.revealConditions ?? []), a.sensitivity, '[]', now, now).run()
      return ok({ success: true, actionType: 'create', secretId: id, name: a.name, sensitivity: a.sensitivity })
    }
    case 'get': {
      if (!a.id) return err('"id" (the secret UUID returned by create, e.g. "uuid-of-the-secret") is required. Use "list" with worldId to find secret IDs, or filter by linkedEntityId')
      const row = await db.prepare('SELECT * FROM secrets WHERE id = ?').bind(a.id).first()
      if (!row) return err(`Secret not found: ${a.id}`)
      return ok({ success: true, actionType: 'get', secret: { ...row, reveal_conditions: JSON.parse((row as any).reveal_conditions ?? '[]'), leak_patterns: JSON.parse((row as any).leak_patterns ?? '[]') } })
    }
    case 'list': {
      let query = 'SELECT id, name, type, category, sensitivity, revealed, created_at FROM secrets WHERE world_id = ?'
      const binds: unknown[] = [a.worldId ?? '']
      if (a.filter?.revealed !== undefined) { query += ' AND revealed = ?'; binds.push(a.filter.revealed ? 1 : 0) }
      if (a.filter?.linkedEntityId) { query += ' AND linked_entity_id = ?'; binds.push(a.filter.linkedEntityId) }
      query += ' ORDER BY created_at DESC LIMIT ?'; binds.push(a.limit)
      const { results } = await db.prepare(query).bind(...binds).all()
      return ok({ success: true, actionType: 'list', secrets: results, count: results.length })
    }
    case 'update': {
      if (!a.id) return err('"id" is required')
      const sets: string[] = ['updated_at = ?']; const vals: unknown[] = [now]
      if (a.name) { sets.push('name = ?'); vals.push(a.name) }
      if (a.publicDescription) { sets.push('public_description = ?'); vals.push(a.publicDescription) }
      if (a.secretDescription) { sets.push('secret_description = ?'); vals.push(a.secretDescription) }
      if (a.sensitivity) { sets.push('sensitivity = ?'); vals.push(a.sensitivity) }
      if (a.revealConditions) { sets.push('reveal_conditions = ?'); vals.push(JSON.stringify(a.revealConditions)) }
      const { applied: fieldsApplied, rejected: fieldsRejected } = applyDynamicFields(a.fields, SECRET_FIELDS_BLACKLIST, sets, vals)
      vals.push(a.id)
      await db.prepare(`UPDATE secrets SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
      return ok({
        success: true, actionType: 'update', id: a.id,
        ...(a.fields ? { fields_applied: fieldsApplied, fields_rejected: fieldsRejected } : {}),
      })
    }
    case 'delete': {
      if (!a.id) return err('"id" is required')
      await db.prepare('DELETE FROM secrets WHERE id = ?').bind(a.id).run()
      return ok({ success: true, actionType: 'delete', id: a.id })
    }
    case 'reveal': {
      if (!a.id) return err('"id" is required')
      await db.prepare('UPDATE secrets SET revealed = 1, revealed_at = ?, revealed_by = ?, updated_at = ? WHERE id = ?').bind(now, a.revealedBy ?? null, now, a.id).run()
      return ok({ success: true, actionType: 'reveal', id: a.id, revealedAt: now })
    }
    case 'check_reveal': {
      if (!a.id) return err('"id" is required')
      const row = await db.prepare('SELECT revealed, sensitivity, reveal_conditions, notes FROM secrets WHERE id = ?').bind(a.id).first()
      if (!row) return err(`Secret not found: ${a.id}`)
      const conditions = JSON.parse((row as any).reveal_conditions ?? '[]')
      return ok({ success: true, actionType: 'check_reveal', id: a.id, alreadyRevealed: !!(row as any).revealed, revealConditions: conditions, sensitivity: (row as any).sensitivity })
    }
  }
}
