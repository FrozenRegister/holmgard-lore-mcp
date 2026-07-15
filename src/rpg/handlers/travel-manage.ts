// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/travel-manage.ts
// room_searches table does not exist; loot results logged to event_logs.

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'
import { resolveEncounterCore } from './encounter-manage'
import { executeRoll } from './math-manage'

const ACTIONS = ['travel', 'loot', 'rest', 'move_hex'] as const
type TravelAction = typeof ACTIONS[number]
const ALIASES: Record<string, TravelAction> = {
  move: 'travel', go: 'travel', journey: 'travel', traverse: 'travel',
  search: 'loot', forage: 'loot', find: 'loot', gather: 'loot',
  camp: 'rest', sleep: 'rest', recover: 'rest', short_rest: 'rest', long_rest: 'rest',
  move_hex: 'move_hex', hex_move: 'move_hex', hex_travel: 'move_hex', move_to_hex: 'move_hex',
}

const InputSchema = z.object({
  action: z.string(),
  partyId: z.string().optional(),
  fromRoomId: z.string().optional(),
  toRoomId: z.string().optional(),
  direction: z.string().optional(),
  restType: z.enum(['short', 'long']).optional().default('short'),
  roomId: z.string().optional(),
  characterIds: z.array(z.string()).optional().default([]),
  // #280 — encounter.resolve integration. room_nodes (this handler's own
  // location model) has no world_id/x/y at all, so resolveEncounter can only
  // call the full engine when the caller also supplies worldId/x/y for the
  // world_map-side location matching this room; otherwise it falls back to
  // the pre-existing flat 15% flag.
  resolveEncounter: z.boolean().optional().default(false),
  worldId: z.string().optional(),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  toQ: z.number().int().optional(),
  toR: z.number().int().optional(),
  partySize: z.number().int().min(1).optional().default(1),
  timeOfDay: z.enum(['dawn', 'dusk', 'night', 'midday', 'day']).optional(),
  noiseLevel: z.enum(['loud', 'moderate', 'silent']).optional(),
  scentModifiers: z.array(z.enum(['blood', 'cooking', 'fire'])).optional().default([]),
  partyInjuries: z.array(z.string()).optional().default(['none']),
  weather: z.enum(['clear', 'rain', 'snow', 'fog']).optional(),
  includeInjuries: z.boolean().optional().default(true),
})

const LOOT_POOL: Array<{ name: string; rarity: string; weight: number }> = [
  { name: 'Gold Coins', rarity: 'common', weight: 40 },
  { name: 'Health Potion', rarity: 'common', weight: 25 },
  { name: 'Rope', rarity: 'common', weight: 15 },
  { name: 'Torch', rarity: 'common', weight: 15 },
  { name: 'Dagger', rarity: 'uncommon', weight: 10 },
  { name: 'Magic Dust', rarity: 'rare', weight: 4 },
  { name: 'Gemstone', rarity: 'rare', weight: 3 },
  { name: 'Artifact Shard', rarity: 'epic', weight: 1 },
]

function rollLoot(count: number): string[] {
  const totalWeight = LOOT_POOL.reduce((s, t) => s + t.weight, 0)
  const found: string[] = []
  for (let i = 0; i < count; i++) {
    let roll = Math.random() * totalWeight
    for (const entry of LOOT_POOL) {
      roll -= entry.weight
      if (roll <= 0) { found.push(entry.name); break }
    }
  }
  return found
}

