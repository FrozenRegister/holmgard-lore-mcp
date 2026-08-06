// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/travel-manage.ts
// room_searches table does not exist; loot results logged to event_logs.

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'
import { resolveEncounterCore } from './encounter-manage'
import { executeRoll } from './math-manage'
import { getBiomeRegistry, effectiveMovementCost } from './biome-manage'
import { computeLandingZone } from './world-map'
import { handleWeatherManage } from './weather-manage'

// #429 — transport modes for hex-grid travel. Base speeds are game-balance
// constants (not narrative/world data), so hardcoding them here is fine —
// unlike biome names, "how fast does a car go" isn't something a world's
// narrator needs to redefine per-campaign. Reused by world_map.distance
// (#430) for multi-hex ETA estimates.
export const TRAVEL_MODES = ['foot', 'horse', 'carriage', 'car', 'aircraft'] as const
export type TravelMode = (typeof TRAVEL_MODES)[number]
export const TRAVEL_MODE_BASE_SPEED_KM_PER_DAY: Record<TravelMode, number> = {
  foot: 5,
  horse: 35,
  carriage: 25,
  car: 400,
  aircraft: 600,
}

export interface FordingResult {
  cost: number
  swimRisk: boolean
}

// #431 — water_depth is a per-hex, narrator-set physical fact, layered
// ALONGSIDE #429's per-mode biome costs, not a replacement for them: a
// biome-registered "river" already expresses coarse passability without any
// per-hex data, but when a narrator sets an explicit water_depth on a hex it
// takes precedence over the biome's cost for that hex — a concrete depth is
// more authoritative than an abstract per-biome default. null means "no
// explicit fording rule here" and defers entirely to biome cost. Aircraft
// always ignores water_depth ("irrelevant" per both #429 and #431).
export function fordingCost(waterDepth: number | null, mode: TravelMode): FordingResult | null {
  if (waterDepth === null || mode === 'aircraft') return null
  if (waterDepth > 1.2) return { cost: 0, swimRisk: false }
  if (mode === 'carriage' || mode === 'car') return { cost: 0, swimRisk: false }
  // foot/horse, waterDepth <= 1.2 — fordable at half speed; swim risk (a CON
  // check, left to the narrator) applies once past the shallow (<=0.6m) tier.
  return { cost: 2.0, swimRisk: waterDepth > 0.6 }
}

export const ACTIONS = ['travel', 'loot', 'rest', 'move_hex', 'rappel', 'takeoff', 'land'] as const
type TravelAction = (typeof ACTIONS)[number]
const ALIASES: Record<string, TravelAction> = {
  move: 'travel',
  go: 'travel',
  journey: 'travel',
  traverse: 'travel',
  search: 'loot',
  forage: 'loot',
  find: 'loot',
  gather: 'loot',
  camp: 'rest',
  sleep: 'rest',
  recover: 'rest',
  short_rest: 'rest',
  long_rest: 'rest',
  move_hex: 'move_hex',
  hex_move: 'move_hex',
  hex_travel: 'move_hex',
  move_to_hex: 'move_hex',
  rappel: 'rappel',
  fast_rope: 'rappel',
  insert: 'rappel',
  takeoff: 'takeoff',
  launch: 'takeoff',
  land: 'land',
  touchdown: 'land',
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
  // location model) has no world_id/q/r at all, so resolveEncounter can only
  // call the full engine when the caller also supplies worldId/q/r for the
  // world_map-side location matching this room; otherwise it falls back to
  // the pre-existing flat 15% flag.
  resolveEncounter: z.boolean().optional().default(false),
  worldId: z.string().optional(),
  q: z.number().int().optional(),
  r: z.number().int().optional(),
  toQ: z.number().int().optional(),
  toR: z.number().int().optional(),
  partySize: z.number().int().min(1).optional().default(1),
  timeOfDay: z.enum(['dawn', 'dusk', 'night', 'midday', 'day']).optional(),
  noiseLevel: z.enum(['loud', 'moderate', 'silent']).optional(),
  scentModifiers: z
    .array(z.enum(['blood', 'cooking', 'fire']))
    .optional()
    .default([]),
  partyInjuries: z.array(z.string()).optional().default(['none']),
  weather: z.enum(['clear', 'rain', 'snow', 'fog']).optional(),
  includeInjuries: z.boolean().optional().default(true),
  // #429 — transport mode for move_hex. Defaults to foot, matching every
  // existing caller's implicit assumption before this field existed.
  mode: z.enum(TRAVEL_MODES).optional().default('foot'),
  // #437 — rappel action parameters
  characterId: z.string().optional(),
  height: z.enum(['low', 'high', 'extreme']).optional(),
  proficient: z.boolean().optional().default(false),
  // #436 — takeoff/land action parameters (slice 2)
  aircraftClass: z.string().optional(),
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
      if (roll <= 0) {
        found.push(entry.name)
        break
      }
    }
  }
  return found
}

