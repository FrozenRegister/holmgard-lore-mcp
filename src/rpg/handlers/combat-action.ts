// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/combat-action.ts

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['attack', 'apply_damage', 'heal', 'apply_condition', 'remove_condition', 'use_ability', 'get_log', 'get_turn_summary'] as const
type CombatActionType = typeof ACTIONS[number]
const ALIASES: Record<string, CombatActionType> = {
  hit: 'attack', strike: 'attack', swing: 'attack',
  damage: 'apply_damage', hurt: 'apply_damage', wound: 'apply_damage',
  restore: 'heal', cure: 'heal', recover: 'heal',
  condition: 'apply_condition', add_condition: 'apply_condition', afflict: 'apply_condition',
  cure_condition: 'remove_condition', end_condition: 'remove_condition',
  ability: 'use_ability', special: 'use_ability', skill: 'use_ability',
  log: 'get_log', history: 'get_log',
  summary: 'get_turn_summary', turn_summary: 'get_turn_summary',
}

const InputSchema = z.object({
  action: z.string(),
  encounterId: z.string().optional(),
  actorId: z.string().optional(),
  actorName: z.string().optional(),
  targetIds: z.array(z.string()).optional(),
  round: z.number().int().min(1).optional().default(1),
  turnIndex: z.number().int().min(0).optional().default(0),
  attackRoll: z.number().int().optional(),
  damage: z.number().int().min(0).optional(),
  damageType: z.string().optional(),
  healAmount: z.number().int().min(0).optional(),
  conditionName: z.string().optional(),
  abilityName: z.string().optional(),
  description: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
})

