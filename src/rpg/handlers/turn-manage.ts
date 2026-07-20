// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/turn-manage.ts
// turn_state schema: world_id, current_turn, turn_phase, phase_started_at, nations_ready, created_at, updated_at
// (no total_turns, party_ids, pending_actions, ready_flags columns — using nations_ready JSON + event_logs)

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

export const ACTIONS = ['init', 'get_status', 'submit_actions', 'mark_ready', 'poll_results'] as const
type TurnAction = typeof ACTIONS[number]
const ALIASES: Record<string, TurnAction> = {
  initialize: 'init', setup: 'init', start: 'init', create: 'init',
  status: 'get_status', state: 'get_status', check: 'get_status',
  submit: 'submit_actions', action: 'submit_actions', post_actions: 'submit_actions',
  ready: 'mark_ready', confirm: 'mark_ready', done: 'mark_ready',
  poll: 'poll_results', results: 'poll_results', get_results: 'poll_results',
}

const InputSchema = z.object({
  action: z.string(),
  worldId: z.string().optional(),
  nationId: z.string().optional(),
  partyId: z.string().optional(),
  actions: z.array(z.object({
    type: z.string(),
    targetId: z.string().optional(),
    description: z.string().optional(),
  })).optional().default([]),
})

export async function handleTurnManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'init': {
      if (!a.worldId) return err('"worldId" is required')
      const existing = await db.prepare('SELECT world_id FROM turn_state WHERE world_id = ?').bind(a.worldId).first()
      if (existing) return err(`Turn state already initialized for world ${a.worldId}. Use get_status to check current state.`)
      await db.prepare("INSERT INTO turn_state (world_id, current_turn, turn_phase, phase_started_at, nations_ready, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(a.worldId, 1, 'planning', now, '[]', now, now).run()
      return ok({ success: true, actionType: 'init', worldId: a.worldId, currentTurn: 1, turnPhase: 'planning' })
    }
    case 'get_status': {
      if (!a.worldId) return err('"worldId" is required')
      const ts = await db.prepare('SELECT * FROM turn_state WHERE world_id = ?').bind(a.worldId).first() as Record<string, unknown> | null
      if (!ts) return err(`No turn state for world ${a.worldId}. Call init first.`)
      return ok({ success: true, actionType: 'get_status', worldId: a.worldId, currentTurn: ts.current_turn, turnPhase: ts.turn_phase, phaseStartedAt: ts.phase_started_at, nationsReady: JSON.parse(ts.nations_ready as string ?? '[]') })
    }
    case 'submit_actions': {
      if (!a.worldId) return err('"worldId" is required')
      const entityId = a.nationId ?? a.partyId
      if (!entityId) return err('"nationId" or "partyId" is required')
      const ts = await db.prepare('SELECT current_turn FROM turn_state WHERE world_id = ?').bind(a.worldId).first() as { current_turn: number } | null
      if (!ts) return err(`No turn state for world ${a.worldId}.`)
      await db.prepare('INSERT INTO event_logs (type, payload, timestamp) VALUES (?, ?, ?)').bind('turn_action_submitted', JSON.stringify({ worldId: a.worldId, turn: ts.current_turn, entityId, actions: a.actions }), now).run()
      return ok({ success: true, actionType: 'submit_actions', worldId: a.worldId, entityId, actionCount: a.actions.length, turn: ts.current_turn })
    }
    case 'mark_ready': {
      if (!a.worldId) return err('"worldId" is required')
      const entityId = a.nationId ?? a.partyId
      if (!entityId) return err('"nationId" or "partyId" is required')
      const ts = await db.prepare('SELECT nations_ready FROM turn_state WHERE world_id = ?').bind(a.worldId).first() as { nations_ready: string } | null
      if (!ts) return err(`No turn state for world ${a.worldId}.`)
      const ready = JSON.parse(ts.nations_ready ?? '[]') as string[]
      if (!ready.includes(entityId)) ready.push(entityId)
      await db.prepare('UPDATE turn_state SET nations_ready = ?, updated_at = ? WHERE world_id = ?').bind(JSON.stringify(ready), now, a.worldId).run()
      return ok({ success: true, actionType: 'mark_ready', worldId: a.worldId, entityId, nationsReady: ready, readyCount: ready.length })
    }
    case 'poll_results': {
      if (!a.worldId) return err('"worldId" is required')
      const ts = await db.prepare('SELECT * FROM turn_state WHERE world_id = ?').bind(a.worldId).first() as Record<string, unknown> | null
      if (!ts) return err(`No turn state for world ${a.worldId}.`)
      const { results: recentEvents } = await db.prepare("SELECT * FROM event_logs WHERE type = 'turn_action_submitted' AND json_extract(payload, '$.worldId') = ? ORDER BY timestamp DESC LIMIT 20").bind(a.worldId).all()
      return ok({ success: true, actionType: 'poll_results', worldId: a.worldId, currentTurn: ts.current_turn, turnPhase: ts.turn_phase, nationsReady: JSON.parse(ts.nations_ready as string ?? '[]'), submittedActions: recentEvents })
    }
  }
}
