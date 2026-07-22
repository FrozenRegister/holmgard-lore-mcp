// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/quest-manage.ts

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError, CRUD_ALIASES } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'
import { applyDynamicFields } from '../utils/dynamic-fields'

// #425 — id/created_at/updated_at are always protected from the `fields`
// passthrough; world_id ownership changes go through their own workflow, not
// a generic backfill. (rewards/prerequisites were already declared in this
// handler's own Zod schema but never wired into the update case — fixed
// directly below, not via fields, since they're first-class params.)
const QUEST_FIELDS_BLACKLIST = ['id', 'created_at', 'updated_at', 'world_id'] as const

export const ACTIONS = [
  'create',
  'get',
  'list',
  'update',
  'delete',
  'complete',
  'fail',
  'add_objective',
  'complete_objective',
] as const
type QuestAction = (typeof ACTIONS)[number]
const ALIASES: Record<string, QuestAction> = {
  ...CRUD_ALIASES,
  finish: 'complete',
  done: 'complete',
  abandon: 'fail',
  failed: 'fail',
  objective: 'add_objective',
  tick_objective: 'complete_objective',
  check_objective: 'complete_objective',
} as Record<string, QuestAction>

// #345 — objective object schema surfaced in error messages.
// Fields: description (string, required), completed (boolean, default false),
// order (integer, optional). Pass a plain string as shorthand for { description: "..." }.
const ObjectiveSchema = z.object({
  description: z.string(),
  completed: z.boolean().default(false),
  order: z.number().int().optional(),
})

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  questId: z.string().optional(),
  worldId: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['active', 'completed', 'failed', 'inactive']).optional(),
  objectives: z.array(ObjectiveSchema).optional(),
  rewards: z.record(z.unknown()).optional(),
  prerequisites: z.array(z.string()).optional(),
  giver: z.string().optional(),
  objectiveIndex: z.number().int().min(0).optional(),
  objective: ObjectiveSchema.optional(),
  filter: z.enum(['active', 'completed', 'failed', 'all']).optional().default('all'),
  // #425 — arbitrary D1 column passthrough, valid on `update` only.
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
})

