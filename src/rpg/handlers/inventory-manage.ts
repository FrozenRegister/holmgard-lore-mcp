// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/inventory-manage.ts

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['get', 'add', 'remove', 'equip', 'unequip', 'transfer'] as const
type InvAction = typeof ACTIONS[number]
const ALIASES: Record<string, InvAction> = {
  list: 'get', show: 'get', fetch: 'get',
  give: 'add', pick_up: 'add', loot: 'add',
  drop: 'remove', discard: 'remove', delete_item: 'remove',
  wear: 'equip', wield: 'equip',
  take_off: 'unequip', remove_equipment: 'unequip',
  move: 'transfer', send: 'transfer',
}

const InputSchema = z.object({
  action: z.string(),
  characterId: z.string().optional(),
  itemId: z.string().optional(),
  quantity: z.number().int().min(1).optional().default(1),
  slot: z.string().optional(),
  targetCharacterId: z.string().optional(),
})

export async function handleInventoryManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!

  switch (match.matched) {
    case 'get': {
      if (!a.characterId) return err('"characterId" is required')
      const { results } = await db.prepare(`
        SELECT ii.item_id, ii.quantity, ii.equipped, ii.slot, i.name, i.type, i.weight, i.value
        FROM inventory_items ii JOIN items i ON ii.item_id = i.id
        WHERE ii.character_id = ? ORDER BY ii.equipped DESC, i.name
      `).bind(a.characterId).all()
      const totalWeight = results.reduce((sum: number, r: Record<string, unknown>) => sum + (r.weight as number ?? 0) * (r.quantity as number ?? 1), 0)
      return ok({ success: true, actionType: 'get', characterId: a.characterId, items: results, count: results.length, totalWeight })
    }
    case 'add': {
      if (!a.characterId || !a.itemId) return err('"characterId" and "itemId" are required')
      const existing = await db.prepare('SELECT quantity FROM inventory_items WHERE character_id = ? AND item_id = ?').bind(a.characterId, a.itemId).first() as { quantity: number } | null
      if (existing) {
        await db.prepare('UPDATE inventory_items SET quantity = quantity + ? WHERE character_id = ? AND item_id = ?').bind(a.quantity, a.characterId, a.itemId).run()
      } else {
        await db.prepare('INSERT INTO inventory_items (character_id, item_id, quantity, equipped) VALUES (?, ?, ?, 0)').bind(a.characterId, a.itemId, a.quantity).run()
      }
      return ok({ success: true, actionType: 'add', characterId: a.characterId, itemId: a.itemId, quantity: a.quantity })
    }
    case 'remove': {
      if (!a.characterId || !a.itemId) return err('"characterId" and "itemId" are required')
      const existing = await db.prepare('SELECT quantity FROM inventory_items WHERE character_id = ? AND item_id = ?').bind(a.characterId, a.itemId).first() as { quantity: number } | null
      if (!existing) return err('Item not in inventory')
      if (existing.quantity <= a.quantity) {
        await db.prepare('DELETE FROM inventory_items WHERE character_id = ? AND item_id = ?').bind(a.characterId, a.itemId).run()
      } else {
        await db.prepare('UPDATE inventory_items SET quantity = quantity - ? WHERE character_id = ? AND item_id = ?').bind(a.quantity, a.characterId, a.itemId).run()
      }
      return ok({ success: true, actionType: 'remove', characterId: a.characterId, itemId: a.itemId, removed: a.quantity })
    }
    case 'equip': {
      if (!a.characterId || !a.itemId) return err('"characterId" and "itemId" are required')
      await db.prepare('UPDATE inventory_items SET equipped = 1, slot = ? WHERE character_id = ? AND item_id = ?').bind(a.slot ?? null, a.characterId, a.itemId).run()
      return ok({ success: true, actionType: 'equip', characterId: a.characterId, itemId: a.itemId, slot: a.slot })
    }
    case 'unequip': {
      if (!a.characterId || !a.itemId) return err('"characterId" and "itemId" are required')
      await db.prepare('UPDATE inventory_items SET equipped = 0, slot = NULL WHERE character_id = ? AND item_id = ?').bind(a.characterId, a.itemId).run()
      return ok({ success: true, actionType: 'unequip', characterId: a.characterId, itemId: a.itemId })
    }
    case 'transfer': {
      if (!a.characterId || !a.itemId || !a.targetCharacterId) return err('"characterId", "itemId", and "targetCharacterId" are required')
      const existing = await db.prepare('SELECT quantity FROM inventory_items WHERE character_id = ? AND item_id = ?').bind(a.characterId, a.itemId).first() as { quantity: number } | null
      if (!existing || existing.quantity < a.quantity) return err('Insufficient quantity to transfer')
      if (existing.quantity <= a.quantity) {
        await db.prepare('DELETE FROM inventory_items WHERE character_id = ? AND item_id = ?').bind(a.characterId, a.itemId).run()
      } else {
        await db.prepare('UPDATE inventory_items SET quantity = quantity - ? WHERE character_id = ? AND item_id = ?').bind(a.quantity, a.characterId, a.itemId).run()
      }
      const dest = await db.prepare('SELECT quantity FROM inventory_items WHERE character_id = ? AND item_id = ?').bind(a.targetCharacterId, a.itemId).first() as { quantity: number } | null
      if (dest) {
        await db.prepare('UPDATE inventory_items SET quantity = quantity + ? WHERE character_id = ? AND item_id = ?').bind(a.quantity, a.targetCharacterId, a.itemId).run()
      } else {
        await db.prepare('INSERT INTO inventory_items (character_id, item_id, quantity, equipped) VALUES (?, ?, ?, 0)').bind(a.targetCharacterId, a.itemId, a.quantity).run()
      }
      return ok({ success: true, actionType: 'transfer', fromCharacterId: a.characterId, toCharacterId: a.targetCharacterId, itemId: a.itemId, quantity: a.quantity })
    }
  }
}
