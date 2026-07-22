// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/spawn-manage.ts
// CombatEngine / preset expansion simplified to direct D1 writes.

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

export const ACTIONS = [
  'spawn_character',
  'spawn_encounter',
  'spawn_location',
  'add_to_encounter',
  'list_spawned',
  'place_character',
] as const
type SpawnAction = (typeof ACTIONS)[number]
const ALIASES: Record<string, SpawnAction> = {
  character: 'spawn_character',
  spawn_npc: 'spawn_character',
  create_character: 'spawn_character',
  encounter: 'spawn_encounter',
  new_encounter: 'spawn_encounter',
  setup_encounter: 'spawn_encounter',
  location: 'spawn_location',
  populate: 'spawn_location',
  add: 'add_to_encounter',
  join: 'add_to_encounter',
  insert: 'add_to_encounter',
  list: 'list_spawned',
  show_all: 'list_spawned',
  place: 'place_character',
  place_npc: 'place_character',
}

const StatBlock = z.object({
  str: z.number().default(10),
  dex: z.number().default(10),
  con: z.number().default(10),
  int: z.number().default(10),
  wis: z.number().default(10),
  cha: z.number().default(10),
})

const InputSchema = z.object({
  action: z.string(),
  name: z.string().optional(),
  characterType: z.enum(['pc', 'npc', 'enemy', 'neutral']).optional().default('enemy'),
  characterClass: z.string().optional().default('Fighter'),
  race: z.string().optional().default('Human'),
  level: z.number().int().min(1).max(20).optional().default(1),
  hp: z.number().int().optional(),
  maxHp: z.number().int().optional(),
  ac: z.number().int().optional().default(10),
  stats: StatBlock.optional(),
  encounterId: z.string().optional(),
  regionId: z.string().optional(),
  count: z.number().int().min(1).max(20).optional().default(1),
  initiative: z.number().optional(),
  position: z.object({ x: z.number().int(), y: z.number().int() }).optional(),
  characterId: z.string().optional(),
  worldId: z.string().optional(),
  q: z.number().int().optional(),
  r: z.number().int().optional(),
  mapId: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
})

export async function handleSpawnManage(
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
    case 'spawn_character': {
      if (!a.name) return err('"name" is required')
      const id = crypto.randomUUID()
      const stats = a.stats ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }
      const maxHp = a.maxHp ?? Math.max(1, a.level * 8)
      const hp = a.hp ?? maxHp
      await db
        .prepare(
          'INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, character_type, character_class, race, conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells, cantrips_known, currency, resource_pools, xp, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          id,
          a.name,
          JSON.stringify(stats),
          hp,
          maxHp,
          a.ac,
          a.level,
          a.characterType,
          a.characterClass,
          a.race,
          '[]',
          '[]',
          '[]',
          '[]',
          '[]',
          '[]',
          '[]',
          '{"gold":0,"silver":0,"copper":0}',
          '{}',
          0,
          now,
          now,
        )
        .run()
      return ok({
        success: true,
        actionType: 'spawn_character',
        characterId: id,
        name: a.name,
        characterType: a.characterType,
        level: a.level,
        hp,
        maxHp,
        ac: a.ac,
      })
    }
    case 'spawn_encounter': {
      const id = crypto.randomUUID()
      await db
        .prepare(
          'INSERT INTO encounters (id, region_id, tokens, round, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(id, a.regionId ?? null, '[]', 1, 'setup', now, now)
        .run()
      return ok({
        success: true,
        actionType: 'spawn_encounter',
        encounterId: id,
        regionId: a.regionId,
        status: 'setup',
      })
    }
    case 'spawn_location': {
      if (!a.name) return err('"name" is required for location spawn')
      const id = crypto.randomUUID()
      await db
        .prepare(
          'INSERT INTO room_nodes (id, name, base_description, biome_context, atmospherics, exits, entity_ids, created_at, updated_at, visited_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(id, a.name, a.name, 'dungeon', '[]', '[]', '[]', now, now, 0)
        .run()
      return ok({ success: true, actionType: 'spawn_location', roomId: id, name: a.name })
    }
    case 'add_to_encounter': {
      if (!a.encounterId || !a.characterId)
        return err('"encounterId" and "characterId" are required')
      const row = (await db
        .prepare('SELECT tokens FROM encounters WHERE id = ?')
        .bind(a.encounterId)
        .first()) as { tokens: string } | null
      if (!row) return err(`Encounter not found: ${a.encounterId}`)
      const char = (await db
        .prepare('SELECT id, name, character_type, hp, ac FROM characters WHERE id = ?')
        .bind(a.characterId)
        .first()) as Record<string, unknown> | null
      if (!char) return err(`Character not found: ${a.characterId}`)
      const tokens = JSON.parse(row.tokens ?? '[]') as object[]
      const token = {
        id: a.characterId,
        name: char.name,
        type: char.character_type,
        hp: char.hp,
        ac: char.ac,
        initiative: a.initiative ?? 0,
        position: a.position ?? { x: 0, y: 0 },
      }
      tokens.push(token)
      await db
        .prepare('UPDATE encounters SET tokens = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(tokens), now, a.encounterId)
        .run()
      return ok({
        success: true,
        actionType: 'add_to_encounter',
        encounterId: a.encounterId,
        characterId: a.characterId,
        token,
        totalCombatants: tokens.length,
      })
    }
    case 'list_spawned': {
      const { results } = await db
        .prepare(
          "SELECT id, name, character_type, level, hp, max_hp FROM characters WHERE character_type IN ('npc', 'enemy') ORDER BY created_at DESC LIMIT ?",
        )
        .bind(a.limit)
        .all()
      return ok({
        success: true,
        actionType: 'list_spawned',
        characters: results,
        count: results.length,
      })
    }
    case 'place_character': {
      if (!a.characterId) return err('"characterId" is required')
      if (a.q === undefined || a.r === undefined) return err('"q" and "r" are required')
      const char = (await db
        .prepare('SELECT id, name FROM characters WHERE id = ?')
        .bind(a.characterId)
        .first()) as { id: string; name: string } | null
      if (!char) return err(`Character not found: ${a.characterId}`)
      await db
        .prepare(
          'UPDATE characters SET current_hex_q = ?, current_hex_r = ?, map_id = ?, updated_at = ? WHERE id = ?',
        )
        .bind(a.q, a.r, a.mapId ?? 'main', now, a.characterId)
        .run()
      return ok({
        success: true,
        actionType: 'place_character',
        characterId: a.characterId,
        name: char.name,
        q: a.q,
        r: a.r,
        mapId: a.mapId ?? 'main',
      })
    }
  }
}
