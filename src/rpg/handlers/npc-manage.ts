// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/npc-manage.ts
// agent_manage integration deferred to Phase 4.

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError, CRUD_ALIASES } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['create', 'list', 'get', 'update', 'get_full_context', 'get_relationship', 'update_relationship', 'record_memory', 'get_history', 'get_recent', 'get_context', 'interact', 'assign_to_location'] as const
type NpcAction = typeof ACTIONS[number]
const ALIASES: Record<string, NpcAction> = {
  ...CRUD_ALIASES,
  new_npc: 'create', spawn_npc: 'create',
  context: 'get_context', full: 'get_full_context',
  relationship: 'get_relationship', relation: 'get_relationship',
  update_rel: 'update_relationship', set_relationship: 'update_relationship',
  memory: 'record_memory', remember: 'record_memory',
  history: 'get_history', conversations: 'get_history',
  recent: 'get_recent', recent_interactions: 'get_recent',
  talk: 'interact', speak: 'interact',
  all_npcs: 'list', browse_npcs: 'list',
  place: 'assign_to_location', relocate: 'assign_to_location', move: 'assign_to_location',
} as Record<string, NpcAction>

const StatsSchema = z.object({ str: z.number().default(10), dex: z.number().default(10), con: z.number().default(10), int: z.number().default(10), wis: z.number().default(10), cha: z.number().default(10) })

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  worldId: z.string().optional(),
  name: z.string().optional(),
  class: z.string().optional().default('Commoner'),
  race: z.string().optional().default('Human'),
  background: z.string().optional().default('Folk Hero'),
  alignment: z.string().optional(),
  stats: StatsSchema.optional(),
  hp: z.number().int().min(1).optional(),
  maxHp: z.number().int().min(1).optional(),
  ac: z.number().int().optional().default(10),
  level: z.number().int().min(1).max(20).optional().default(1),
  factionId: z.string().optional(),
  characterId: z.string().optional(),
  npcId: z.string().optional(),
  familiarity: z.enum(['stranger', 'acquaintance', 'friend', 'close_friend', 'rival', 'enemy']).optional().default('stranger'),
  disposition: z.enum(['hostile', 'unfriendly', 'neutral', 'friendly', 'helpful']).optional().default('neutral'),
  notes: z.string().optional(),
  summary: z.string().optional(),
  importance: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
  topics: z.array(z.string()).optional(),
  context: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional().default(10),
  locationKey: z.string().optional(),
  hexQ: z.number().int().optional(),
  hexR: z.number().int().optional(),
})

