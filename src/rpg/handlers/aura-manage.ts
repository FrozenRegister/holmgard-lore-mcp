// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/aura-manage.ts

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'
import { executeRoll } from './math-manage'

const ACTIONS = ['create', 'get', 'list', 'remove', 'expire', 'get_affecting', 'concentrate', 'break_concentration', 'check_save', 'check_duration'] as const
type AuraAction = typeof ACTIONS[number]
const ALIASES: Record<string, AuraAction> = {
  add_aura: 'create', cast_aura: 'create',
  fetch: 'get', find: 'get',
  list_active: 'list', active: 'list',
  end_aura: 'remove', dispel: 'remove', cancel: 'remove',
  expire_old: 'expire', cleanup: 'expire',
  affecting: 'get_affecting', on: 'get_affecting',
  start_concentrate: 'concentrate', focus: 'concentrate',
  break: 'break_concentration', lose_concentration: 'break_concentration',
  concentration_check: 'check_save', save_check: 'check_save', constitution_save: 'check_save',
  duration_check: 'check_duration',
}

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  ownerId: z.string().optional(),
  targetId: z.string().optional(),
  spellName: z.string().optional(),
  spellLevel: z.number().int().min(0).max(9).optional().default(1),
  radius: z.number().int().min(1).optional().default(10),
  affectsAllies: z.boolean().optional().default(true),
  affectsEnemies: z.boolean().optional().default(false),
  affectsSelf: z.boolean().optional().default(true),
  effects: z.record(z.unknown()).optional(),
  maxDuration: z.number().int().optional(),
  requiresConcentration: z.boolean().optional().default(false),
  characterId: z.string().optional(),
  saveDcBase: z.number().int().optional().default(10),
  targetIds: z.array(z.string()).optional(),
  damage: z.number().int().min(0).optional(),
  saveRoll: z.number().int().min(1).max(20).optional(),
})

async function breakConcentration(db: D1Database, characterId: string): Promise<void> {
  await db.prepare('DELETE FROM concentration WHERE character_id = ?').bind(characterId).run()
  await db.prepare('DELETE FROM auras WHERE owner_id = ? AND requires_concentration = 1').bind(characterId).run()
}