export async function handleCombatAction(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  async function logAction(actionType: string, summary: string, detail: unknown = null, damageDealt: number | null = null, healingDone: number | null = null, hpChanges: unknown = null) {
    if (!a.encounterId) return
    await db.prepare('INSERT INTO combat_action_log (encounter_id, round, turn_index, actor_id, actor_name, action_type, target_ids, result_summary, result_detail, damage_dealt, healing_done, hp_changes, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(a.encounterId, a.round, a.turnIndex, a.actorId ?? 'unknown', a.actorName ?? 'Unknown', actionType, a.targetIds ? JSON.stringify(a.targetIds) : null, summary, detail ? JSON.stringify(detail) : null, damageDealt, healingDone, hpChanges ? JSON.stringify(hpChanges) : null, now).run()
  }

  switch (match.matched) {
    case 'attack': {
      if (!a.actorId || !a.targetIds?.length) return err('"actorId" and "targetIds" are required')
      const hit = a.attackRoll !== undefined ? a.attackRoll >= 10 : Math.random() > 0.5
      const damage = hit ? (a.damage ?? Math.floor(Math.random() * 8) + 1) : 0
      const summary = hit ? `${a.actorName ?? a.actorId} hit for ${damage} ${a.damageType ?? 'damage'}` : `${a.actorName ?? a.actorId} missed`
      await logAction('attack', summary, { hit, attackRoll: a.attackRoll }, hit ? damage : null, null, null)
      return ok({ success: true, actionType: 'attack', hit, damage, damageType: a.damageType, summary })
    }
    case 'apply_damage': {
      if (!a.targetIds?.length || a.damage === undefined) return err('"targetIds" and "damage" are required')
      const hpChanges: Record<string, number> = {}
      for (const targetId of a.targetIds) {
        const char = await db.prepare('SELECT hp FROM characters WHERE id = ?').bind(targetId).first() as { hp: number } | null
        if (char) {
          const newHp = Math.max(0, char.hp - a.damage)
          await db.prepare('UPDATE characters SET hp = ? WHERE id = ?').bind(newHp, targetId).run()
          hpChanges[targetId] = newHp - char.hp
        }
      }
      const summary = `Applied ${a.damage} ${a.damageType ?? ''} damage to ${a.targetIds.length} target(s)`
      await logAction('damage', summary, null, a.damage, null, hpChanges)
      return ok({ success: true, actionType: 'apply_damage', damage: a.damage, targetIds: a.targetIds, hpChanges })
    }
    case 'heal': {
      if (!a.targetIds?.length || a.healAmount === undefined) return err('"targetIds" and "healAmount" are required')
      const hpChanges: Record<string, number> = {}
      for (const targetId of a.targetIds) {
        const char = await db.prepare('SELECT hp, max_hp FROM characters WHERE id = ?').bind(targetId).first() as { hp: number; max_hp: number } | null
        if (char) {
          const newHp = Math.min(char.max_hp, char.hp + a.healAmount)
          await db.prepare('UPDATE characters SET hp = ? WHERE id = ?').bind(newHp, targetId).run()
          hpChanges[targetId] = newHp - char.hp
        }
      }
      const summary = `Healed ${a.healAmount} HP to ${a.targetIds.length} target(s)`
      await logAction('heal', summary, null, null, a.healAmount, hpChanges)
      return ok({ success: true, actionType: 'heal', healAmount: a.healAmount, targetIds: a.targetIds, hpChanges })
    }
    case 'apply_condition': {
      if (!a.targetIds?.length || !a.conditionName) return err('"targetIds" and "conditionName" are required')
      for (const targetId of a.targetIds) {
        const char = await db.prepare('SELECT conditions FROM characters WHERE id = ?').bind(targetId).first() as { conditions: string } | null
        if (char) {
          const conditions = JSON.parse(char.conditions ?? '[]')
          if (!conditions.includes(a.conditionName)) conditions.push(a.conditionName)
          await db.prepare('UPDATE characters SET conditions = ? WHERE id = ?').bind(JSON.stringify(conditions), targetId).run()
        }
      }
      await logAction('condition', `Applied condition: ${a.conditionName}`)
      return ok({ success: true, actionType: 'apply_condition', conditionName: a.conditionName, targetIds: a.targetIds })
    }
    case 'remove_condition': {
      if (!a.targetIds?.length || !a.conditionName) return err('"targetIds" and "conditionName" are required')
      for (const targetId of a.targetIds) {
        const char = await db.prepare('SELECT conditions FROM characters WHERE id = ?').bind(targetId).first() as { conditions: string } | null
        if (char) {
          const conditions = JSON.parse(char.conditions ?? '[]').filter((c: string) => c !== a.conditionName)
          await db.prepare('UPDATE characters SET conditions = ? WHERE id = ?').bind(JSON.stringify(conditions), targetId).run()
        }
      }
      return ok({ success: true, actionType: 'remove_condition', conditionName: a.conditionName, targetIds: a.targetIds })
    }
    case 'use_ability': {
      if (!a.actorId || !a.abilityName) return err('"actorId" and "abilityName" are required')
      const summary = `${a.actorName ?? a.actorId} used ${a.abilityName}${a.description ? ': ' + a.description : ''}`
      await logAction('ability', summary, { abilityName: a.abilityName })
      return ok({ success: true, actionType: 'use_ability', abilityName: a.abilityName, summary })
    }
    case 'get_log': {
      if (!a.encounterId) return err('"encounterId" is required')
      const { results } = await db.prepare('SELECT * FROM combat_action_log WHERE encounter_id = ? ORDER BY round, turn_index DESC LIMIT ?').bind(a.encounterId, a.limit).all()
      return ok({ success: true, actionType: 'get_log', encounterId: a.encounterId, log: results, count: results.length })
    }
    case 'get_turn_summary': {
      if (!a.encounterId) return err('"encounterId" is required')
      const { results } = await db.prepare('SELECT * FROM combat_action_log WHERE encounter_id = ? AND round = ? ORDER BY turn_index').bind(a.encounterId, a.round).all()
      return ok({ success: true, actionType: 'get_turn_summary', encounterId: a.encounterId, round: a.round, actions: results })
    }
  }
}
