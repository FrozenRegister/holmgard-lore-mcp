// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/theft-manage.ts

import { z } from 'zod'
import { randomUUID } from 'crypto'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['steal', 'fence', 'get', 'list', 'recover', 'cool_heat', 'report'] as const
type TheftAction = typeof ACTIONS[number]
const ALIASES: Record<string, TheftAction> = {
  create: 'steal', pick_pocket: 'steal', pickpocket: 'steal', theft: 'steal',
  sell_stolen: 'fence', fence_item: 'fence',
  retrieve: 'get', find: 'get',
  all: 'list', search: 'list',
  restore: 'recover', returned: 'recover',
  reduce_heat: 'cool_heat', heat_down: 'cool_heat',
  guards: 'report', report_theft: 'report',
}

const HeatEnum = z.enum(['burning', 'hot', 'warm', 'cool', 'cold'])

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  itemId: z.string().optional(),
  stolenFrom: z.string().optional(),
  stolenBy: z.string().optional(),
  stolenLocation: z.string().optional(),
  witnesses: z.array(z.string()).optional(),
  bounty: z.number().int().min(0).optional().default(0),
  fencedTo: z.string().optional(),
  filter: z.object({ thief: z.string().optional(), heat: HeatEnum.optional(), recovered: z.boolean().optional() }).optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
})

export async function handleTheftManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'steal': {
      if (!a.itemId || !a.stolenFrom || !a.stolenBy) return err('"itemId", "stolenFrom", and "stolenBy" are required')
      const id = randomUUID()
      await db.prepare('INSERT INTO stolen_items (id, item_id, stolen_from, stolen_by, stolen_at, stolen_location, heat_level, heat_updated_at, witnesses, bounty, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, a.itemId, a.stolenFrom, a.stolenBy, now, a.stolenLocation ?? null, 'burning', now, JSON.stringify(a.witnesses ?? []), a.bounty, now, now).run()
      return ok({ success: true, actionType: 'steal', stolenItemId: id, itemId: a.itemId, heatLevel: 'burning' })
    }
    case 'get': {
      if (!a.id) return err('"id" is required')
      const row = await db.prepare('SELECT * FROM stolen_items WHERE id = ?').bind(a.id).first()
      if (!row) return err(`Stolen item record not found: ${a.id}`)
      return ok({ success: true, actionType: 'get', stolenItem: { ...row, witnesses: JSON.parse((row as any).witnesses ?? '[]') } })
    }
    case 'list': {
      let query = 'SELECT id, item_id, stolen_from, stolen_by, heat_level, bounty, fenced, recovered FROM stolen_items WHERE 1=1'
      const binds: unknown[] = []
      if (a.filter?.thief) { query += ' AND stolen_by = ?'; binds.push(a.filter.thief) }
      if (a.filter?.heat) { query += ' AND heat_level = ?'; binds.push(a.filter.heat) }
      if (a.filter?.recovered !== undefined) { query += ' AND recovered = ?'; binds.push(a.filter.recovered ? 1 : 0) }
      query += ' ORDER BY stolen_at DESC LIMIT ?'; binds.push(a.limit)
      const { results } = await db.prepare(query).bind(...binds).all()
      return ok({ success: true, actionType: 'list', stolenItems: results, count: results.length })
    }
    case 'fence': {
      if (!a.id) return err('"id" is required')
      await db.prepare('UPDATE stolen_items SET fenced = 1, fenced_at = ?, fenced_to = ?, updated_at = ? WHERE id = ?').bind(now, a.fencedTo ?? null, now, a.id).run()
      return ok({ success: true, actionType: 'fence', id: a.id, fencedAt: now })
    }
    case 'recover': {
      if (!a.id) return err('"id" is required')
      await db.prepare('UPDATE stolen_items SET recovered = 1, recovered_at = ?, heat_level = ?, updated_at = ? WHERE id = ?').bind(now, 'cold', now, a.id).run()
      return ok({ success: true, actionType: 'recover', id: a.id, heatLevel: 'cold' })
    }
    case 'cool_heat': {
      if (!a.id) return err('"id" is required')
      const row = await db.prepare('SELECT heat_level FROM stolen_items WHERE id = ?').bind(a.id).first() as { heat_level: string } | null
      if (!row) return err(`Record not found: ${a.id}`)
      const levels = ['burning', 'hot', 'warm', 'cool', 'cold']
      const idx = levels.indexOf(row.heat_level)
      const newHeat = idx < levels.length - 1 ? levels[idx + 1] : 'cold'
      await db.prepare('UPDATE stolen_items SET heat_level = ?, heat_updated_at = ?, updated_at = ? WHERE id = ?').bind(newHeat, now, now, a.id).run()
      return ok({ success: true, actionType: 'cool_heat', id: a.id, previousHeat: row.heat_level, newHeat })
    }
    case 'report': {
      if (!a.id) return err('"id" is required')
      await db.prepare('UPDATE stolen_items SET reported_to_guards = 1, updated_at = ? WHERE id = ?').bind(now, a.id).run()
      return ok({ success: true, actionType: 'report', id: a.id, reportedToGuards: true })
    }
  }
}
