// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/improvisation-manage.ts

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['apply', 'get', 'list', 'remove', 'tick', 'list_by_target'] as const
type ImprovAction = typeof ACTIONS[number]
const ALIASES: Record<string, ImprovAction> = {
  create: 'apply', add_effect: 'apply', improvise: 'apply',
  fetch: 'get', find: 'get',
  all: 'list', active: 'list',
  delete: 'remove', end: 'remove', dispel: 'remove',
  advance: 'tick', round: 'tick', next_round: 'tick',
  for: 'list_by_target', on: 'list_by_target', affecting: 'list_by_target',
}

const DurationTypeEnum = z.enum(['rounds', 'minutes', 'hours', 'days', 'permanent', 'until_removed'])
const CategoryEnum = z.enum(['boon', 'curse', 'neutral', 'transformative'])
const SourceTypeEnum = z.enum(['divine', 'arcane', 'natural', 'cursed', 'psionic', 'unknown'])

const InputSchema = z.object({
  action: z.string(),
  id: z.number().int().optional(),
  targetId: z.string().optional(),
  targetType: z.enum(['character', 'npc']).optional().default('character'),
  name: z.string().optional(),
  description: z.string().optional(),
  sourceType: SourceTypeEnum.optional().default('unknown'),
  sourceEntityId: z.string().optional(),
  sourceEntityName: z.string().optional(),
  category: CategoryEnum.optional().default('neutral'),
  powerLevel: z.number().int().min(1).max(5).optional().default(1),
  mechanics: z.array(z.string()).optional(),
  durationType: DurationTypeEnum.optional().default('rounds'),
  durationValue: z.number().int().optional(),
  triggers: z.array(z.string()).optional(),
  removalConditions: z.array(z.string()).optional(),
  stackable: z.boolean().optional().default(false),
  rounds: z.number().int().min(1).optional().default(1),
})

export async function handleImprovisationManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'apply': {
      if (!a.targetId || !a.name) return err('"targetId" and "name" are required')
      const result = await db.prepare(`INSERT INTO custom_effects (target_id, target_type, name, description, source_type, source_entity_id, source_entity_name, category, power_level, mechanics, duration_type, duration_value, rounds_remaining, triggers, removal_conditions, stackable, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(a.targetId, a.targetType, a.name, a.description ?? null, a.sourceType, a.sourceEntityId ?? null, a.sourceEntityName ?? null, a.category, a.powerLevel, JSON.stringify(a.mechanics ?? []), a.durationType, a.durationValue ?? null, a.durationType === 'rounds' ? (a.durationValue ?? null) : null, JSON.stringify(a.triggers ?? []), JSON.stringify(a.removalConditions ?? []), a.stackable ? 1 : 0, now).run()
      return ok({ success: true, actionType: 'apply', effectId: result.meta?.last_row_id, targetId: a.targetId, name: a.name, category: a.category })
    }
    case 'get': {
      if (!a.id) return err('"id" is required')
      const row = await db.prepare('SELECT * FROM custom_effects WHERE id = ?').bind(a.id).first()
      if (!row) return err(`Effect not found: ${a.id}`)
      return ok({ success: true, actionType: 'get', effect: { ...row, mechanics: JSON.parse((row as any).mechanics ?? '[]'), triggers: JSON.parse((row as any).triggers ?? '[]'), removal_conditions: JSON.parse((row as any).removal_conditions ?? '[]') } })
    }
    case 'list': {
      const { results } = await db.prepare('SELECT id, target_id, name, category, power_level, duration_type, rounds_remaining, is_active FROM custom_effects WHERE is_active = 1 ORDER BY created_at DESC').all()
      return ok({ success: true, actionType: 'list', effects: results, count: results.length })
    }
    case 'remove': {
      if (!a.id) return err('"id" is required')
      await db.prepare('UPDATE custom_effects SET is_active = 0 WHERE id = ?').bind(a.id).run()
      return ok({ success: true, actionType: 'remove', id: a.id })
    }
    case 'tick': {
      await db.prepare("UPDATE custom_effects SET rounds_remaining = rounds_remaining - ? WHERE duration_type = 'rounds' AND rounds_remaining IS NOT NULL AND is_active = 1").bind(a.rounds).run()
      const expired = await db.prepare("UPDATE custom_effects SET is_active = 0 WHERE duration_type = 'rounds' AND rounds_remaining <= 0 AND is_active = 1").run()
      return ok({ success: true, actionType: 'tick', roundsAdvanced: a.rounds, expired: expired.meta?.changes ?? 0 })
    }
    case 'list_by_target': {
      if (!a.targetId) return err('"targetId" is required')
      const { results } = await db.prepare('SELECT id, name, category, power_level, duration_type, rounds_remaining, is_active FROM custom_effects WHERE target_id = ? ORDER BY is_active DESC, created_at DESC').bind(a.targetId).all()
      return ok({ success: true, actionType: 'list_by_target', targetId: a.targetId, effects: results, count: results.length })
    }
  }
}
