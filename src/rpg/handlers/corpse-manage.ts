// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/corpse-manage.ts

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError, CRUD_ALIASES } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['create', 'get', 'list', 'loot', 'decay', 'generate_loot', 'delete'] as const
type CorpseAction = typeof ACTIONS[number]
const ALIASES: Record<string, CorpseAction> = {
  ...CRUD_ALIASES,
  spawn_corpse: 'create', add_corpse: 'create',
  pillage: 'loot', search: 'loot',
  rot: 'decay', advance_decay: 'decay',
  roll_loot: 'generate_loot', drop_loot: 'generate_loot',
} as Record<string, CorpseAction>

const DECAY_STATES = ['fresh', 'decaying', 'skeletal', 'gone'] as const

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  characterId: z.string().optional(),
  characterName: z.string().optional(),
  characterType: z.string().optional().default('npc'),
  worldId: z.string().optional(),
  encounterId: z.string().optional(),
  positionX: z.number().int().optional(),
  positionY: z.number().int().optional(),
  state: z.enum(DECAY_STATES).optional(),
  lootedBy: z.string().optional(),
  filter: z.enum(['all', 'fresh', 'unlooted']).optional().default('all'),
  worldIdFilter: z.string().optional(),
})

export async function handleCorpseManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'create': {
      if (!a.characterId || !a.characterName) return err('"characterId" and "characterName" are required')
      const id = crypto.randomUUID()
      await db.prepare(`INSERT INTO corpses (id, character_id, character_name, character_type, world_id, encounter_id, position_x, position_y, state, state_updated_at, harvestable_resources, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'fresh', ?, '[]', ?, ?)`)
        .bind(id, a.characterId, a.characterName, a.characterType, a.worldId ?? null, a.encounterId ?? null, a.positionX ?? null, a.positionY ?? null, now, now, now).run()
      return ok({ success: true, actionType: 'create', corpseId: id, characterName: a.characterName, state: 'fresh' })
    }
    case 'get': {
      if (!a.id) return err('"id" is required')
      const row = await db.prepare('SELECT * FROM corpses WHERE id = ?').bind(a.id).first()
      if (!row) return err(`Corpse not found: ${a.id}`)
      const { results: loot } = await db.prepare('SELECT ci.item_id, ci.quantity, ci.looted, i.name FROM corpse_inventory ci JOIN items i ON ci.item_id = i.id WHERE ci.corpse_id = ?').bind(a.id).all()
      return ok({ success: true, actionType: 'get', corpse: { ...row, harvestable_resources: JSON.parse((row as any).harvestable_resources ?? '[]') }, loot })
    }
    case 'list': {
      let query = 'SELECT id, character_name, character_type, state, looted, world_id, encounter_id FROM corpses WHERE 1=1'
      const binds: unknown[] = []
      if (a.worldIdFilter) { query += ' AND world_id = ?'; binds.push(a.worldIdFilter) }
      if (a.filter === 'fresh') { query += " AND state = 'fresh'" }
      if (a.filter === 'unlooted') { query += ' AND looted = 0' }
      const { results } = await db.prepare(query + ' ORDER BY created_at DESC').bind(...binds).all()
      return ok({ success: true, actionType: 'list', corpses: results, count: results.length })
    }
    case 'loot': {
      if (!a.id) return err('"id" is required')
      await db.prepare('UPDATE corpses SET looted = 1, looted_by = ?, looted_at = ?, updated_at = ? WHERE id = ?').bind(a.lootedBy ?? 'unknown', now, now, a.id).run()
      await db.prepare('UPDATE corpse_inventory SET looted = 1 WHERE corpse_id = ?').bind(a.id).run()
      const { results: items } = await db.prepare('SELECT item_id, quantity FROM corpse_inventory WHERE corpse_id = ?').bind(a.id).all()
      return ok({ success: true, actionType: 'loot', corpseId: a.id, itemsLooted: items })
    }
    case 'decay': {
      if (!a.id) return err('"id" is required')
      const row = await db.prepare('SELECT state FROM corpses WHERE id = ?').bind(a.id).first() as { state: string } | null
      if (!row) return err(`Corpse not found: ${a.id}`)
      const idx = DECAY_STATES.indexOf(row.state as typeof DECAY_STATES[number])
      const nextState = idx < DECAY_STATES.length - 1 ? DECAY_STATES[idx + 1] : 'gone'
      await db.prepare('UPDATE corpses SET state = ?, state_updated_at = ?, updated_at = ? WHERE id = ?').bind(nextState, now, now, a.id).run()
      return ok({ success: true, actionType: 'decay', corpseId: a.id, previousState: row.state, newState: nextState })
    }
    case 'generate_loot': {
      if (!a.id) return err('"id" is required')
      await db.prepare('UPDATE corpses SET loot_generated = 1, updated_at = ? WHERE id = ?').bind(now, a.id).run()
      return ok({ success: true, actionType: 'generate_loot', corpseId: a.id, note: 'Loot generation is handled by combat logic. Mark corpse inventory items manually.' })
    }
    case 'delete': {
      if (!a.id) return err('"id" is required')
      await db.prepare('DELETE FROM corpses WHERE id = ?').bind(a.id).run()
      return ok({ success: true, actionType: 'delete', id: a.id })
    }
  }
}
