// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/character-manage.ts

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError, CRUD_ALIASES } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import { syncCharacterToKv } from '../utils/character-sync'
import type { AppBindings } from '../../types'
import { parseKvEntry, extractRawField } from '../../lib/lore'
import { similarity } from '../utils/fuzzy-enum'

const ACTIONS = ['create', 'get', 'update', 'list', 'delete', 'add_xp', 'get_progression', 'level_up', 'search', 'cast_spell', 'snapshot', 'activate', 'list_passengers', 'recompute_derived', 'find_by_name', 'kill'] as const
type CharAction = typeof ACTIONS[number]
const ALIASES: Record<string, CharAction> = {
  ...CRUD_ALIASES,
  new_character: 'create', xp: 'add_xp', gain_xp: 'add_xp',
  progression: 'get_progression', level: 'level_up', levelup: 'level_up',
  find_character: 'search', query: 'search',
  find: 'find_by_name', lookup: 'find_by_name', resolve_name: 'find_by_name',
  cast: 'cast_spell', castspell: 'cast_spell',
  snap: 'snapshot', save_state: 'snapshot',
  switch: 'activate', take_control: 'activate', possess: 'activate',
  passengers: 'list_passengers', list_dormant: 'list_passengers', co_habitants: 'list_passengers',
  recompute: 'recompute_derived', refresh_derived: 'recompute_derived', sync_derived_stats: 'recompute_derived',
  die: 'kill', slay: 'kill', defeat: 'kill',
} as Record<string, CharAction>

const XP_TABLE: Record<number, number> = {
  1: 0, 2: 300, 3: 900, 4: 2700, 5: 6500, 6: 14000, 7: 23000, 8: 34000,
  9: 48000, 10: 64000, 11: 85000, 12: 100000, 13: 120000, 14: 140000,
  15: 165000, 16: 195000, 17: 225000, 18: 265000, 19: 305000, 20: 355000,
}
const levelFromXp = (xp: number) => Object.entries(XP_TABLE).reverse().find(([, req]) => xp >= req)?.[0] ?? '1'

const abilityModifier = (score: number): number => Math.floor((score - 10) / 2)

const StatsSchema = z.object({ str: z.number().default(10), dex: z.number().default(10), con: z.number().default(10), int: z.number().default(10), wis: z.number().default(10), cha: z.number().default(10) })

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  characterId: z.string().optional(),
  name: z.string().optional(),
  characterType: z.enum(['pc', 'npc', 'enemy', 'neutral']).optional(),
  characterClass: z.string().optional(),
  race: z.string().optional(),
  level: z.number().int().min(1).max(20).optional(),
  hp: z.number().int().min(0).optional(),
  maxHp: z.number().int().min(1).optional(),
  ac: z.number().int().optional(),
  stats: StatsSchema.optional(),
  born: z.string().optional(),
  factionId: z.string().optional(),
  behavior: z.string().optional(),
  background: z.string().optional(),
  alignment: z.string().optional(),
  origin: z.string().optional(),
  currentRoomId: z.string().nullable().optional(),
  hostBodyId: z.string().nullable().optional(),
  active: z.boolean().optional(),
  worldId: z.string().nullable().optional(),
  // #268 — callers (including this repo's own issue reproductions) commonly
  // pass the snake_case `world_id` used elsewhere in the RPG handlers
  // (time-manage.ts, timeline-manage.ts). Zod silently drops unrecognized
  // keys, so `world_id` was accepted but never actually filtered — every
  // action below reads `a.worldId`, normalized from either key immediately
  // after parsing.
  world_id: z.string().nullable().optional(),
  perceptionBonus: z.number().int().optional(),
  stealthBonus: z.number().int().optional(),
  xp: z.number().int().min(0).optional(),
  amount: z.number().int().min(0).optional(),
  xpAmount: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(200).optional(),
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
  killerId: z.string().optional(),
  causeOfDeath: z.string().optional(),
  location: z.string().optional(),
  triggerProductionPulse: z.boolean().optional(),
  killedBy: z.string().optional(),
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
  usePactMagic: z.boolean().optional(),
  requiresConcentration: z.boolean().optional(),
  targetIds: z.array(z.string()).optional(),
  saveDcBase: z.number().int().optional(),
  narrativeNote: z.string().optional(),
  capturedBy: z.enum(['system', 'timeline_event', 'manual']).optional(),
  eventId: z.string().optional(),
  stateJson: z.record(z.unknown()).optional(),
})

