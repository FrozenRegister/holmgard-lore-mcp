// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/perception-manage.ts
// Uses perception_assessments table (schema: id, seq, prev_seq, event_hash, intent_id,
// observer_id, target_ref_kind, target_ref_id, hazards, applicable_controls, blind_spots,
// disposition, reject_reason, cost_paid, capacity_remaining_after, created_at).

import { z } from 'zod'
import { randomUUID } from 'crypto'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['assess', 'get_history', 'get_latest', 'list_observers'] as const
type PerceptionAction = typeof ACTIONS[number]
const ALIASES: Record<string, PerceptionAction> = {
  check: 'assess', perceive: 'assess', observe: 'assess', inspect: 'assess', roll: 'assess',
  history: 'get_history', past: 'get_history',
  latest: 'get_latest', current: 'get_latest', last: 'get_latest',
  observers: 'list_observers', watchers: 'list_observers',
}

const InputSchema = z.object({
  action: z.string(),
  observerId: z.string().optional(),
  targetId: z.string().optional(),
  targetKind: z.enum(['room', 'encounter', 'scene']).optional().default('room'),
  rollValue: z.number().int().min(1).max(30).optional(),
  dc: z.number().int().min(1).max(30).optional().default(12),
  perceptionType: z.enum(['sight', 'hearing', 'smell', 'arcana', 'investigation', 'insight']).optional().default('sight'),
  limit: z.number().int().min(1).max(50).optional().default(20),
})

const PERCEPTION_DESCRIPTIONS: Record<string, Record<string, string>> = {
  sight:         { success: 'You spot details others might miss.', failure: 'Nothing unusual catches your eye.', crit: 'Your sharp eyes reveal hidden secrets.' },
  hearing:       { success: 'You hear sounds that others cannot detect.', failure: 'The area seems quiet.', crit: 'You make out every whisper in the vicinity.' },
  investigation: { success: 'A thorough search reveals something of interest.', failure: 'You find nothing unusual.', crit: 'Your methodical search uncovers hidden clues.' },
  insight:       { success: 'You sense something beneath the surface.', failure: 'You cannot glean their true intentions.', crit: 'Their secrets are laid bare to you.' },
  arcana:        { success: 'You sense magical emanations.', failure: 'No obvious magical signatures detected.', crit: 'The weave of magic reveals itself to you in full.' },
  smell:         { success: 'A distinct scent catches your attention.', failure: 'Nothing unusual reaches your nose.', crit: 'Your senses paint a complete olfactory picture.' },
}

export async function handlePerceptionManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'assess': {
      if (!a.observerId || !a.targetId) return err('"observerId" and "targetId" are required')
      const roll = a.rollValue ?? Math.floor(Math.random() * 20) + 1
      const succeeded = roll >= a.dc
      const isCrit = roll === 20
      const descs = PERCEPTION_DESCRIPTIONS[a.perceptionType] ?? PERCEPTION_DESCRIPTIONS.sight
      const description = isCrit ? descs.crit : (succeeded ? descs.success : descs.failure)
      const disposition = succeeded ? 'commit' : 'reject_inert'
      const seqRow = await db.prepare('SELECT MAX(seq) as max_seq FROM perception_assessments WHERE observer_id = ?').bind(a.observerId).first() as { max_seq: number | null }
      const seq = (seqRow?.max_seq ?? 0) + 1
      const id = randomUUID()
      const hazards = succeeded ? [] : [{ type: 'perception_failure', description: `DC ${a.dc} not met (rolled ${roll})` }]
      await db.prepare('INSERT INTO perception_assessments (id, seq, prev_seq, event_hash, intent_id, observer_id, target_ref_kind, target_ref_id, hazards, applicable_controls, blind_spots, disposition, reject_reason, cost_paid, capacity_remaining_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, seq, seq - 1 || null, randomUUID(), a.perceptionType, a.observerId, a.targetKind, a.targetId, JSON.stringify(hazards), JSON.stringify([a.perceptionType]), '[]', disposition, succeeded ? null : description, 1, 99, now).run()
      return ok({ success: true, actionType: 'assess', assessmentId: id, observerId: a.observerId, targetId: a.targetId, targetKind: a.targetKind, perceptionType: a.perceptionType, roll, dc: a.dc, succeeded, isCrit, description, disposition })
    }
    case 'get_history': {
      if (!a.observerId) return err('"observerId" is required')
      const { results } = await db.prepare('SELECT * FROM perception_assessments WHERE observer_id = ? ORDER BY seq DESC LIMIT ?').bind(a.observerId, a.limit).all()
      return ok({ success: true, actionType: 'get_history', observerId: a.observerId, assessments: results, count: results.length })
    }
    case 'get_latest': {
      if (!a.observerId) return err('"observerId" is required')
      let query = 'SELECT * FROM perception_assessments WHERE observer_id = ?'
      const binds: unknown[] = [a.observerId]
      if (a.targetId) { query += ' AND target_ref_id = ?'; binds.push(a.targetId) }
      const row = await db.prepare(query + ' ORDER BY seq DESC LIMIT 1').bind(...binds).first()
      if (!row) return err(`No perception assessments found for observer ${a.observerId}`)
      return ok({ success: true, actionType: 'get_latest', assessment: row })
    }
    case 'list_observers': {
      if (!a.targetId) return err('"targetId" is required')
      const { results } = await db.prepare('SELECT DISTINCT observer_id, MAX(seq) as latest_seq, MAX(created_at) as last_checked FROM perception_assessments WHERE target_ref_id = ? GROUP BY observer_id ORDER BY last_checked DESC LIMIT ?').bind(a.targetId, a.limit).all()
      return ok({ success: true, actionType: 'list_observers', targetId: a.targetId, observers: results, count: results.length })
    }
  }
}
