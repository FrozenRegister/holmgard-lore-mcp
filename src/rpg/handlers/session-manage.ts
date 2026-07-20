// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/session-manage.ts

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

export const ACTIONS = ['initialize', 'get_context'] as const
type SessionAction = typeof ACTIONS[number]
const ALIASES: Record<string, SessionAction> = {
  init: 'initialize', start: 'initialize', setup: 'initialize', initialize_session: 'initialize', start_session: 'initialize',
  context: 'get_context', narrative: 'get_context', narrative_context: 'get_context', get_narrative: 'get_context', summary: 'get_context',
}

const InputSchema = z.object({
  action: z.string(),
  worldId: z.string().optional(),
  partyId: z.string().optional(),
  createNew: z.boolean().optional().default(false),
  worldName: z.string().optional(),
  partyName: z.string().optional(),
  includeParty: z.boolean().optional().default(true),
  includeQuests: z.boolean().optional().default(true),
  includeWorld: z.boolean().optional().default(true),
  includeNarrative: z.boolean().optional().default(true),
  includeCombat: z.boolean().optional().default(true),
  narrativeLimit: z.number().int().min(1).max(50).optional().default(10),
})

export async function handleSessionManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'initialize': {
      let worldId = a.worldId
      let partyId = a.partyId
      const created: { world?: boolean; party?: boolean } = {}

      if (!worldId && a.createNew) {
        worldId = crypto.randomUUID()
        await db.prepare('INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(worldId, a.worldName ?? 'New World', crypto.randomUUID().slice(0, 8), 100, 100, now, now).run()
        created.world = true
      } else if (!worldId) {
        const w = await db.prepare('SELECT id FROM worlds ORDER BY created_at DESC LIMIT 1').first() as { id: string } | null
        worldId = w?.id
      }

      if (!partyId && a.createNew) {
        partyId = crypto.randomUUID()
        await db.prepare('INSERT INTO parties (id, name, status, formation, world_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(partyId, a.partyName ?? 'Adventuring Party', 'active', 'standard', worldId ?? null, now, now).run()
        created.party = true
      } else if (!partyId) {
        const p = await db.prepare('SELECT id FROM parties WHERE status = ? ORDER BY created_at DESC LIMIT 1').bind('active').first() as { id: string } | null
        partyId = p?.id
      }

      const [world, party] = await Promise.all([
        worldId ? db.prepare('SELECT id, name FROM worlds WHERE id = ?').bind(worldId).first() : null,
        partyId ? db.prepare('SELECT id, name FROM parties WHERE id = ?').bind(partyId).first() : null,
      ])

      let members: unknown[] = []
      if (partyId) {
        const res = await db.prepare('SELECT c.id, c.name, c.character_class, c.level, c.hp, c.max_hp, pm.role FROM party_members pm JOIN characters c ON pm.character_id = c.id WHERE pm.party_id = ?').bind(partyId).all()
        members = res.results
      }

      return ok({ success: true, actionType: 'initialize', worldId, worldName: (world as any)?.name, partyId, partyName: (party as any)?.name, partyMembers: members, created })
    }

    case 'get_context': {
      const context: Record<string, unknown> = {}

      if (a.includeParty && a.partyId) {
        const party = await db.prepare('SELECT id, name FROM parties WHERE id = ?').bind(a.partyId).first()
        if (party) {
          const { results: members } = await db.prepare('SELECT c.id, c.name, c.level, c.hp, c.max_hp, c.ac, pm.role FROM party_members pm JOIN characters c ON pm.character_id = c.id WHERE pm.party_id = ?').bind(a.partyId).all()
          context.party = { ...(party as Record<string, unknown>), members }
        }
      }

      if (a.includeQuests && a.worldId) {
        const { results } = await db.prepare("SELECT id, name, status FROM quests WHERE world_id = ? AND status IN ('active', 'in_progress') ORDER BY created_at DESC LIMIT 10").bind(a.worldId).all()
        context.quests = results
      }

      if (a.includeWorld && a.worldId) {
        const world = await db.prepare('SELECT id, name FROM worlds WHERE id = ?').bind(a.worldId).first()
        context.world = world
      }

      if (a.includeNarrative && a.worldId) {
        const { results } = await db.prepare("SELECT id, type, content, created_at FROM narrative_notes WHERE world_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT ?").bind(a.worldId, a.narrativeLimit).all()
        context.narrative = results
      }

      if (a.includeCombat) {
        const enc = await db.prepare("SELECT id, round, status FROM encounters WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1").first()
        if (enc) context.activeCombat = enc
      }

      return ok({ success: true, actionType: 'get_context', ...context })
    }
  }
}
