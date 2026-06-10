// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/item-manage.ts

import { z } from 'zod'
import { randomUUID } from 'crypto'
import { matchAction, isGuidingError, formatGuidingError, CRUD_ALIASES } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['create', 'get', 'list', 'update', 'delete', 'search'] as const
type ItemAction = typeof ACTIONS[number]
const ALIASES: Record<string, ItemAction> = { ...CRUD_ALIASES } as Record<string, ItemAction>

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  type: z.string().optional(),
  weight: z.number().min(0).optional().default(0),
  value: z.number().int().min(0).optional().default(0),
  properties: z.record(z.unknown()).optional(),
  query: z.string().optional(),
  itemType: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
})

export async function handleItemManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'create': {
      if (!a.name || !a.type) return err('"name" and "type" are required')
      const id = randomUUID()
      await db.prepare('INSERT INTO items (id, name, description, type, weight, value, properties, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, a.name, a.description ?? null, a.type, a.weight, a.value, a.properties ? JSON.stringify(a.properties) : null, now, now).run()
      return ok({ success: true, actionType: 'create', itemId: id, name: a.name, type: a.type })
    }
    case 'get': {
      if (!a.id) return err('"id" is required')
      const row = await db.prepare('SELECT * FROM items WHERE id = ?').bind(a.id).first()
      if (!row) return err(`Item not found: ${a.id}`)
      return ok({ success: true, actionType: 'get', item: { ...row, properties: row.properties ? JSON.parse(row.properties as string) : null } })
    }
    case 'list': {
      let query = 'SELECT id, name, type, weight, value FROM items'
      const binds: unknown[] = []
      if (a.itemType) { query += ' WHERE type = ?'; binds.push(a.itemType) }
      query += ' ORDER BY name LIMIT ?'; binds.push(a.limit)
      const { results } = await db.prepare(query).bind(...binds).all()
      return ok({ success: true, actionType: 'list', items: results, count: results.length })
    }
    case 'update': {
      if (!a.id) return err('"id" is required')
      const sets: string[] = ['updated_at = ?']; const vals: unknown[] = [now]
      if (a.name) { sets.push('name = ?'); vals.push(a.name) }
      if (a.description !== undefined) { sets.push('description = ?'); vals.push(a.description) }
      if (a.type) { sets.push('type = ?'); vals.push(a.type) }
      if (a.weight !== undefined) { sets.push('weight = ?'); vals.push(a.weight) }
      if (a.value !== undefined) { sets.push('value = ?'); vals.push(a.value) }
      if (a.properties) { sets.push('properties = ?'); vals.push(JSON.stringify(a.properties)) }
      vals.push(a.id)
      await db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
      return ok({ success: true, actionType: 'update', id: a.id })
    }
    case 'delete': {
      if (!a.id) return err('"id" is required')
      await db.prepare('DELETE FROM items WHERE id = ?').bind(a.id).run()
      return ok({ success: true, actionType: 'delete', id: a.id })
    }
    case 'search': {
      if (!a.query) return err('"query" is required for search')
      const pattern = `%${a.query}%`
      const { results } = await db.prepare('SELECT id, name, type, weight, value FROM items WHERE name LIKE ? OR description LIKE ? LIMIT ?')
        .bind(pattern, pattern, a.limit).all()
      return ok({ success: true, actionType: 'search', query: a.query, items: results, count: results.length })
    }
  }
}