export async function handleTravelManage(
  env: AppBindings,
  args: Record<string, unknown>,
): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map((i) => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'travel': {
      let targetRoom: Record<string, unknown> | null
      if (a.toRoomId) {
        targetRoom = (await db
          .prepare('SELECT id, name, base_description, biome_context FROM room_nodes WHERE id = ?')
          .bind(a.toRoomId)
          .first()) as Record<string, unknown> | null
        if (!targetRoom) return err(`Destination room not found: ${a.toRoomId}`)
      } else if (a.fromRoomId && a.direction) {
        const fromRoom = (await db
          .prepare('SELECT exits FROM room_nodes WHERE id = ?')
          .bind(a.fromRoomId)
          .first()) as { exits: string } | null
        if (!fromRoom) return err(`Origin room not found: ${a.fromRoomId}`)
        const exits = JSON.parse(fromRoom.exits ?? '[]') as Array<{
          direction: string
          targetRoomId: string
        }>
        const exit = exits.find((e) => e.direction.toLowerCase() === a.direction!.toLowerCase())
        if (!exit) return err(`No exit in direction "${a.direction}" from room ${a.fromRoomId}`)
        targetRoom = (await db
          .prepare('SELECT id, name, base_description, biome_context FROM room_nodes WHERE id = ?')
          .bind(exit.targetRoomId)
          .first()) as Record<string, unknown> | null
        if (!targetRoom) return err('Target room not found')
      } else {
        return err('"toRoomId" or ("fromRoomId" + "direction") is required')
      }
      await db
        .prepare(
          'UPDATE room_nodes SET visited_count = visited_count + 1, last_visited_at = ?, updated_at = ? WHERE id = ?',
        )
        .bind(now, now, targetRoom.id)
        .run()

      if (a.resolveEncounter && a.worldId && a.q !== undefined && a.r !== undefined) {
        const encounter = await resolveEncounterCore(db, {
          worldId: a.worldId,
          q: a.q,
          r: a.r,
          partySize: a.partySize,
          timeOfDay: a.timeOfDay,
          noiseLevel: a.noiseLevel,
          scentModifiers: a.scentModifiers,
          partyInjuries: a.partyInjuries,
          weather: a.weather,
          includeInjuries: a.includeInjuries,
          characterIds: a.characterIds,
        })
        return ok({
          success: true,
          actionType: 'travel',
          arrived: true,
          roomId: targetRoom.id,
          roomName: targetRoom.name,
          description: targetRoom.base_description,
          biome: targetRoom.biome_context,
          encounter,
        })
      }

      // Legacy flat-chance flag — preserved for callers that don't track
      // world_map coordinates for their room_nodes (see #280's scope note:
      // full encounter.resolve requires worldId/q/r, which room_nodes itself
      // doesn't carry).
      // #210 — Use the shared dice engine (1d100 <= 15) instead of a flat
      // Math.random() < 0.15. Functionally identical (15% chance), but now
      // the roll is crypto-backed and logged to the calculations table.
      const hasEncounter = executeRoll('1d100').total <= 15
      return ok({
        success: true,
        actionType: 'travel',
        arrived: true,
        roomId: targetRoom.id,
        roomName: targetRoom.name,
        description: targetRoom.base_description,
        biome: targetRoom.biome_context,
        randomEncounter: hasEncounter,
        encounterHint: hasEncounter ? 'Something stirs in the shadows...' : null,
      })
    }
    case 'loot': {
      if (!a.roomId) return err('"roomId" is required')
      const room = await db
        .prepare('SELECT id, name FROM room_nodes WHERE id = ?')
        .bind(a.roomId)
        .first()
      if (!room) return err(`Room not found: ${a.roomId}`)
      // #210 — Use the shared dice engine (1d3) instead of ad-hoc Math.random().
      const count = executeRoll('1d3').total
      const found = rollLoot(count)
      await db
        .prepare('INSERT INTO event_logs (type, payload, timestamp) VALUES (?, ?, ?)')
        .bind(
          'room_search',
          JSON.stringify({ roomId: a.roomId, partyId: a.partyId, itemsFound: found }),
          now,
        )
        .run()
      return ok({
        success: true,
        actionType: 'loot',
        roomId: a.roomId,
        itemsFound: found,
        count: found.length,
      })
    }
    case 'rest': {
      if (a.characterIds.length === 0)
        return err('"characterIds" is required and must not be empty')
      const isLong = a.restType === 'long'
      const chars = await Promise.all(
        a.characterIds.map(
          (id) =>
            db
              .prepare('SELECT id, hp, max_hp, level FROM characters WHERE id = ?')
              .bind(id)
              .first() as Promise<{ id: string; hp: number; max_hp: number; level: number } | null>,
        ),
      )
      const results: Array<{ id: string; hpRestored: number; newHp: number }> = []
      for (const char of chars) {
        if (!char) continue
        const restore = isLong
          ? char.max_hp - char.hp
          : Math.min(Math.floor(char.level / 2 + 1) * 4, char.max_hp - char.hp)
        const newHp = char.hp + restore
        await db
          .prepare('UPDATE characters SET hp = ?, updated_at = ? WHERE id = ?')
          .bind(newHp, now, char.id)
          .run()
        results.push({ id: char.id, hpRestored: restore, newHp })
      }
      return ok({
        success: true,
        actionType: 'rest',
        restType: a.restType,
        characters: results,
        hoursElapsed: isLong ? 8 : 1,
      })
    }
    case 'move_hex': {
      if (!a.partyId) return err('"partyId" is required')
      if (!a.worldId) return err('"worldId" is required')
      if (a.toQ === undefined || a.toR === undefined) return err('"toQ" and "toR" are required')
      const party = (await db
        .prepare('SELECT id FROM parties WHERE id = ?')
        .bind(a.partyId)
        .first()) as { id: string } | null
      if (!party) return err(`Party not found: ${a.partyId}`)
      const hex = (await db
        .prepare('SELECT biome, water_depth FROM hexes WHERE world_id = ? AND q = ? AND r = ?')
        .bind(a.worldId, a.toQ, a.toR)
        .first()) as { biome: string | null; water_depth: number | null } | null

      // #429 — mode-aware biome passability. A hex with no registered biome
      // (or a world with no biome registry at all) stays unrestricted,
      // matching getBiomeRegistry's existing backward-compatible fallback.
      let cost = 1.0
      if (hex?.biome) {
        const registry = await getBiomeRegistry(db, a.worldId)
        cost = effectiveMovementCost(registry.get(hex.biome), a.mode)
      }
      // #431 — an explicit water_depth on the hex overrides the biome cost
      // (see fordingCost's doc comment for why).
      let swimRisk = false
      const ford = fordingCost(hex?.water_depth ?? null, a.mode)
      if (ford) {
        cost = ford.cost
        swimRisk = ford.swimRisk
      }
      if (cost <= 0) {
        const reason = ford ? 'water too deep to ford' : `biome "${hex?.biome}"`
        return err(`Hex (${a.toQ}, ${a.toR}) is impassable for mode "${a.mode}" — ${reason}`)
      }
      const effectiveSpeedKmPerDay = TRAVEL_MODE_BASE_SPEED_KM_PER_DAY[a.mode] / cost

      await db
        .prepare(
          'UPDATE parties SET current_hex_q = ?, current_hex_r = ?, updated_at = ? WHERE id = ?',
        )
        .bind(a.toQ, a.toR, now, a.partyId)
        .run()
      if (a.resolveEncounter) {
        const encounter = await resolveEncounterCore(db, {
          worldId: a.worldId,
          q: a.toQ,
          r: a.toR,
          partySize: a.partySize,
          timeOfDay: a.timeOfDay,
          noiseLevel: a.noiseLevel,
          scentModifiers: a.scentModifiers,
          partyInjuries: a.partyInjuries,
          weather: a.weather,
          includeInjuries: a.includeInjuries,
          characterIds: a.characterIds,
        })
        return ok({
          success: true,
          actionType: 'move_hex',
          partyId: a.partyId,
          q: a.toQ,
          r: a.toR,
          biome: hex?.biome ?? null,
          mode: a.mode,
          effectiveSpeedKmPerDay,
          ...(swimRisk ? { swimRisk: true } : {}),
          encounter,
        })
      }
      return ok({
        success: true,
        actionType: 'move_hex',
        partyId: a.partyId,
        q: a.toQ,
        r: a.toR,
        biome: hex?.biome ?? null,
        mode: a.mode,
        effectiveSpeedKmPerDay,
        ...(swimRisk ? { swimRisk: true } : {}),
      })
    }
    case 'rappel': {
      // #437 — rappel action for rotorcraft personnel insertion
      if (!a.characterId) return err('"characterId" is required')
      if (!a.height) return err('"height" is required')
      if (!a.worldId) return err('"worldId" is required')

      // Height-tier DEX modifier from #437's issue spec
      const heightTierModifier: Record<string, number> = {
        low: 0,
        high: -2,
        extreme: -5,
      }
      const dexModifier = heightTierModifier[a.height]

      // Untrained + extreme height → automatic failure, no roll attempted
      if (!a.proficient && a.height === 'extreme') {
        return ok({
          success: true,
          outcome: 'not_attempted',
          reason: 'Untrained personnel cannot attempt extreme height rappel',
          damage: 0,
          effects: [],
        })
      }

      // Determine dice notation based on proficiency
      // Untrained (non-extreme): disadvantage (2d20kl1 = keep lowest 1 of 2d20)
      // Proficient: standard single roll (1d20)
      const diceExpr = a.proficient ? '1d20' : '2d20kl1'
      const roll = executeRoll(diceExpr)
      const rollTotal = roll.total + dexModifier

      // DC 12 placeholder — tune once a broader skill-DC convention exists
      const DC = 12
      const margin = rollTotal - DC

      // Determine outcome via injury table from #437
      let outcome: string
      let damage = 0
      const effects: string[] = []

      if ('critical' in roll && roll.critical === 'failure') {
        // Natural 1: equipment failure, fall from full height, damage ×1.5
        outcome = 'critical_fail'
        const baseDamage4d6 = executeRoll('4d6').total
        const extraDamageByHeight: Record<string, number> = {
          low: 0,
          high: executeRoll('1d6').total,
          extreme: executeRoll('2d6').total,
        }
        damage = Math.floor((baseDamage4d6 + extraDamageByHeight[a.height]) * 1.5)
        effects.push('equipment failure')
        effects.push('fall from full height')
      } else if (margin >= 0) {
        // Success: clean landing
        outcome = 'success'
      } else if (margin >= -5) {
        // Fail by ≤5: rough landing, 1d4 damage, half speed for 1 hour
        outcome = 'rough_landing'
        damage = executeRoll('1d4').total
        effects.push('twisted ankle')
        effects.push('half speed for 1 hour')
      } else if (margin >= -10) {
        // Fail by 6–10: hard landing, 2d6 damage, half speed 24h + disadvantage on DEX
        outcome = 'hard_landing'
        damage = executeRoll('2d6').total
        effects.push('sprain or minor fracture')
        effects.push('half speed for 24 hours')
        effects.push('disadvantage on DEX')
      } else {
        // Fail by >10: fall, 4d6 + 1d6 per height tier above low
        outcome = 'fall'
        const baseDamage4d6 = executeRoll('4d6').total
        const extraDamageByHeight: Record<string, number> = {
          low: 0,
          high: executeRoll('1d6').total,
          extreme: executeRoll('2d6').total,
        }
        damage = baseDamage4d6 + extraDamageByHeight[a.height]
        effects.push('possible fracture')
        effects.push('possible unconsciousness')
      }

      return ok({
        success: true,
        outcome,
        roll: {
          expr: diceExpr,
          total: roll.total,
          modifier: dexModifier,
          final: rollTotal,
          dc: DC,
          margin,
          critical: roll.critical ?? null,
        },
        damage,
        effects,
      })
    }
    case 'takeoff': {
      // #436 — aircraft takeoff action (slice 2)
      if (!a.characterId) return err('"characterId" is required')
      if (!a.worldId) return err('"worldId" is required')
      if (a.q === undefined || a.r === undefined) return err('"q" and "r" are required')
      if (!a.aircraftClass) return err('"aircraftClass" is required')

      // Fetch the departure hex
      const departureHex = (await db
        .prepare('SELECT biome, elevation FROM hexes WHERE world_id = ? AND q = ? AND r = ?')
        .bind(a.worldId, a.q, a.r)
        .first()) as { biome: string | null; elevation: number | null } | null

      if (!departureHex) return err(`Hex (${a.q}, ${a.r}) not found`)

      // Compute landing zone using same logic as world_map.hexes action
      const biome = (departureHex.biome as string) || ''
      const elevation = (departureHex.elevation as number) || 0

      // Compute slope: maximum absolute elevation difference to any neighbor
      // (using a 3-hex radius to approximate neighbors in the query window)
      let maxSlope = 0
      const HEX_DIRECTIONS: Array<[number, number]> = [
        [1, 0],
        [0, 1],
        [-1, 1],
        [-1, 0],
        [0, -1],
        [1, -1],
      ]
      const neighbors = await Promise.all(
        HEX_DIRECTIONS.map(
          (dir) =>
            db
              .prepare('SELECT elevation FROM hexes WHERE world_id = ? AND q = ? AND r = ?')
              .bind(a.worldId, a.q! + dir[0], a.r! + dir[1])
              .first() as Promise<{ elevation: number | null } | null>,
        ),
      )
      for (const neighbor of neighbors) {
        if (neighbor) {
          const neighborElevation = (neighbor.elevation as number) || 0
          const elevationDiff = Math.abs(elevation - neighborElevation)
          maxSlope = Math.max(maxSlope, elevationDiff)
        }
      }

      const landingZone = computeLandingZone(biome, maxSlope)

      // Aircraft class minimum LZ requirements (from #436 issue spec)
      const aircraftMinLz: Record<string, string[]> = {
        light_fixed_wing: ['clearing', 'improved_strip', 'runway', 'road'],
        medium_fixed_wing: ['improved_strip', 'runway'],
        heavy_fixed_wing: ['runway'],
        light_rotorcraft: ['clearing', 'rooftop', 'slope'],
        heavy_rotorcraft: ['clearing', 'rooftop'],
        floatplane: ['water'],
        amphibious: ['water', 'clearing', 'improved_strip', 'runway', 'road'],
      }

      const minLzClasses = aircraftMinLz[a.aircraftClass] || []

      // LZ class check — if this fails, no roll is attempted
      if (!minLzClasses.includes(landingZone || '')) {
        return ok({
          success: true,
          phase: 'takeoff',
          outcome: 'rejected',
          reason: `Aircraft class "${a.aircraftClass}" cannot take off from "${landingZone || 'unlandable'}" landing zone`,
          landingZone: landingZone || 'unlandable',
          fuelWasted: false,
        })
      }

      // Weather gate: fetch current weather via weather-manage handler
      const weatherResult = await handleWeatherManage(env, {
        action: 'get_forecast',
        worldId: a.worldId,
      })
      const weatherBody = JSON.parse(weatherResult.content[0].text) as Record<string, unknown>

      const weatherData = weatherBody as Record<string, unknown>
      let weatherBlocks = false
      let weatherReason = ''

      if (weatherData.found) {
        const conditions = (weatherData.conditions as string) || ''
        const windSpeed = (weatherData.wind_speed as number) || 0
        const visibility = (weatherData.visibility as string) || 'unlimited'
        const precipType = (weatherData.precipitation_type as string) || 'none'

        // Weather gate table from #436
        if (conditions === 'storm') {
          weatherBlocks = true
          weatherReason = 'Storm conditions prohibit takeoff'
        } else if (precipType === 'snow' || precipType === 'hail' || precipType === 'sleet') {
          weatherBlocks = true
          weatherReason = `Heavy ${precipType} prohibits takeoff`
        } else if (visibility === 'nil' || visibility === 'poor') {
          weatherBlocks = true
          weatherReason = 'Visibility below VFR minimums without IFR equipment'
        } else {
          // Crosswind check (simplified: assume wind perpendicular, class-based limits)
          const crosswindLimits: Record<string, number> = {
            light_fixed_wing: 15,
            medium_fixed_wing: 20,
            heavy_fixed_wing: 25,
            light_rotorcraft: 30,
            heavy_rotorcraft: 25,
            floatplane: 12,
            amphibious: 18,
          }
          const limit = crosswindLimits[a.aircraftClass] || 20
          if (windSpeed > limit) {
            weatherBlocks = true
            weatherReason = `Crosswind (${windSpeed} kph) exceeds limit (${limit} kph) for this class`
          }
        }
      }
      // If weather.found === false, proceed as clear (no block)

      if (weatherBlocks) {
        return ok({
          success: true,
          phase: 'takeoff',
          outcome: 'rejected',
          reason: weatherReason,
          landingZone,
          fuelWasted: false,
        })
      }

      // Difficulty modifier based on landing zone class
      const lzDifficultyMod: Record<string, number> = {
        runway: 0,
        improved_strip: 0,
        clearing: -2,
        road: -2,
        rooftop: -4,
        slope: -3,
        water: -2,
        unlandable: -5,
      }
      const difficultyMod = lzDifficultyMod[landingZone || 'unlandable'] || -5

      // Pilot skill check (using standard 1d20 roll)
      const roll = executeRoll('1d20')
      const rollTotal = roll.total + difficultyMod

      // DC 12 placeholder — tune once a broader skill-DC convention exists
      const DC = 12
      const margin = rollTotal - DC

      // Takeoff outcomes from #436
      let outcome: string
      let damage = 0
      const effects: string[] = []
      let fuelWasted = false

      if ('critical' in roll && roll.critical === 'failure') {
        // Natural 1: catastrophic crash on runway overrun
        outcome = 'crash'
        damage = executeRoll('2d6').total
        effects.push('runway overrun')
        effects.push('aircraft damaged')
        fuelWasted = true
      } else if (margin >= 0) {
        // Success: clean takeoff
        outcome = 'success'
      } else if (margin >= -5) {
        // Fail by ≤5: aborted takeoff, fuel wasted
        outcome = 'aborted'
        fuelWasted = true
      } else {
        // Fail by >5: catastrophic crash on runway overrun
        outcome = 'crash'
        damage = executeRoll('2d6').total
        effects.push('runway overrun')
        effects.push('aircraft damaged')
        fuelWasted = true
      }

      return ok({
        success: true,
        phase: 'takeoff',
        outcome,
        landingZone,
        aircraftClass: a.aircraftClass,
        roll: {
          expr: '1d20',
          total: roll.total,
          modifier: difficultyMod,
          final: rollTotal,
          dc: DC,
          margin,
          critical: roll.critical ?? null,
        },
        damage,
        effects,
        fuelWasted,
      })
    }
    case 'land': {
      // #436 — aircraft landing action (slice 2)
      if (!a.characterId) return err('"characterId" is required')
      if (!a.worldId) return err('"worldId" is required')
      if (a.toQ === undefined || a.toR === undefined) return err('"toQ" and "toR" are required')
      if (!a.aircraftClass) return err('"aircraftClass" is required')

      // Fetch the destination hex
      const destinationHex = (await db
        .prepare('SELECT biome, elevation FROM hexes WHERE world_id = ? AND q = ? AND r = ?')
        .bind(a.worldId, a.toQ, a.toR)
        .first()) as { biome: string | null; elevation: number | null } | null

      if (!destinationHex) return err(`Hex (${a.toQ}, ${a.toR}) not found`)

      // Compute landing zone using same logic as world_map.hexes action
      const biome = (destinationHex.biome as string) || ''
      const elevation = (destinationHex.elevation as number) || 0

      // Compute slope: maximum absolute elevation difference to any neighbor
      let maxSlope = 0
      const HEX_DIRECTIONS: Array<[number, number]> = [
        [1, 0],
        [0, 1],
        [-1, 1],
        [-1, 0],
        [0, -1],
        [1, -1],
      ]
      const neighbors = await Promise.all(
        HEX_DIRECTIONS.map(
          (dir) =>
            db
              .prepare('SELECT elevation FROM hexes WHERE world_id = ? AND q = ? AND r = ?')
              .bind(a.worldId, a.toQ! + dir[0], a.toR! + dir[1])
              .first() as Promise<{ elevation: number | null } | null>,
        ),
      )
      for (const neighbor of neighbors) {
        if (neighbor) {
          const neighborElevation = (neighbor.elevation as number) || 0
          const elevationDiff = Math.abs(elevation - neighborElevation)
          maxSlope = Math.max(maxSlope, elevationDiff)
        }
      }

      const landingZone = computeLandingZone(biome, maxSlope)

      // Aircraft class minimum LZ requirements (from #436 issue spec)
      const aircraftMinLz: Record<string, string[]> = {
        light_fixed_wing: ['clearing', 'improved_strip', 'runway', 'road'],
        medium_fixed_wing: ['improved_strip', 'runway'],
        heavy_fixed_wing: ['runway'],
        light_rotorcraft: ['clearing', 'rooftop', 'slope'],
        heavy_rotorcraft: ['clearing', 'rooftop'],
        floatplane: ['water'],
        amphibious: ['water', 'clearing', 'improved_strip', 'runway', 'road'],
      }

      const minLzClasses = aircraftMinLz[a.aircraftClass] || []

      // LZ class check — if this fails, no roll is attempted
      if (!minLzClasses.includes(landingZone || '')) {
        return ok({
          success: true,
          phase: 'land',
          outcome: 'rejected',
          reason: `Aircraft class "${a.aircraftClass}" cannot land on "${landingZone || 'unlandable'}" landing zone`,
          landingZone: landingZone || 'unlandable',
          fuelWasted: false,
        })
      }

      // Weather gate: fetch current weather via weather-manage handler
      const weatherResult = await handleWeatherManage(env, {
        action: 'get_forecast',
        worldId: a.worldId,
      })
      const weatherBody = JSON.parse(weatherResult.content[0].text) as Record<string, unknown>

      const weatherData = weatherBody as Record<string, unknown>
      let weatherBlocks = false
      let weatherReason = ''

      if (weatherData.found) {
        const conditions = (weatherData.conditions as string) || ''
        const windSpeed = (weatherData.wind_speed as number) || 0
        const visibility = (weatherData.visibility as string) || 'unlimited'
        const precipType = (weatherData.precipitation_type as string) || 'none'

        // Weather gate table from #436
        if (conditions === 'storm') {
          weatherBlocks = true
          weatherReason = 'Storm conditions prohibit landing'
        } else if (precipType === 'snow' || precipType === 'hail' || precipType === 'sleet') {
          weatherBlocks = true
          weatherReason = `Heavy ${precipType} prohibits landing`
        } else if (visibility === 'nil' || visibility === 'poor') {
          weatherBlocks = true
          weatherReason = 'Visibility below VFR minimums without IFR equipment'
        } else {
          // Crosswind check (simplified: assume wind perpendicular, class-based limits)
          const crosswindLimits: Record<string, number> = {
            light_fixed_wing: 15,
            medium_fixed_wing: 20,
            heavy_fixed_wing: 25,
            light_rotorcraft: 30,
            heavy_rotorcraft: 25,
            floatplane: 12,
            amphibious: 18,
          }
          const limit = crosswindLimits[a.aircraftClass] || 20
          if (windSpeed > limit) {
            weatherBlocks = true
            weatherReason = `Crosswind (${windSpeed} kph) exceeds limit (${limit} kph) for this class`
          }
        }
      }
      // If weather.found === false, proceed as clear (no block)

      if (weatherBlocks) {
        return ok({
          success: true,
          phase: 'land',
          outcome: 'rejected',
          reason: weatherReason,
          landingZone,
          fuelWasted: false,
        })
      }

      // Difficulty modifier based on landing zone class
      const lzDifficultyMod: Record<string, number> = {
        runway: 0,
        improved_strip: 0,
        clearing: -2,
        road: -2,
        rooftop: -4,
        slope: -3,
        water: -2,
        unlandable: -5,
      }
      const difficultyMod = lzDifficultyMod[landingZone || 'unlandable'] || -5

      // Pilot skill check (using standard 1d20 roll)
      const roll = executeRoll('1d20')
      const rollTotal = roll.total + difficultyMod

      // DC 12 placeholder — tune once a broader skill-DC convention exists
      const DC = 12
      const margin = rollTotal - DC

      // Landing outcomes from #436
      let outcome: string
      let damage = 0
      const effects: string[] = []
      let fuelWasted = false

      if ('critical' in roll && roll.critical === 'failure') {
        // Natural 1: crash
        outcome = 'crash'
        damage = executeRoll('2d6').total
        effects.push('aircraft damaged')
        effects.push('possible injuries to occupants')
        fuelWasted = true
      } else if (margin >= 0) {
        // Success: clean landing
        outcome = 'success'
      } else if (margin >= -5) {
        // Fail by ≤5: go-around, fuel wasted
        outcome = 'go_around'
        fuelWasted = true
      } else if (margin >= -10) {
        // Fail by 6-10: hard landing, aircraft damage
        outcome = 'hard_landing'
        damage = executeRoll('1d6').total
        effects.push('landing gear stress')
        effects.push('airframe shock')
      } else {
        // Fail by >10: crash
        outcome = 'crash'
        damage = executeRoll('3d6').total
        effects.push('aircraft damaged')
        effects.push('possible injuries to occupants')
        fuelWasted = true
      }

      return ok({
        success: true,
        phase: 'land',
        outcome,
        landingZone,
        aircraftClass: a.aircraftClass,
        roll: {
          expr: '1d20',
          total: roll.total,
          modifier: difficultyMod,
          final: rollTotal,
          dc: DC,
          margin,
          critical: roll.critical ?? null,
        },
        damage,
        effects,
        fuelWasted,
      })
    }
  }
}
