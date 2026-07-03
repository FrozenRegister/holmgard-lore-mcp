// Ported from Mnehmos v1.0.3 (scroll_manage) — previously declined as out-of-scope
// in issue #74; implemented per issue #206.
// Scrolls are `items` rows with type='scroll'; spell metadata lives in the
// existing free-form `properties` JSON column (see item-manage.ts) — no schema
// migration needed.

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['create', 'use', 'identify', 'get_dc', 'get_details'] as const
type ScrollAction = typeof ACTIONS[number]
const ALIASES: Record<string, ScrollAction> = {
  new_scroll: 'create', make: 'create',
  read: 'use', activate: 'use', cast: 'use',
  reveal: 'identify', appraise: 'identify',
  dc: 'get_dc', save_dc: 'get_dc',
  details: 'get_details', inspect: 'get_details', get: 'get_details',
}

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  spellName: z.string().optional(),
  spellLevel: z.number().int().min(0).max(9).optional().default(1),
  saveDc: z.number().int().min(1).optional().default(13),
  charges: z.number().int().min(0).optional().default(1),
  casterId: z.string().optional(),
})

type ScrollProperties = { spellName: string; spellLevel: number; saveDc: number; charges: number; identified: boolean }

async function loadScroll(db: D1Database, id: string): Promise<{ name: string; properties: ScrollProperties } | null> {
  const row = await db.prepare("SELECT name, properties FROM items WHERE id = ? AND type = 'scroll'").bind(id).first() as { name: string; properties: string | null } | null
  if (!row) return null
  return { name: row.name, properties: row.properties ? JSON.parse(row.properties) : { spellName: '', spellLevel: 0, saveDc: 10, charges: 0, identified: false } }
}

export async function handleScrollManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'create': {
      if (!a.name || !a.spellName) return err('"name" and "spellName" are required')
      const id = crypto.randomUUID()
      const properties: ScrollProperties = { spellName: a.spellName, spellLevel: a.spellLevel, saveDc: a.saveDc, charges: a.charges, identified: false }
      await db.prepare('INSERT INTO items (id, name, description, type, weight, value, properties, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, a.name, a.description ?? null, 'scroll', 0, 0, JSON.stringify(properties), now, now).run()
      return ok({ success: true, actionType: 'create', scrollId: id, name: a.name, spellName: a.spellName, spellLevel: a.spellLevel, charges: a.charges })
    }
    case 'use': {
      if (!a.id) return err('"id" is required')
      const scroll = await loadScroll(db, a.id)
      if (!scroll) return err(`Scroll not found: ${a.id}`)
      if (scroll.properties.charges <= 0) return err(`Scroll ${a.id} has no charges remaining`)
      scroll.properties.charges -= 1
      scroll.properties.identified = true
      await db.prepare('UPDATE items SET properties = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(scroll.properties), now, a.id).run()
      return ok({
        success: true, actionType: 'use', scrollId: a.id, casterId: a.casterId ?? null,
        spellName: scroll.properties.spellName, spellLevel: scroll.properties.spellLevel, saveDc: scroll.properties.saveDc,
        remainingCharges: scroll.properties.charges,
      })
    }
    case 'identify': {
      if (!a.id) return err('"id" is required')
      const scroll = await loadScroll(db, a.id)
      if (!scroll) return err(`Scroll not found: ${a.id}`)
      scroll.properties.identified = true
      await db.prepare('UPDATE items SET properties = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(scroll.properties), now, a.id).run()
      return ok({ success: true, actionType: 'identify', scrollId: a.id, spellName: scroll.properties.spellName, spellLevel: scroll.properties.spellLevel, saveDc: scroll.properties.saveDc })
    }
    case 'get_dc': {
      if (!a.id) return err('"id" is required')
      const scroll = await loadScroll(db, a.id)
      if (!scroll) return err(`Scroll not found: ${a.id}`)
      return ok({ success: true, actionType: 'get_dc', scrollId: a.id, saveDc: scroll.properties.saveDc })
    }
    case 'get_details': {
      if (!a.id) return err('"id" is required')
      const scroll = await loadScroll(db, a.id)
      if (!scroll) return err(`Scroll not found: ${a.id}`)
      if (!scroll.properties.identified) {
        return ok({ success: true, actionType: 'get_details', scrollId: a.id, name: scroll.name, identified: false, note: 'Unidentified — use action "identify" to reveal spell details.' })
      }
      return ok({
        success: true, actionType: 'get_details', scrollId: a.id, name: scroll.name, identified: true,
        spellName: scroll.properties.spellName, spellLevel: scroll.properties.spellLevel, saveDc: scroll.properties.saveDc, charges: scroll.properties.charges,
      })
    }
  }
}
