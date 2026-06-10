// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/party-manage.ts

import { z } from 'zod'
import { randomUUID } from 'crypto'
import { matchAction, isGuidingError, formatGuidingError, CRUD_ALIASES } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['create', 'get', 'list', 'update', 'delete', 'add_member', 'remove_member', 'set_leader'] as const
type PartyAction = typeof ACTIONS[number]
const ALIASES: Record<string, PartyAction> = {
  ...CRUD_ALIASES,
  add_character: 'add_member', join: 'add_member',
  remove_character: 'remove_member', leave: 'remove_member', kick: 'remove_member',
  leader: 'set_leader', promote: 'set_leader',
} as Record<string, PartyAction>

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  worldId: z.string().optional(),
  status: z.enum(['active', 'dormant', 'archived']).optional(),
  partyId: z.string().optional(),
  characterId: z.string().optional(),
  role: z.enum(['leader', 'member', 'companion', 'hireling', 'prisoner', 'mount']).optional().default('member'),
})

export async function handlePartyManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'create': {
      if (!a.name) return err('"name" is required')
      const id = randomUUID()
      await db.prepare('INSERT INTO parties (id, name, description, world_id, status, formation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, a.name, a.description ?? null, a.worldId ?? null, a.status ?? 'active', 'standard', now, now).run()
      return ok({ success: true, actionType: 'create', partyId: id, name: a.name })
    }
    case 'get': {
      const partyId = a.partyId ?? a.id
      if (!partyId) return err('"partyId" or "id" is required')
      const party = await db.prepare('SELECT * FROM parties WHERE id = ?').bind(partyId).first()
      if (!party) return err(`Party not found: ${partyId}`)
      const { results: members } = await db.prepare(`
        SELECT pm.role, pm.is_active, c.id AS character_id, c.name, c.character_class, c.level, c.hp, c.max_hp
        FROM party_members pm JOIN characters c ON pm.character_id = c.id
        WHERE pm.party_id = ? ORDER BY pm.role DESC
      `).bind(partyId).all()
      return ok({ success: true, actionType: 'get', party: { ...party, members } })
    }
    case 'list': {
      const { results } = await db.prepare('SELECT id, name, status, world_id, created_at FROM parties ORDER BY created_at DESC').all()
      return ok({ success: true, actionType: 'list', parties: results, count: results.length })
    }
    case 'update': {
      if (!a.id) return err('"id" is required')
      const sets: string[] = ['updated_at = ?']
      const vals: unknown[] = [now]
      if (a.name) { sets.push('name = ?'); vals.push(a.name) }
      if (a.description) { sets.push('description = ?'); vals.push(a.description) }
      if (a.status) { sets.push('status = ?'); vals.push(a.status) }
      vals.push(a.id)
      await db.prepare(`UPDATE parties SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
      return ok({ success: true, actionType: 'update', id: a.id })
    }
    case 'delete': {
      if (!a.id) return err('"id" is required')
      await db.prepare('DELETE FROM parties WHERE id = ?').bind(a.id).run()
      return ok({ success: true, actionType: 'delete', id: a.id })
    }
    case 'add_member': {
      const partyId = a.partyId ?? a.id
      if (!partyId || !a.characterId) return err('"partyId" and "characterId" are required')
      const memberId = randomUUID()
      await db.prepare('INSERT OR REPLACE INTO party_members (id, party_id, character_id, role, is_active, joined_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(memberId, partyId, a.characterId, a.role, 1, now).run()
      await db.prepare('UPDATE parties SET updated_at = ? WHERE id = ?').bind(now, partyId).run()
      return ok({ success: true, actionType: 'add_member', partyId, characterId: a.characterId, role: a.role })
    }
    case 'remove_member': {
      const partyId = a.partyId ?? a.id
      if (!partyId || !a.characterId) return err('"partyId" and "characterId" are required')
      await db.prepare('DELETE FROM party_members WHERE party_id = ? AND character_id = ?').bind(partyId, a.characterId).run()
      return ok({ success: true, actionType: 'remove_member', partyId, characterId: a.characterId })
    }
    case 'set_leader': {
      const partyId = a.partyId ?? a.id
      if (!partyId || !a.characterId) return err('"partyId" and "characterId" are required')
      await db.prepare("UPDATE party_members SET role = 'member' WHERE party_id = ?").bind(partyId).run()
      await db.prepare("UPDATE party_members SET role = 'leader' WHERE party_id = ? AND character_id = ?").bind(partyId, a.characterId).run()
      return ok({ success: true, actionType: 'set_leader', partyId, leaderId: a.characterId })
    }
  }
}