function parseChar(row: Record<string, unknown>) {
  const stats = row.stats ? JSON.parse(row.stats as string) : { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }
  const acSet = row.ac as number | undefined
  const dexMod = abilityModifier(stats.dex)
  const wisMod = abilityModifier(stats.wis)

  return {
    ...row,
    stats,
    ability_modifiers: {
      str: abilityModifier(stats.str),
      dex: dexMod,
      con: abilityModifier(stats.con),
      int: abilityModifier(stats.int),
      wis: wisMod,
      cha: abilityModifier(stats.cha),
    },
    ac: acSet ?? (10 + dexMod),
    perception_bonus: (row.perception_bonus as number | undefined) ?? wisMod,
    stealth_bonus: (row.stealth_bonus as number | undefined) ?? dexMod,
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
  if (a.worldId === undefined && a.world_id !== undefined) a.worldId = a.world_id
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'create': {
      if (!a.name) return err('"name" is required')
      const id = crypto.randomUUID()
      const stats = a.stats ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }
      const level = a.level ?? 1
      const characterClass = a.characterClass ?? 'Fighter'
      const race = a.race ?? 'Human'
      const characterType = a.characterType ?? 'pc'
      const ac = a.ac ?? (10 + abilityModifier(stats.dex))
      const maxHp = a.maxHp ?? Math.max(1, level * 8)
      const hp = a.hp ?? maxHp
      const currency = a.currency ?? { gold: 0, silver: 0, copper: 0 }
      const dexMod = abilityModifier(stats.dex)
      const wisMod = abilityModifier(stats.wis)
      const perceptionBonus = a.perceptionBonus ?? wisMod
      const stealthBonus = a.stealthBonus ?? dexMod
      await db.prepare(`
        INSERT INTO characters (
          id, name, stats, hp, max_hp, ac, level, faction_id, behavior, character_type, character_class, race,
          background, alignment, origin, born, conditions, resistances, vulnerabilities, immunities,
          known_spells, prepared_spells, cantrips_known, spell_slots, pact_magic_slots, max_spell_level, concentrating_on,
          legendary_actions, legendary_actions_remaining, legendary_resistances, legendary_resistances_remaining, has_lair_actions,
          currency, current_room_id, perception_bonus, stealth_bonus, resource_pools, xp, host_body_id, active, world_id, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, a.name, JSON.stringify(stats), hp, maxHp, ac, level, a.factionId ?? null, a.behavior ?? null, characterType, characterClass, race,
        a.background ?? null, a.alignment ?? null, a.origin ?? null, a.born ?? null,
        JSON.stringify(a.conditions ?? []), JSON.stringify(a.resistances ?? []), JSON.stringify(a.vulnerabilities ?? []), JSON.stringify(a.immunities ?? []),
        JSON.stringify(a.knownSpells ?? []), JSON.stringify(a.preparedSpells ?? []), JSON.stringify(a.cantripsKnown ?? []),
        a.spellSlots ? JSON.stringify(a.spellSlots) : null, a.pactMagicSlots ? JSON.stringify(a.pactMagicSlots) : null, a.maxSpellLevel ?? 0, a.concentratingOn ?? null,
        a.legendaryActions ?? null, a.legendaryActionsRemaining ?? null, a.legendaryResistances ?? null, a.legendaryResistancesRemaining ?? null, a.hasLairActions ? 1 : 0,
        JSON.stringify(currency), a.currentRoomId ?? null, perceptionBonus, stealthBonus, JSON.stringify(a.resourcePools ?? {}), 0,
        a.hostBodyId ?? null, a.active === undefined ? 1 : (a.active ? 1 : 0), a.worldId ?? null, now, now
      ).run()
      // Sync D1 character to KV as markdown projection
      await syncCharacterToKv(env, id)
      return ok({ success: true, actionType: 'create', characterId: id, name: a.name, characterType })
    }
    case 'get': {
      const charId = a.id ?? a.characterId
      if (!charId && !a.name) return err('"id", "characterId", or "name" is required')

      if (charId) {
        const row = await db.prepare('SELECT * FROM characters WHERE id = ?').bind(charId).first()
        if (!row) return err(`Character not found: ${charId}`)
        return ok({ success: true, actionType: 'get', character: parseChar(row as Record<string, unknown>) })
      }

      // #309 — lookup by exact name when no id/characterId is given.
      const { results } = await db.prepare('SELECT * FROM characters WHERE name = ? LIMIT 2').bind(a.name).all()
      if (results.length === 0) return err(`Character not found: ${a.name}`)
      if (results.length > 1) {
        return err(`Multiple characters with name '${a.name}' exist. Use "id"/"characterId" for an unambiguous lookup.`, {
          characters: results.map(r => parseChar(r as Record<string, unknown>)),
        })
      }
      return ok({ success: true, actionType: 'get', character: parseChar(results[0] as Record<string, unknown>) })
    }
    case 'list': {
      let query = 'SELECT id, name, character_type, character_class, race, level, hp, max_hp, ac, world_id, born FROM characters'
      const binds: unknown[] = []
      const conditions: string[] = []
      if (a.characterTypeFilter) { conditions.push('character_type = ?'); binds.push(a.characterTypeFilter) }
      if (a.worldId) { conditions.push('world_id = ?'); binds.push(a.worldId) }
      if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ')
      query += ' ORDER BY name LIMIT ?'
      binds.push(a.limit ?? 50)
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
      if (a.born !== undefined) { sets.push('born = ?'); vals.push(a.born) }
      if (a.characterClass !== undefined) { sets.push('character_class = ?'); vals.push(a.characterClass) }
      if (a.race !== undefined) { sets.push('race = ?'); vals.push(a.race) }
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
      if (a.factionId !== undefined) { sets.push('faction_id = ?'); vals.push(a.factionId) }
      if (a.behavior !== undefined) { sets.push('behavior = ?'); vals.push(a.behavior) }
      if (a.origin !== undefined) { sets.push('origin = ?'); vals.push(a.origin) }
      if (a.currentRoomId !== undefined) { sets.push('current_room_id = ?'); vals.push(a.currentRoomId) }
      if (a.hostBodyId !== undefined) { sets.push('host_body_id = ?'); vals.push(a.hostBodyId) }
      // Raw single-row PATCH, same as every other field here — does NOT cascade to
      // deactivate siblings sharing host_body_id. Only the `activate` action performs
      // the atomic "deactivate siblings + activate target" swap (see #226 Phase 2).
      if (a.active !== undefined) { sets.push('active = ?'); vals.push(a.active ? 1 : 0) }
      if (a.perceptionBonus !== undefined) { sets.push('perception_bonus = ?'); vals.push(a.perceptionBonus) }
      if (a.stealthBonus !== undefined) { sets.push('stealth_bonus = ?'); vals.push(a.stealthBonus) }
      if (a.worldId !== undefined) { sets.push('world_id = ?'); vals.push(a.worldId) }
      vals.push(charId)
      await db.prepare(`UPDATE characters SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
      // Sync D1 character to KV as markdown projection
      await syncCharacterToKv(env, charId)
      return ok({ success: true, actionType: 'update', characterId: charId })
    }
    case 'delete': {
      const charId = a.id ?? a.characterId
      if (!charId) return err('"id" or "characterId" is required')
      await db.prepare('DELETE FROM characters WHERE id = ?').bind(charId).run()
      return ok({ success: true, actionType: 'delete', characterId: charId })
    }
    case 'recompute_derived': {
      // #266 — ac/perception_bonus/stealth_bonus are real, explicitly-stored
      // columns (not computed on write), so once a character's ability
      // scores change — or, as with the Calder cast, once corrupted rows get
      // their level restored without anyone re-deriving these three fields —
      // they go stale. This recomputes them from each character's own
      // already-stored `stats` using the exact formula parseChar() already
      // uses as its *display-only* fallback (10+DEXmod, WISmod, DEXmod),
      // and persists the result. Pure arithmetic over data that already
      // exists — no narrative guessing involved.
      const charId = a.id ?? a.characterId
      if (!charId && !a.worldId) return err('"id"/"characterId", or "worldId" for a bulk recompute, is required')
      let query = 'SELECT id, stats FROM characters'
      const binds: unknown[] = []
      if (charId) { query += ' WHERE id = ?'; binds.push(charId) }
      else { query += ' WHERE world_id = ?'; binds.push(a.worldId) }
      const { results } = await db.prepare(query).bind(...binds).all() as { results: Array<{ id: string; stats: string }> }
      if (charId && results.length === 0) return err(`Character not found: ${charId}`)
      const characterIds: string[] = []
      for (const row of results) {
        const stats = JSON.parse(row.stats) as { dex: number; wis: number }
        const dexMod = abilityModifier(stats.dex)
        const wisMod = abilityModifier(stats.wis)
        await db.prepare('UPDATE characters SET ac = ?, perception_bonus = ?, stealth_bonus = ?, updated_at = ? WHERE id = ?')
          .bind(10 + dexMod, wisMod, dexMod, now, row.id).run()
        await syncCharacterToKv(env, row.id)
        characterIds.push(row.id)
      }
      return ok({ success: true, actionType: 'recompute_derived', charactersUpdated: characterIds.length, characterIds })
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
      // Sync D1 character to KV as markdown projection
      await syncCharacterToKv(env, charId)
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
      // Sync D1 character to KV as markdown projection
      await syncCharacterToKv(env, charId)
      return ok({ success: true, actionType: 'level_up', characterId: charId, newLevel, hpIncrease })
    }
    case 'search': {
      if (!a.query) return err('"query" is required for search')
      const pattern = `%${a.query}%`
      let query = 'SELECT id, name, character_type, character_class, race, level, world_id FROM characters WHERE name LIKE ?'
      const binds: unknown[] = [pattern]
      if (a.worldId) { query += ' AND world_id = ?'; binds.push(a.worldId) }
      query += ' ORDER BY name LIMIT ?'
      binds.push(a.limit ?? 50)
      const { results } = await db.prepare(query).bind(...binds).all()
      return ok({ success: true, actionType: 'search', query: a.query, characters: results, count: results.length })
    }
    case 'cast_spell': {
      try {
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
          const usePactMagic = a.usePactMagic ?? false
          if (usePactMagic) {
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

        const requiresConcentration = a.requiresConcentration ?? false
        if (requiresConcentration) {
          await db.prepare('DELETE FROM concentration WHERE character_id = ?').bind(charId).run()
          await db.prepare('DELETE FROM auras WHERE owner_id = ? AND requires_concentration = 1').bind(charId).run()
          await db.prepare('INSERT INTO concentration (character_id, active_spell, spell_level, target_ids, started_at, max_duration, save_dc_base) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(charId, a.spellName, a.slotLevel ?? 0, JSON.stringify(a.targetIds ?? []), Date.now(), null, a.saveDcBase ?? 10).run()
          await db.prepare('UPDATE characters SET concentrating_on = ?, updated_at = ? WHERE id = ?').bind(a.spellName, now, charId).run()
        }

        // Sync D1 character to KV as markdown projection
        await syncCharacterToKv(env, charId)

        return ok({
          success: true, actionType: 'cast_spell', characterId: charId, spellName: a.spellName, isCantrip,
          slotLevel: a.slotLevel ?? null, usedPactMagic: a.usePactMagic ?? false, remainingSlots, concentrating: requiresConcentration,
        })
      } catch (e) {
        const msg = String(e)
        return err(`cast_spell failed: ${msg}`)
      }
    }
    case 'snapshot': {
      const charId = a.id ?? a.characterId
      if (!charId) return err('"id" or "characterId" is required')
      const row = await db.prepare('SELECT * FROM characters WHERE id = ?').bind(charId).first()
      if (!row) return err(`Character not found: ${charId}`)

      const snapshotId = crypto.randomUUID()
      const capturedAt = a.born ? new Date(a.born).toISOString() : now
      const capturedBy = a.capturedBy ?? 'manual'
      const statJson = row.stats as string

      await db.prepare(`
        INSERT INTO character_snapshots (
          id, character_id, captured_at, captured_by, event_id, stats_json, hp, max_hp, level, ac, state_json, narrative_note, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        snapshotId, charId, capturedAt, capturedBy, a.eventId ?? null, statJson,
        row.hp as number, row.max_hp as number, row.level as number, row.ac as number,
        a.stateJson ? JSON.stringify(a.stateJson) : null, a.narrativeNote ?? null, now
      ).run()

      return ok({
        success: true, actionType: 'snapshot', snapshotId, characterId: charId,
        capturedAt, narrativeNote: a.narrativeNote ?? null,
      })
    }
    case 'activate': {
      const charId = a.id ?? a.characterId
      if (!charId) return err('"id" or "characterId" is required')
      const target = await db.prepare('SELECT id, host_body_id FROM characters WHERE id = ?').bind(charId).first() as { id: string; host_body_id: string | null } | null
      if (!target) return err(`Character not found: ${charId}`)

      const hostBodyId = a.hostBodyId ?? target.host_body_id

      if (!hostBodyId) {
        // Not part of any co-habitation group — activation is a harmless no-op-ish
        // single-row update, not an error.
        await db.prepare('UPDATE characters SET active = 1, updated_at = ? WHERE id = ?').bind(now, charId).run()
        await syncCharacterToKv(env, charId)
        return ok({ success: true, actionType: 'activate', characterId: charId, hostBodyId: null, deactivated: [] })
      }

      const { results: siblingRows } = await db.prepare('SELECT id FROM characters WHERE host_body_id = ? AND id != ?').bind(hostBodyId, charId).all()
      const siblingIds = (siblingRows as Array<{ id: string }>).map(r => r.id)

      // Atomic: deactivate every other row sharing this host body, activate the
      // target, in one batch — must be all-or-nothing or a host body could end up
      // with zero or two active consciousnesses (#226 Phase 2).
      await db.batch([
        db.prepare('UPDATE characters SET active = 0, updated_at = ? WHERE host_body_id = ? AND id != ?').bind(now, hostBodyId, charId),
        db.prepare('UPDATE characters SET active = 1, host_body_id = ?, updated_at = ? WHERE id = ?').bind(hostBodyId, now, charId),
      ])

      // Every row whose active state changed needs its KV projection refreshed.
      await Promise.all([charId, ...siblingIds].map(id => syncCharacterToKv(env, id)))

      return ok({ success: true, actionType: 'activate', characterId: charId, hostBodyId, deactivated: siblingIds })
    }
    case 'list_passengers': {
      let hostBodyId = a.hostBodyId ?? null
      if (!hostBodyId) {
        const charId = a.id ?? a.characterId
        if (!charId) return err('"hostBodyId" or "id"/"characterId" is required')
        const row = await db.prepare('SELECT host_body_id FROM characters WHERE id = ?').bind(charId).first() as { host_body_id: string | null } | null
        if (!row) return err(`Character not found: ${charId}`)
        if (!row.host_body_id) {
          return ok({ success: true, actionType: 'list_passengers', hostBodyId: null, activeCharacterId: charId, passengers: [], count: 0 })
        }
        hostBodyId = row.host_body_id
      }

      const { results } = await db.prepare(
        'SELECT id, name, active, character_type FROM characters WHERE host_body_id = ? ORDER BY active DESC, name'
      ).bind(hostBodyId).all()
      const rows = results as Array<{ id: string; name: string; active: number; character_type: string }>
      const activeRow = rows.find(r => r.active === 1) ?? null
      const passengers = rows.filter(r => r.active !== 1)

      return ok({
        success: true, actionType: 'list_passengers', hostBodyId,
        activeCharacterId: activeRow ? activeRow.id : null,
        active: activeRow, passengers, count: passengers.length,
      })
    }
    case 'find_by_name': {
      if (!a.name) return err('"name" is required for find_by_name')
      const normalizedName = a.name.trim().toLowerCase()
      // D1 exact + prefix matches (score: exact = 1.0, LIKE prefix = 0.9)
      const { results: d1Rows } = await db.prepare(
        'SELECT id, name, character_type, character_class, race, level, world_id FROM characters WHERE LOWER(name) = ? OR LOWER(name) LIKE ? ORDER BY name LIMIT ?'
      ).bind(normalizedName, `${normalizedName}%`, a.limit ?? 20).all()

      const matches: Array<{ key: string; name: string; characterId: string | null; character_type: string | null; source: string; confidence: number }> = []
      for (const row of d1Rows as Array<Record<string, unknown>>) {
        const matchName = (row.name as string).trim().toLowerCase()
        const confidence = matchName === normalizedName ? 1.0 : 0.9
        matches.push({
          key: `character:${(row.name as string).toLowerCase().replace(/\s+/g, '-')}`,
          name: row.name as string,
          characterId: row.id as string,
          character_type: row.character_type as string | null,
          source: 'd1', confidence,
        })
      }

      // KV fuzzy fallback: scan character:* keys for name similarity
      if (env.LORE_DB) {
        try {
          const allKeys: string[] = []
          let cursor: string | undefined
          do {
            const listed: any = await env.LORE_DB.list(cursor ? { cursor, prefix: 'character:' } : { prefix: 'character:' })
            for (const k of listed.keys) allKeys.push(k.name)
            cursor = listed.list_complete ? undefined : listed.cursor
          } while (cursor)
          const raws = await Promise.all(allKeys.map(k => env.LORE_DB!.get(k)))
          for (let i = 0; i < allKeys.length; i++) {
            const raw = raws[i]
            if (!raw) continue
            const { text } = parseKvEntry(raw)
            const kvName = (extractRawField(text, 'Name') ?? allKeys[i].replace(/^character:/, '')).trim().toLowerCase()
            const nameScore = similarity(normalizedName, kvName)

            // Skip if D1 already matched this character
            const kvCharId = extractRawField(text, 'D1-ID') ?? null
            if (kvCharId && matches.some(m => m.characterId === kvCharId)) continue

            // Levenshtein ≤ 2 = fuzzy match (0.5 confidence), substring = 0.7
            let confidence = 0
            if (kvName === normalizedName) confidence = 0.95
            else if (kvName.includes(normalizedName) || normalizedName.includes(kvName)) confidence = 0.7
            else if (nameScore >= 0.7) confidence = 0.5

            if (confidence > 0) {
              matches.push({
                key: allKeys[i],
                name: kvName,
                characterId: kvCharId,
                character_type: extractRawField(text, 'Character-Type') ?? extractRawField(text, 'Type') ?? null,
                source: 'kv', confidence,
              })
            }
          }
          matches.sort((x, y) => y.confidence - x.confidence)
        } catch {
          // KV scan is best-effort; ignore failures
        }
      }

      // Build response envelope per #367 spec
      const top = matches.slice(0, a.limit ?? 20)
      if (top.length === 0) {
        // Suggestions: extract names from KV keys that start with the query letter
        const suggestions: string[] = []
        try {
          const { results: suggestRows } = await db.prepare(
            "SELECT name FROM characters WHERE LOWER(name) LIKE ? ORDER BY name LIMIT 3"
          ).bind(`${normalizedName[0] ?? ''}%`).all()
          for (const r of suggestRows as Array<{ name: string }>) {
            if (!suggestions.includes(r.name)) suggestions.push(r.name)
          }
        } catch { /* best-effort */ }
        return ok({ found: false, query: a.name, suggestions })
      }

      const ambiguous = top.length > 1 && (top[0].confidence < 0.8 || top[1].confidence >= top[0].confidence - 0.15)
      return ok({
        found: true, query: a.name,
        ambiguous: ambiguous || undefined,
        matches: top.map(m => ({ key: m.key, name: m.name, characterId: m.characterId, confidence: m.confidence })),
      })
    }
    case 'kill': {
      const charId = a.id ?? a.characterId
      if (!charId) return err('"id" or "characterId" is required')

      // Read full character row for current location data
      const row = await db.prepare('SELECT id, name, hp, max_hp, character_type, current_room_id, world_id FROM characters WHERE id = ?').bind(charId).first() as
        { id: string; name: string; hp: number; max_hp: number; character_type: string; current_room_id: string | null; world_id: string | null } | null
      if (!row) return err(`Character not found: ${charId}`)

      // Resolve world_id from row or args
      const worldId = a.worldId ?? row.world_id
      const deathId = crypto.randomUUID()
      const killedAt = now
      const deathLocation = a.location ?? row.current_room_id ?? null
      const killerId = a.killedBy ?? a.killerId ?? null
      const causeOfDeath = a.causeOfDeath ?? 'unknown'

      // Atomic batch: HP→0, conditions→dead, clear location, corpse insert, event log
      const statements: D1PreparedStatement[] = [
        db.prepare('UPDATE characters SET hp = 0, conditions = ?, current_room_id = NULL, updated_at = ? WHERE id = ?')
          .bind(JSON.stringify(['dead']), now, charId),
        db.prepare(
          `INSERT INTO corpses (id, character_id, character_name, world_id, death_at, cause_of_death, killer_id, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(deathId, charId, row.name, worldId, killedAt, causeOfDeath, killerId, 'fresh', now, now),
      ]

      // Append event to D1 timeline_events
      const eventId = crypto.randomUUID()
      statements.push(db.prepare(
        `INSERT INTO timeline_events (id, world_id, thread_id, event_at, verb, entity_id, object_entity, location_id, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        eventId, worldId, 'main', killedAt, 'died', charId,
        killerId, deathLocation,
        `Killed by ${killerId ?? 'unknown'} at ${deathLocation ?? 'unknown location'} (cause: ${causeOfDeath})`,
        killedAt,
      ))

      // Production pulse: emit event to event_inbox if requested
      let productionPulse: Record<string, unknown> | null = null
      if (a.triggerProductionPulse) {
        statements.push(db.prepare(
          `INSERT INTO event_inbox (event_type, payload, source_type, source_id, priority)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(
          'world_change',
          JSON.stringify({
            type: 'character_death',
            characterId: charId,
            characterName: row.name,
            killerId,
            causeOfDeath,
            location: deathLocation,
            diedAt: killedAt,
          }),
          'system', 'character-death', 5,
        ))
        productionPulse = { triggered: true, approvalShift: -3, celesteComment: 'pre-recorded: death template' }
      }

      await db.batch(statements)
      await syncCharacterToKv(env, charId)

      return ok({
        success: true, actionType: 'kill',
        character: { hp: 0, status: 'dead', location: null, diedAt: killedAt },
        event: { id: eventId, verb: 'died', detail: `Killed by ${killerId ?? 'unknown'} at ${deathLocation ?? 'unknown location'}` },
        corpse: { id: deathId, state: 'fresh' },
        productionPulse,
        locationOccupantsUpdated: true,
      })
    }
  }
}