export async function handleNpcManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
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
      const id = crypto.randomUUID()
      const stats = a.stats ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }
      const maxHp = a.maxHp ?? Math.max(1, (a.level) * 4)
      const hp = a.hp ?? maxHp
      await db.prepare(`INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, faction_id, character_type, character_class, race, background, alignment, conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells, cantrips_known, currency, resource_pools, xp, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'npc', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, a.name, JSON.stringify(stats), hp, maxHp, a.ac, a.level, a.factionId ?? null, a.class, a.race, a.background ?? null, a.alignment ?? null, '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{"gold":0,"silver":0,"copper":0}', '{}', 0, now, now).run()
      return ok({ success: true, actionType: 'create', characterId: id, name: a.name, characterType: 'npc', note: 'Agent integration deferred to Phase 4.' })
    }
    case 'list': {
      const worldId = a.worldId ?? a.id
      let query = 'SELECT id, name, character_class, race, level, hp, max_hp, faction_id, disposition FROM characters WHERE character_type = ?'
      const binds: unknown[] = ['npc']
      if (worldId) { query += ' AND world_id = ?'; binds.push(worldId) }
      query += ' ORDER BY name'
      if (a.limit) { query += ' LIMIT ?'; binds.push(a.limit) }
      const { results } = await db.prepare(query).bind(...binds).all()
      return ok({ success: true, actionType: 'list', npcs: results, count: results.length })
    }
    case 'get': {
      const npcId = a.npcId ?? a.id
      if (!npcId) return err('"npcId" or "id" is required')
      const npc = await db.prepare('SELECT * FROM characters WHERE id = ? AND character_type = ?').bind(npcId, 'npc').first()
      if (!npc) return err(`NPC not found: ${npcId}`)
      const { results: relationships } = await db.prepare('SELECT * FROM npc_relationships WHERE npc_id = ? LIMIT 20').bind(npcId).all()
      return ok({ success: true, actionType: 'get', npc: { ...(npc as Record<string, unknown>), stats: JSON.parse((npc as any).stats ?? '{}') }, relationships })
    }
    case 'update': {
      const npcId = a.npcId ?? a.id
      if (!npcId) return err('"npcId" or "id" is required')
      const sets: string[] = ['updated_at = ?']
      const vals: unknown[] = [now]
      if (a.name) { sets.push('name = ?'); vals.push(a.name) }
      if (a.disposition) { sets.push('disposition = ?'); vals.push(a.disposition) }
      if (a.factionId) { sets.push('faction_id = ?'); vals.push(a.factionId) }
      if (a.hp !== undefined) { sets.push('hp = ?'); vals.push(a.hp) }
      vals.push(npcId)
      await db.prepare(`UPDATE characters SET ${sets.join(', ')} WHERE id = ? AND character_type = 'npc'`).bind(...vals).run()
      return ok({ success: true, actionType: 'update', npcId, updated: sets.length - 1 })
    }
    case 'assign_to_location': {
      const npcId = a.npcId ?? a.id
      if (!npcId) return err('"npcId" or "id" is required')
      if (!a.locationKey && (a.hexQ === undefined || a.hexR === undefined)) return err('"locationKey" or both "hexQ"/"hexR" are required')
      const sets: string[] = ['updated_at = ?']
      const vals: unknown[] = [now]
      if (a.locationKey) { sets.push('location_key = ?'); vals.push(a.locationKey) }
      if (a.hexQ !== undefined) { sets.push('current_hex_q = ?'); vals.push(a.hexQ) }
      if (a.hexR !== undefined) { sets.push('current_hex_r = ?'); vals.push(a.hexR) }
      vals.push(npcId)
      await db.prepare(`UPDATE characters SET ${sets.join(', ')} WHERE id = ? AND character_type = 'npc'`).bind(...vals).run()
      return ok({ success: true, actionType: 'assign_to_location', npcId, locationKey: a.locationKey ?? null, hexQ: a.hexQ ?? null, hexR: a.hexR ?? null })
    }
    case 'get_full_context': {
      if (!a.id) return err('"id" (characterId) is required')
      const char = await db.prepare('SELECT * FROM characters WHERE id = ? AND character_type = ?').bind(a.id, 'npc').first()
      if (!char) return err(`NPC not found: ${a.id}`)
      const { results: relationships } = await db.prepare('SELECT * FROM npc_relationships WHERE npc_id = ? LIMIT 20').bind(a.id).all()
      const { results: memories } = await db.prepare('SELECT * FROM conversation_memories WHERE npc_id = ? ORDER BY created_at DESC LIMIT 10').bind(a.id).all()
      return ok({ success: true, actionType: 'get_full_context', character: { ...(char as Record<string, unknown>), stats: JSON.parse((char as any).stats ?? '{}') }, relationships, recentMemories: memories })
    }
    case 'get_relationship': {
      if (!a.characterId || !a.npcId) return err('"characterId" and "npcId" are required')
      const row = await db.prepare('SELECT * FROM npc_relationships WHERE character_id = ? AND npc_id = ?').bind(a.characterId, a.npcId).first()
      return ok({ success: true, actionType: 'get_relationship', characterId: a.characterId, npcId: a.npcId, relationship: row ?? null })
    }
    case 'update_relationship': {
      if (!a.characterId || !a.npcId) return err('"characterId" and "npcId" are required')
      const existing = await db.prepare('SELECT * FROM npc_relationships WHERE character_id = ? AND npc_id = ?').bind(a.characterId, a.npcId).first()
      if (existing) {
        const sets: string[] = ['last_interaction_at = ?', 'interaction_count = interaction_count + 1']; const vals: unknown[] = [now]
        if (a.familiarity) { sets.push('familiarity = ?'); vals.push(a.familiarity) }
        if (a.disposition) { sets.push('disposition = ?'); vals.push(a.disposition) }
        if (a.notes) { sets.push('notes = ?'); vals.push(a.notes) }
        vals.push(a.characterId, a.npcId)
        await db.prepare(`UPDATE npc_relationships SET ${sets.join(', ')} WHERE character_id = ? AND npc_id = ?`).bind(...vals).run()
      } else {
        await db.prepare('INSERT INTO npc_relationships (character_id, npc_id, familiarity, disposition, notes, first_met_at, last_interaction_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(a.characterId, a.npcId, a.familiarity, a.disposition, a.notes ?? null, now, now).run()
      }
      return ok({ success: true, actionType: 'update_relationship', characterId: a.characterId, npcId: a.npcId, familiarity: a.familiarity, disposition: a.disposition })
    }
    case 'record_memory': {
      if (!a.characterId || !a.npcId || !a.summary) return err('"characterId", "npcId", and "summary" are required')
      const result = await db.prepare('INSERT INTO conversation_memories (character_id, npc_id, summary, importance, topics, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(a.characterId, a.npcId, a.summary, a.importance, JSON.stringify(a.topics ?? []), now).run()
      return ok({ success: true, actionType: 'record_memory', memoryId: result.meta?.last_row_id, importance: a.importance })
    }
    case 'get_history': {
      if (!a.characterId || !a.npcId) return err('"characterId" and "npcId" are required')
      const { results } = await db.prepare('SELECT id, summary, importance, topics, created_at FROM conversation_memories WHERE character_id = ? AND npc_id = ? ORDER BY created_at DESC LIMIT ?').bind(a.characterId, a.npcId, a.limit).all()
      return ok({ success: true, actionType: 'get_history', characterId: a.characterId, npcId: a.npcId, memories: results.map((r: Record<string, unknown>) => ({ ...r, topics: JSON.parse((r as any).topics ?? '[]') })), count: results.length })
    }
    case 'get_recent': {
      if (!a.characterId) return err('"characterId" is required')
      const { results } = await db.prepare('SELECT * FROM npc_relationships WHERE character_id = ? ORDER BY last_interaction_at DESC LIMIT ?').bind(a.characterId, a.limit).all()
      return ok({ success: true, actionType: 'get_recent', characterId: a.characterId, interactions: results, count: results.length })
    }
    case 'get_context': {
      if (!a.id) return err('"id" (npcId) is required')
      const npc = await db.prepare('SELECT id, name, character_class, race, level, hp, max_hp FROM characters WHERE id = ?').bind(a.id).first()
      if (!npc) return err(`NPC not found: ${a.id}`)
      const { results: memories } = await db.prepare('SELECT summary, importance, created_at FROM conversation_memories WHERE npc_id = ? ORDER BY created_at DESC LIMIT 5').bind(a.id).all()
      return ok({ success: true, actionType: 'get_context', npc, recentMemories: memories })
    }
    case 'interact': {
      if (!a.characterId || !a.npcId) return err('"characterId" and "npcId" are required')
      await db.prepare("INSERT INTO npc_relationships (character_id, npc_id, familiarity, disposition, first_met_at, last_interaction_at) VALUES (?, ?, 'acquaintance', 'neutral', ?, ?) ON CONFLICT(character_id, npc_id) DO UPDATE SET last_interaction_at = excluded.last_interaction_at, interaction_count = interaction_count + 1").bind(a.characterId, a.npcId, now, now).run()
      if (a.context) {
        await db.prepare('INSERT INTO conversation_memories (character_id, npc_id, summary, importance, topics, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(a.characterId, a.npcId, a.context, 'low', '[]', now).run()
      }
      return ok({ success: true, actionType: 'interact', characterId: a.characterId, npcId: a.npcId, interactionRecorded: true })
    }
  }
}