export async function handleTravelManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'travel': {
      let targetRoom: Record<string, unknown> | null = null
      if (a.toRoomId) {
        targetRoom = await db.prepare('SELECT id, name, base_description, biome_context FROM room_nodes WHERE id = ?').bind(a.toRoomId).first() as Record<string, unknown> | null
        if (!targetRoom) return err(`Destination room not found: ${a.toRoomId}`)
      } else if (a.fromRoomId && a.direction) {
        const fromRoom = await db.prepare('SELECT exits FROM room_nodes WHERE id = ?').bind(a.fromRoomId).first() as { exits: string } | null
        if (!fromRoom) return err(`Origin room not found: ${a.fromRoomId}`)
        const exits = JSON.parse(fromRoom.exits ?? '[]') as Array<{ direction: string; targetRoomId: string }>
        const exit = exits.find(e => e.direction.toLowerCase() === a.direction!.toLowerCase())
        if (!exit) return err(`No exit in direction "${a.direction}" from room ${a.fromRoomId}`)
        targetRoom = await db.prepare('SELECT id, name, base_description, biome_context FROM room_nodes WHERE id = ?').bind(exit.targetRoomId).first() as Record<string, unknown> | null
        if (!targetRoom) return err('Target room not found')
      } else {
        return err('"toRoomId" or ("fromRoomId" + "direction") is required')
      }
      await db.prepare('UPDATE room_nodes SET visited_count = visited_count + 1, last_visited_at = ?, updated_at = ? WHERE id = ?').bind(now, now, targetRoom.id).run()

      if (a.resolveEncounter && a.worldId && a.x !== undefined && a.y !== undefined) {
        const encounter = await resolveEncounterCore(db, {
          worldId: a.worldId, x: a.x, y: a.y, partySize: a.partySize, timeOfDay: a.timeOfDay, noiseLevel: a.noiseLevel,
          scentModifiers: a.scentModifiers, partyInjuries: a.partyInjuries, weather: a.weather,
          includeInjuries: a.includeInjuries, characterIds: a.characterIds,
        })
        return ok({
          success: true, actionType: 'travel',
          arrived: true, roomId: targetRoom.id, roomName: targetRoom.name,
          description: targetRoom.base_description, biome: targetRoom.biome_context,
          encounter,
        })
      }

      // Legacy flat-chance flag — preserved for callers that don't track
      // world_map coordinates for their room_nodes (see #280's scope note:
      // full encounter.resolve requires worldId/x/y, which room_nodes itself
      // doesn't carry).
      // #210 — Use the shared dice engine (1d100 <= 15) instead of a flat
      // Math.random() < 0.15. Functionally identical (15% chance), but now
      // the roll is crypto-backed and logged to the calculations table.
      const hasEncounter = executeRoll('1d100').total <= 15
      return ok({
        success: true, actionType: 'travel',
        arrived: true, roomId: targetRoom.id, roomName: targetRoom.name,
        description: targetRoom.base_description, biome: targetRoom.biome_context,
        randomEncounter: hasEncounter,
        encounterHint: hasEncounter ? 'Something stirs in the shadows...' : null,
      })
    }
    case 'loot': {
      if (!a.roomId) return err('"roomId" is required')
      const room = await db.prepare('SELECT id, name FROM room_nodes WHERE id = ?').bind(a.roomId).first()
      if (!room) return err(`Room not found: ${a.roomId}`)
      // #210 — Use the shared dice engine (1d3) instead of ad-hoc Math.random().
      const count = executeRoll('1d3').total
      const found = rollLoot(count)
      await db.prepare('INSERT INTO event_logs (type, payload, timestamp) VALUES (?, ?, ?)').bind('room_search', JSON.stringify({ roomId: a.roomId, partyId: a.partyId, itemsFound: found }), now).run()
      return ok({ success: true, actionType: 'loot', roomId: a.roomId, itemsFound: found, count: found.length })
    }
    case 'rest': {
      if (a.characterIds.length === 0) return err('"characterIds" is required and must not be empty')
      const isLong = a.restType === 'long'
      const chars = await Promise.all(a.characterIds.map(id =>
        db.prepare('SELECT id, hp, max_hp, level FROM characters WHERE id = ?').bind(id).first() as Promise<{ id: string; hp: number; max_hp: number; level: number } | null>
      ))
      const results: Array<{ id: string; hpRestored: number; newHp: number }> = []
      for (const char of chars) {
        if (!char) continue
        const restore = isLong ? char.max_hp - char.hp : Math.min(Math.floor(char.level / 2 + 1) * 4, char.max_hp - char.hp)
        const newHp = char.hp + restore
        await db.prepare('UPDATE characters SET hp = ?, updated_at = ? WHERE id = ?').bind(newHp, now, char.id).run()
        results.push({ id: char.id, hpRestored: restore, newHp })
      }
      return ok({ success: true, actionType: 'rest', restType: a.restType, characters: results, hoursElapsed: isLong ? 8 : 1 })
    }
    case 'move_hex': {
      if (!a.partyId) return err('"partyId" is required')
      if (!a.worldId) return err('"worldId" is required')
      if (a.toQ === undefined || a.toR === undefined) return err('"toQ" and "toR" are required')
      const party = await db.prepare('SELECT id FROM parties WHERE id = ?').bind(a.partyId).first() as { id: string } | null
      if (!party) return err(`Party not found: ${a.partyId}`)
      const hex = await db.prepare('SELECT biome FROM hexes WHERE world_id = ? AND q = ? AND r = ?').bind(a.worldId, a.toQ, a.toR).first() as { biome: string } | null
      await db.prepare('UPDATE parties SET current_hex_q = ?, current_hex_r = ?, updated_at = ? WHERE id = ?').bind(a.toQ, a.toR, now, a.partyId).run()
      if (a.resolveEncounter) {
        const encounter = await resolveEncounterCore(db, { worldId: a.worldId, x: a.toQ, y: a.toR, partySize: a.partySize, timeOfDay: a.timeOfDay, noiseLevel: a.noiseLevel, scentModifiers: a.scentModifiers, partyInjuries: a.partyInjuries, weather: a.weather, includeInjuries: a.includeInjuries, characterIds: a.characterIds })
        return ok({ success: true, actionType: 'move_hex', partyId: a.partyId, q: a.toQ, r: a.toR, biome: hex?.biome ?? null, encounter })
      }
      return ok({ success: true, actionType: 'move_hex', partyId: a.partyId, q: a.toQ, r: a.toR, biome: hex?.biome ?? null })
    }
  }
}
