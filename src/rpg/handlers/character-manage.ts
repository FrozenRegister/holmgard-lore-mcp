// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/character-manage.ts

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError, CRUD_ALIASES } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['create', 'get', 'update', 'list', 'delete', 'add_xp', 'get_progression', 'level_up', 'search', 'cast_spell'] as const
type CharAction = typeof ACTIONS[number]
const ALIASES: Record<string, CharAction> = {
  ...CRUD_ALIASES,
  new_character: 'create', xp: 'add_xp', gain_xp: 'add_xp',
  progression: 'get_progression', level: 'level_up', levelup: 'level_up',
  find_character: 'search', query: 'search',
  cast: 'cast_spell', castspell: 'cast_spell',
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
  query: z.string().optional(),
  conditions: z.array(z.string()).optional(),
  resistances: z.array(z.string()).optional(),
  vulnerabilities: z.array(z.string()).optional(),
  immunities: z.array(z.string()).optional(),
  spellSlots: z.record(z.object({ max: z.number().int().min(0), current: z.number().int().min(0) })).optional(),
  pactMagicSlots: z.object({ max: z.number().int().min(0), current: z.number().int().min(0), level: z.number().int().min(0).max(9).optional() }).optional(),
  knownSpells: z.array(z.string()).optional(),
  preparedSpells: z.array(z.string()).optional(),
  cantripsKnown: z.array(z.string()).optional(),
  maxSpellLevel: z.number().int().min(0).max(9).optional(),
  concentratingOn: z.string().nullable().optional(),
  legendaryActions: z.number().int().min(0).optional(),
  legendaryActionsRemaining: z.number().int().min(0).optional(),
  legendaryResistances: z.number().int().min(0).optional(),
  legendaryResistancesRemaining: z.number().int().min(0).optional(),
  hasLairActions: z.boolean().optional(),
  resourcePools: z.record(z.unknown()).optional(),
  currency: z.record(z.unknown()).optional(),
  spellName: z.string().optional(),
  slotLevel: z.number().int().min(0).max(9).optional(),
  usePactMagic: z.boolean().optional().default(false),
  requiresConcentration: z.boolean().optional().default(false),
  targetIds: z.array(z.string()).optional(),
  saveDcBase: z.number().int().optional().default(10),
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
    spell_slots: row.spell_slots ? JSON.parse(row.spell_slots as string) : null,
    pact_magic_slots: row.pact_magic_slots ? JSON.parse(row.pact_magic_slots as string) : null,
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
      if (a.conditions) { sets.push('conditions = ?'); vals.push(JSON.stringify(a.conditions)) }
      if (a.resistances) { sets.push('resistances = ?'); vals.push(JSON.stringify(a.resistances)) }
      if (a.vulnerabilities) { sets.push('vulnerabilities = ?'); vals.push(JSON.stringify(a.vulnerabilities)) }
      if (a.immunities) { sets.push('immunities = ?'); vals.push(JSON.stringify(a.immunities)) }
      if (a.spellSlots) { sets.push('spell_slots = ?'); vals.push(JSON.stringify(a.spellSlots)) }
      if (a.pactMagicSlots) { sets.push('pact_magic_slots = ?'); vals.push(JSON.stringify(a.pactMagicSlots)) }
      if (a.knownSpells) { sets.push('known_spells = ?'); vals.push(JSON.stringify(a.knownSpells)) }
      if (a.preparedSpells) { sets.push('prepared_spells = ?'); vals.push(JSON.stringify(a.preparedSpells)) }
      if (a.cantripsKnown) { sets.push('cantrips_known = ?'); vals.push(JSON.stringify(a.cantripsKnown)) }
      if (a.maxSpellLevel !== undefined) { sets.push('max_spell_level = ?'); vals.push(a.maxSpellLevel) }
      if (a.concentratingOn !== undefined) { sets.push('concentrating_on = ?'); vals.push(a.concentratingOn) }
      if (a.legendaryActions !== undefined) { sets.push('legendary_actions = ?'); vals.push(a.legendaryActions) }
      if (a.legendaryActionsRemaining !== undefined) { sets.push('legendary_actions_remaining = ?'); vals.push(a.legendaryActionsRemaining) }
      if (a.legendaryResistances !== undefined) { sets.push('legendary_resistances = ?'); vals.push(a.legendaryResistances) }
      if (a.legendaryResistancesRemaining !== undefined) { sets.push('legendary_resistances_remaining = ?'); vals.push(a.legendaryResistancesRemaining) }
      if (a.hasLairActions !== undefined) { sets.push('has_lair_actions = ?'); vals.push(a.hasLairActions ? 1 : 0) }
      if (a.resourcePools) { sets.push('resource_pools = ?'); vals.push(JSON.stringify(a.resourcePools)) }
      if (a.currency) { sets.push('currency = ?'); vals.push(JSON.stringify(a.currency)) }
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
    case 'search': {
      if (!a.query) return err('"query" is required for search')
      const pattern = `%${a.query}%`
      const { results } = await db.prepare('SELECT id, name, character_type, character_class, race, level FROM characters WHERE name LIKE ? ORDER BY name LIMIT ?')
        .bind(pattern, a.limit).all()
      return ok({ success: true, actionType: 'search', query: a.query, characters: results, count: results.length })
    }
    case 'cast_spell': {
      const charId = a.id ?? a.characterId
      if (!charId || !a.spellName) return err('"id"/"characterId" and "spellName" are required')
      const row = await db.prepare('SELECT known_spells, prepared_spells, cantrips_known, spell_slots, pact_magic_slots, concentrating_on FROM characters WHERE id = ?').bind(charId).first() as
        { known_spells: string; prepared_spells: string; cantrips_known: string; spell_slots: string | null; pact_magic_slots: string | null; concentrating_on: string | null } | null
      if (!row) return err(`Character not found: ${charId}`)

      const knownSpells: string[] = JSON.parse(row.known_spells ?? '[]')
      const preparedSpells: string[] = JSON.parse(row.prepared_spells ?? '[]')
      const cantripsKnown: string[] = JSON.parse(row.cantrips_known ?? '[]')
      const isCantrip = cantripsKnown.includes(a.spellName)
      if (!isCantrip && !knownSpells.includes(a.spellName) && !preparedSpells.includes(a.spellName)) {
        return err(`"${a.spellName}" is not in this character's known/prepared spells or cantrips — cast blocked`)
      }

      let remainingSlots: unknown = null
      if (!isCantrip) {
        if (a.usePactMagic) {
          const pact = row.pact_magic_slots ? JSON.parse(row.pact_magic_slots) : null
          if (!pact || pact.current <= 0) return err('No pact magic slots remaining')
          pact.current -= 1
          await db.prepare('UPDATE characters SET pact_magic_slots = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(pact), now, charId).run()
          remainingSlots = pact
        } else {
          if (a.slotLevel === undefined) return err('"slotLevel" is required to cast a leveled spell (use slotLevel: 0 for a cantrip)')
          const slots = row.spell_slots ? JSON.parse(row.spell_slots) : {}
          const slot = slots[String(a.slotLevel)]
          if (!slot || slot.current <= 0) return err(`No level ${a.slotLevel} spell slots remaining`)
          slot.current -= 1
          await db.prepare('UPDATE characters SET spell_slots = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(slots), now, charId).run()
          remainingSlots = slots
        }
      }

      if (a.requiresConcentration) {
        await db.prepare('DELETE FROM concentration WHERE character_id = ?').bind(charId).run()
        await db.prepare('DELETE FROM auras WHERE owner_id = ? AND requires_concentration = 1').bind(charId).run()
        await db.prepare('INSERT INTO concentration (character_id, active_spell, spell_level, target_ids, started_at, max_duration, save_dc_base) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(charId, a.spellName, a.slotLevel ?? 0, JSON.stringify(a.targetIds ?? []), Date.now(), null, a.saveDcBase).run()
        await db.prepare('UPDATE characters SET concentrating_on = ?, updated_at = ? WHERE id = ?').bind(a.spellName, now, charId).run()
      }

      return ok({
        success: true, actionType: 'cast_spell', characterId: charId, spellName: a.spellName, isCantrip,
        slotLevel: a.slotLevel ?? null, usedPactMagic: a.usePactMagic, remainingSlots, concentrating: a.requiresConcentration,
      })
    }
  }
}
