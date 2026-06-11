// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/character-manage.ts

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError, CRUD_ALIASES } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['create', 'get', 'update', 'list', 'delete', 'add_xp', 'get_progression', 'level_up'] as const
type CharAction = typeof ACTIONS[number]
const ALIASES: Record<string, CharAction> = {
  ...CRUD_ALIASES,
  new_character: 'create', xp: 'add_xp', gain_xp: 'add_xp',
  progression: 'get_progression', level: 'level_up', levelup: 'level_up',
} as Record<string, CharAction>

const XP_TABLE: Record<number, number> = {
  1: 0, 2: 300, 3: 900, 4: 2700, 5: 6500, 6: 14000, 7: 23000, 8: 34000,
  9: 48000, 10: 64000, 11: 85000, 12: 100000, 13: 120000, 14: 140000,
  15: 165000, 16: 195000, 17: 225000, 18: 265000, 19: 305000, 20: 355000,
}
const levelFromXp = (xp: number) => Object.entries(XP_TABLE).reverse().find(([, req]) => xp >= req)?.[0] ?? '1'

const StatsSchema = z.object({ str: z.number().default(10), dex: z.number().default(10), con: z.number().default(10), int: z.number().default(10), wis: z.number().default(10), cha: z.number().default(10) })

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  characterId: z.string().optional(),
  name: z.string().optional(),
  characterType: z.enum(['pc', 'npc', 'enemy', 'neutral']).optional().default('pc'),
  characterClass: z.string().optional().default('Fighter'),
  race: z.string().optional().default('Human'),
  level: z.number().int().min(1).max(20).optional().default(1),
  hp: z.number().int().min(0).optional(),
  maxHp: z.number().int().min(1).optional(),
  ac: z.number().int().optional().default(10),
  stats: StatsSchema.optional(),
  factionId: z.string().optional(),
  background: z.string().optional(),
  alignment: z.string().optional(),
  xp: z.number().int().min(0).optional(),
  amount: z.number().int().min(0).optional(),
  xpAmount: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
  characterTypeFilter: z.enum(['pc', 'npc', 'enemy', 'neutral']).optional(),
})

function parseChar(row: Record<string, unknown>) {
  return {
    ...row,
    stats: row.stats ? JSON.parse(row.stats as string) : {},
    conditions: row.conditions ? JSON.parse(row.conditions as string) : [],
    resistances: row.resistances ? JSON.parse(row.resistances as string) : [],
    vulnerabilities: row.vulnerabilities ? JSON.parse(row.vulnerabilities as string) : [],
    immunities: row.immunities ? JSON.parse(row.immunities as string) : [],
    known_spells: row.known_spells ? JSON.parse(row.known_spells as string) : [],
    prepared_spells: row.prepared_spells ? JSON.parse(row.prepared_spells as string) : [],
    cantrips_known: row.cantrips_known ? JSON.parse(row.cantrips_known as string) : [],
    currency: row.currency ? JSON.parse(row.currency as string) : {},
    resource_pools: row.resource_pools ? JSON.parse(row.resource_pools as string) : {},
  }
}

