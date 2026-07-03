// Ported from Mnehmos v1.0.3 (long_rest / short_rest) — previously declined as
// out-of-scope in issue #74; implemented per issue #206.
// Operates on the characters table's existing spell_slots/pact_magic_slots/
// legendary_* columns (see docs/mnehmos-baseline.md — no schema migration needed).

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['long_rest', 'short_rest'] as const
type RestAction = typeof ACTIONS[number]
const ALIASES: Record<string, RestAction> = {
  long: 'long_rest', full_rest: 'long_rest', sleep: 'long_rest',
  short: 'short_rest', partial_rest: 'short_rest', catch_breath: 'short_rest',
}

const InputSchema = z.object({
  action: z.string(),
  characterId: z.string().optional(),
  partyId: z.string().optional(),
  healAmount: z.number().int().min(0).optional(),
})

type CharacterRow = {
  id: string
  max_hp: number
  spell_slots: string | null
  pact_magic_slots: string | null
  legendary_actions: number | null
  legendary_resistances: number | null
  resource_pools: string | null
}

function restoreLongRest(char: CharacterRow) {
  const spellSlots = char.spell_slots ? JSON.parse(char.spell_slots) : null
  if (spellSlots) for (const level of Object.keys(spellSlots)) spellSlots[level].current = spellSlots[level].max
  const pactMagicSlots = char.pact_magic_slots ? JSON.parse(char.pact_magic_slots) : null
  if (pactMagicSlots) pactMagicSlots.current = pactMagicSlots.max
  const pools = char.resource_pools ? JSON.parse(char.resource_pools) : {}
  delete pools.death_saves
  return { spellSlots, pactMagicSlots, pools }
}

function restoreShortRest(char: CharacterRow) {
  const pactMagicSlots = char.pact_magic_slots ? JSON.parse(char.pact_magic_slots) : null
  if (pactMagicSlots) pactMagicSlots.current = pactMagicSlots.max
  return { pactMagicSlots }
}

async function getCharacterIds(db: D1Database, characterId?: string, partyId?: string): Promise<string[]> {
  if (characterId) return [characterId]
  if (partyId) {
    const { results } = await db.prepare('SELECT character_id FROM party_members WHERE party_id = ?').bind(partyId).all()
    return (results as Array<{ character_id: string }>).map(r => r.character_id)
  }
  return []
}

export async function handleRestManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  const characterIds = await getCharacterIds(db, a.characterId, a.partyId)
  if (characterIds.length === 0) return err('"characterId" or "partyId" is required')

  switch (match.matched) {
    case 'long_rest': {
      const rested: string[] = []
      for (const id of characterIds) {
        const char = await db.prepare('SELECT id, max_hp, spell_slots, pact_magic_slots, legendary_actions, legendary_resistances, resource_pools FROM characters WHERE id = ?').bind(id).first() as CharacterRow | null
        if (!char) continue
        const { spellSlots, pactMagicSlots, pools } = restoreLongRest(char)
        await db.prepare(`
          UPDATE characters SET hp = max_hp, spell_slots = ?, pact_magic_slots = ?,
            legendary_actions_remaining = legendary_actions, legendary_resistances_remaining = legendary_resistances,
            conditions = '[]', resource_pools = ?, updated_at = ?
          WHERE id = ?
        `).bind(spellSlots ? JSON.stringify(spellSlots) : char.spell_slots, pactMagicSlots ? JSON.stringify(pactMagicSlots) : char.pact_magic_slots, JSON.stringify(pools), now, id).run()
        rested.push(id)
      }
      if (rested.length === 0) return err(`No characters found for ${a.characterId ? `characterId ${a.characterId}` : `partyId ${a.partyId}`}`)
      return ok({ success: true, actionType: 'long_rest', characterIds: rested, restored: ['hp', 'spell_slots', 'pact_magic_slots', 'legendary_actions', 'legendary_resistances', 'conditions', 'death_saves'] })
    }
    case 'short_rest': {
      const rested: string[] = []
      for (const id of characterIds) {
        const char = await db.prepare('SELECT id, max_hp, spell_slots, pact_magic_slots, legendary_actions, legendary_resistances, resource_pools FROM characters WHERE id = ?').bind(id).first() as CharacterRow | null
        if (!char) continue
        const { pactMagicSlots } = restoreShortRest(char)
        if (a.healAmount) {
          await db.prepare('UPDATE characters SET hp = MIN(max_hp, hp + ?), pact_magic_slots = ?, updated_at = ? WHERE id = ?')
            .bind(a.healAmount, pactMagicSlots ? JSON.stringify(pactMagicSlots) : char.pact_magic_slots, now, id).run()
        } else {
          await db.prepare('UPDATE characters SET pact_magic_slots = ?, updated_at = ? WHERE id = ?')
            .bind(pactMagicSlots ? JSON.stringify(pactMagicSlots) : char.pact_magic_slots, now, id).run()
        }
        rested.push(id)
      }
      if (rested.length === 0) return err(`No characters found for ${a.characterId ? `characterId ${a.characterId}` : `partyId ${a.partyId}`}`)
      return ok({ success: true, actionType: 'short_rest', characterIds: rested, healAmount: a.healAmount ?? 0, restored: ['pact_magic_slots', ...(a.healAmount ? ['hp'] : [])] })
    }
  }
}