export async function handleAuraManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = Date.now()

  switch (match.matched) {
    case 'create': {
      if (!a.ownerId || !a.spellName) return err('"ownerId" and "spellName" are required')
      const id = crypto.randomUUID()
      await db.prepare('INSERT INTO auras (id, owner_id, spell_name, spell_level, radius, affects_allies, affects_enemies, affects_self, effects, started_at, max_duration, requires_concentration) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, a.ownerId, a.spellName, a.spellLevel, a.radius, a.affectsAllies ? 1 : 0, a.affectsEnemies ? 1 : 0, a.affectsSelf ? 1 : 0, JSON.stringify(a.effects ?? {}), now, a.maxDuration ?? null, a.requiresConcentration ? 1 : 0).run()
      return ok({ success: true, actionType: 'create', auraId: id, spellName: a.spellName, ownerId: a.ownerId })
    }
    case 'get': {
      if (!a.id) return err('"id" (the aura instance ID returned by create, e.g. "uuid-of-the-aura") is required. Use "list" to find aura IDs for an owner, or pass "ownerId" (character UUID) instead')
      const row = await db.prepare('SELECT * FROM auras WHERE id = ?').bind(a.id).first()
      if (!row) return err(`Aura not found: ${a.id}`)
      return ok({ success: true, actionType: 'get', aura: { ...row, effects: JSON.parse((row as any).effects ?? '{}') } })
    }
    case 'list': {
      const { results } = await db.prepare('SELECT id, owner_id, spell_name, spell_level, radius, started_at FROM auras ORDER BY started_at DESC').all()
      return ok({ success: true, actionType: 'list', auras: results, count: results.length })
    }
    case 'remove': {
      if (!a.id && !a.ownerId) return err('"id" or "ownerId" is required')
      if (a.id) {
        await db.prepare('DELETE FROM auras WHERE id = ?').bind(a.id).run()
        return ok({ success: true, actionType: 'remove', id: a.id })
      }
      await db.prepare('DELETE FROM auras WHERE owner_id = ?').bind(a.ownerId).run()
      return ok({ success: true, actionType: 'remove', ownerId: a.ownerId })
    }
    case 'expire': {
      const result = await db.prepare('DELETE FROM auras WHERE max_duration IS NOT NULL AND started_at + max_duration < ?').bind(now).run()
      return ok({ success: true, actionType: 'expire', expired: result.meta?.changes ?? 0 })
    }
    case 'get_affecting': {
      if (!a.targetId) return err('"targetId" is required')
      const { results } = await db.prepare('SELECT * FROM auras').all()
      return ok({ success: true, actionType: 'get_affecting', targetId: a.targetId, auras: results.map((r: Record<string, unknown>) => ({ ...r, effects: JSON.parse((r as any).effects ?? '{}') })), count: results.length })
    }
    case 'concentrate': {
      if (!a.characterId || !a.spellName) return err('"characterId" and "spellName" are required')
      await db.prepare('INSERT OR REPLACE INTO concentration (character_id, active_spell, spell_level, target_ids, started_at, max_duration, save_dc_base) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(a.characterId, a.spellName, a.spellLevel, JSON.stringify(a.targetIds ?? []), now, a.maxDuration ?? null, a.saveDcBase).run()
      return ok({ success: true, actionType: 'concentrate', characterId: a.characterId, spellName: a.spellName })
    }
    case 'break_concentration': {
      if (!a.characterId) return err('"characterId" is required')
      const conc = await db.prepare('SELECT active_spell FROM concentration WHERE character_id = ?').bind(a.characterId).first()
      if (!conc) return ok({ success: true, actionType: 'break_concentration', characterId: a.characterId, hadConcentration: false })
      await breakConcentration(db, a.characterId)
      return ok({ success: true, actionType: 'break_concentration', characterId: a.characterId, hadConcentration: true, spellEnded: (conc as any).active_spell })
    }
    case 'check_save': {
      if (!a.characterId) return err('"characterId" is required')
      const conc = await db.prepare('SELECT active_spell FROM concentration WHERE character_id = ?').bind(a.characterId).first() as { active_spell: string } | null
      if (!conc) return ok({ success: true, actionType: 'check_save', characterId: a.characterId, wasConcentrating: false })
      if (a.damage === undefined) return err('"damage" is required to compute the concentration save DC')
      const dc = Math.max(10, Math.floor(a.damage / 2))
      // #210 — Use the shared dice engine instead of ad-hoc Math.random().
      const roll = a.saveRoll ?? executeRoll('1d20').total
      const maintained = roll >= dc
      if (!maintained) await breakConcentration(db, a.characterId)
      return ok({ success: true, actionType: 'check_save', characterId: a.characterId, wasConcentrating: true, spellName: conc.active_spell, dc, roll, maintained })
    }
    case 'check_duration': {
      if (!a.characterId) return err('"characterId" is required')
      const conc = await db.prepare('SELECT active_spell, started_at, max_duration FROM concentration WHERE character_id = ?').bind(a.characterId).first() as
        { active_spell: string; started_at: number; max_duration: number | null } | null
      if (!conc) return ok({ success: true, actionType: 'check_duration', characterId: a.characterId, concentrating: false })
      const expired = conc.max_duration !== null && (conc.started_at + conc.max_duration) < now
      if (expired) {
        await breakConcentration(db, a.characterId)
        return ok({ success: true, actionType: 'check_duration', characterId: a.characterId, concentrating: false, expired: true, spellEnded: conc.active_spell })
      }
      return ok({
        success: true, actionType: 'check_duration', characterId: a.characterId, concentrating: true, spellName: conc.active_spell,
        remainingMs: conc.max_duration !== null ? (conc.started_at + conc.max_duration) - now : null,
      })
    }
  }
}