export async function handleCharacterManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
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
      const maxHp = a.maxHp ?? Math.max(1, (a.level ?? 1) * 8)
      const hp = a.hp ?? maxHp
      await db.prepare(`
        INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, faction_id, character_type, character_class, race, background, alignment, conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells, cantrips_known, currency, resource_pools, xp, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, a.name, JSON.stringify(stats), hp, maxHp, a.ac, a.level, a.factionId ?? null, a.characterType, a.characterClass, a.race, a.background ?? null, a.alignment ?? null, '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{"gold":0,"silver":0,"copper":0}', '{}', 0, now, now).run()
      return ok({ success: true, actionType: 'create', characterId: id, name: a.name, characterType: a.characterType })
    }
    case 'get': {
      const charId = a.id ?? a.characterId
      if (!charId) return err('"id" or "characterId" is required')
      const row = await db.prepare('SELECT * FROM characters WHERE id = ?').bind(charId).first()
      if (!row) return err(`Character not found: ${charId}`)
      return ok({ success: true, actionType: 'get', character: parseChar(row as Record<string, unknown>) })
    }
    case 'list': {
      let query = 'SELECT id, name, character_type, character_class, race, level, hp, max_hp, ac FROM characters'
      const binds: unknown[] = []
      if (a.characterTypeFilter) { query += ' WHERE character_type = ?'; binds.push(a.characterTypeFilter) }
      query += ' ORDER BY name LIMIT ?'
      binds.push(a.limit)
      const { results } = await db.prepare(query).bind(...binds).all()
      return ok({ success: true, actionType: 'list', characters: results, count: results.length })
    }
    case 'update': {
      const charId = a.id ?? a.characterId
      if (!charId) return err('"id" or "characterId" is required')
      const sets: string[] = ['updated_at = ?']
      const vals: unknown[] = [now]
      if (a.name) { sets.push('name = ?'); vals.push(a.name) }
      if (a.hp !== undefined) { sets.push('hp = ?'); vals.push(a.hp) }
      if (a.maxHp !== undefined) { sets.push('max_hp = ?'); vals.push(a.maxHp) }
      if (a.ac !== undefined) { sets.push('ac = ?'); vals.push(a.ac) }
      if (a.level !== undefined) { sets.push('level = ?'); vals.push(a.level) }
      if (a.stats) { sets.push('stats = ?'); vals.push(JSON.stringify(a.stats)) }
      if (a.background) { sets.push('background = ?'); vals.push(a.background) }
      if (a.alignment) { sets.push('alignment = ?'); vals.push(a.alignment) }
      vals.push(charId)
      await db.prepare(`UPDATE characters SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
      return ok({ success: true, actionType: 'update', characterId: charId })
    }
    case 'delete': {
      const charId = a.id ?? a.characterId
      if (!charId) return err('"id" or "characterId" is required')
      await db.prepare('DELETE FROM characters WHERE id = ?').bind(charId).run()
      return ok({ success: true, actionType: 'delete', characterId: charId })
    }
    case 'add_xp': {
      const charId = a.id ?? a.characterId
      const xpToAdd = a.amount ?? a.xpAmount
      if (!charId || xpToAdd === undefined) return err('"id"/"characterId" and "amount"/"xpAmount" are required')
      const row = await db.prepare('SELECT xp, level FROM characters WHERE id = ?').bind(charId).first() as { xp: number; level: number } | null
      if (!row) return err(`Character not found: ${charId}`)
      const newXp = (row.xp ?? 0) + xpToAdd
      const newLevel = parseInt(levelFromXp(newXp))
      await db.prepare('UPDATE characters SET xp = ?, level = ?, updated_at = ? WHERE id = ?').bind(newXp, newLevel, now, charId).run()
      return ok({ success: true, actionType: 'add_xp', characterId: charId, xpAdded: xpToAdd, totalXp: newXp, level: newLevel, leveledUp: newLevel > row.level })
    }
    case 'get_progression': {
      const charId = a.id ?? a.characterId
      if (!charId) return err('"id" or "characterId" is required')
      const row = await db.prepare('SELECT xp, level FROM characters WHERE id = ?').bind(charId).first() as { xp: number; level: number } | null
      if (!row) return err(`Character not found: ${charId}`)
      const lvl = row.level ?? 1
      const nextLevel = XP_TABLE[lvl + 1] ?? null
      return ok({ success: true, actionType: 'get_progression', characterId: charId, currentXp: row.xp, level: lvl, xpForNextLevel: nextLevel, xpNeeded: nextLevel ? nextLevel - row.xp : null })
    }
    case 'level_up': {
      const charId = a.id ?? a.characterId
      if (!charId) return err('"id" or "characterId" is required')
      const row = await db.prepare('SELECT level, max_hp FROM characters WHERE id = ?').bind(charId).first() as { level: number; max_hp: number } | null
      if (!row) return err(`Character not found: ${charId}`)
      const newLevel = Math.min(20, (row.level ?? 1) + 1)
      const hpIncrease = 8
      const newMaxHp = (row.max_hp ?? 1) + hpIncrease
      await db.prepare('UPDATE characters SET level = ?, max_hp = ?, hp = max_hp + ?, updated_at = ? WHERE id = ?').bind(newLevel, newMaxHp, hpIncrease, now, charId).run()
      return ok({ success: true, actionType: 'level_up', characterId: charId, newLevel, hpIncrease })
    }
  }
}