export async function handleQuestManage(
  env: AppBindings,
  args: Record<string, unknown>,
): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map((i) => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'create': {
      if (!a.name || !a.worldId) return err('"name" and "worldId" are required')
      const id = crypto.randomUUID()
      await db
        .prepare(
          'INSERT INTO quests (id, world_id, name, description, status, objectives, rewards, prerequisites, giver, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          id,
          a.worldId,
          a.name,
          a.description ?? '',
          'active',
          JSON.stringify(a.objectives ?? []),
          JSON.stringify(a.rewards ?? {}),
          JSON.stringify(a.prerequisites ?? []),
          a.giver ?? null,
          now,
          now,
        )
        .run()
      return ok({ success: true, actionType: 'create', questId: id, name: a.name })
    }
    case 'get': {
      const qId = a.id ?? a.questId
      if (!qId) return err('"id" or "questId" is required')
      const row = await db.prepare('SELECT * FROM quests WHERE id = ?').bind(qId).first()
      if (!row) return err(`Quest not found: ${qId}`)
      return ok({
        success: true,
        actionType: 'get',
        quest: {
          ...row,
          objectives: JSON.parse(row.objectives as string),
          rewards: JSON.parse(row.rewards as string),
          prerequisites: JSON.parse(row.prerequisites as string),
        },
      })
    }
    case 'list': {
      let query = 'SELECT id, name, status, giver, created_at FROM quests WHERE world_id = ?'
      const binds: unknown[] = [a.worldId ?? '']
      if (a.filter && a.filter !== 'all') {
        query += ' AND status = ?'
        binds.push(a.filter)
      }
      const { results } = await db
        .prepare(query + ' ORDER BY created_at DESC')
        .bind(...binds)
        .all()
      return ok({ success: true, actionType: 'list', quests: results, count: results.length })
    }
    case 'update': {
      const qId = a.id ?? a.questId
      if (!qId) return err('"id" or "questId" is required')
      const sets: string[] = ['updated_at = ?']
      const vals: unknown[] = [now]
      if (a.name) {
        sets.push('name = ?')
        vals.push(a.name)
      }
      if (a.description !== undefined) {
        sets.push('description = ?')
        vals.push(a.description)
      }
      if (a.status) {
        sets.push('status = ?')
        vals.push(a.status)
      }
      if (a.objectives) {
        sets.push('objectives = ?')
        vals.push(JSON.stringify(a.objectives))
      }
      // #425 — rewards/prerequisites were already declared in InputSchema but
      // never wired into this case; fixed alongside the general fields gap.
      if (a.rewards) {
        sets.push('rewards = ?')
        vals.push(JSON.stringify(a.rewards))
      }
      if (a.prerequisites) {
        sets.push('prerequisites = ?')
        vals.push(JSON.stringify(a.prerequisites))
      }
      if (a.giver) {
        sets.push('giver = ?')
        vals.push(a.giver)
      }
      const { applied: fieldsApplied, rejected: fieldsRejected } = applyDynamicFields(
        a.fields,
        QUEST_FIELDS_BLACKLIST,
        sets,
        vals,
      )
      vals.push(qId)
      await db
        .prepare(`UPDATE quests SET ${sets.join(', ')} WHERE id = ?`)
        .bind(...vals)
        .run()
      return ok({
        success: true,
        actionType: 'update',
        questId: qId,
        ...(a.fields ? { fields_applied: fieldsApplied, fields_rejected: fieldsRejected } : {}),
      })
    }
    case 'delete': {
      const qId = a.id ?? a.questId
      if (!qId) return err('"id" or "questId" is required')
      await db.prepare('DELETE FROM quests WHERE id = ?').bind(qId).run()
      return ok({ success: true, actionType: 'delete', questId: qId })
    }
    case 'complete': {
      const qId = a.id ?? a.questId
      if (!qId) return err('"id" or "questId" is required')
      await db
        .prepare("UPDATE quests SET status = 'completed', updated_at = ? WHERE id = ?")
        .bind(now, qId)
        .run()
      return ok({ success: true, actionType: 'complete', questId: qId, status: 'completed' })
    }
    case 'fail': {
      const qId = a.id ?? a.questId
      if (!qId) return err('"id" or "questId" is required')
      await db
        .prepare("UPDATE quests SET status = 'failed', updated_at = ? WHERE id = ?")
        .bind(now, qId)
        .run()
      return ok({ success: true, actionType: 'fail', questId: qId, status: 'failed' })
    }
    case 'add_objective': {
      const qId = a.id ?? a.questId
      if (!qId) return err('"id" or "questId" is required')
      if (!a.objective)
        return err(
          '"objective" is required. Expected an object with fields: description (string, required), completed (boolean, optional, default false), order (integer, optional). Example: { description: "Locate the spring", completed: false }',
        )
      if (typeof a.objective === 'string')
        return err(
          '"objective" must be an object, not a string. Use: { description: "' +
            a.objective +
            '", completed: false }',
        )
      const row = (await db
        .prepare('SELECT objectives FROM quests WHERE id = ?')
        .bind(qId)
        .first()) as { objectives: string } | null
      if (!row) return err(`Quest not found: ${qId}`)
      const objectives = JSON.parse(row.objectives)
      objectives.push(a.objective)
      await db
        .prepare('UPDATE quests SET objectives = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(objectives), now, qId)
        .run()
      return ok({
        success: true,
        actionType: 'add_objective',
        questId: qId,
        objectiveCount: objectives.length,
      })
    }
    case 'complete_objective': {
      const qId = a.id ?? a.questId
      if (!qId || a.objectiveIndex === undefined)
        return err('"id"/"questId" and "objectiveIndex" are required')
      const row = (await db
        .prepare('SELECT objectives FROM quests WHERE id = ?')
        .bind(qId)
        .first()) as { objectives: string } | null
      if (!row) return err(`Quest not found: ${qId}`)
      const objectives = JSON.parse(row.objectives)
      if (a.objectiveIndex >= objectives.length)
        return err(`Objective index ${a.objectiveIndex} out of range`)
      objectives[a.objectiveIndex].completed = true
      await db
        .prepare('UPDATE quests SET objectives = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(objectives), now, qId)
        .run()
      const allDone = objectives.every((o: { completed: boolean }) => o.completed)
      return ok({
        success: true,
        actionType: 'complete_objective',
        questId: qId,
        objectiveIndex: a.objectiveIndex,
        allObjectivesComplete: allDone,
      })
    }
  }
}
