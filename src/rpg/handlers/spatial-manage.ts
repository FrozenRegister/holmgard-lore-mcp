// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/spatial-manage.ts
// room_edges table does not exist in schema — exits stored as JSON in room_nodes.exits.
// room_networks renamed to node_networks in schema.
//
// #290 (#274 follow-up) — room_nodes.biome_context is no longer a hardcoded
// 8-value DB CHECK constraint (see migration 0015). `biome` is now validated
// against the per-world dynamic biome registry (biome-manage.ts's
// getBiomeRegistry), matching the exact pattern already used by
// world-map.ts's patch/batch actions: if the target world has zero
// registered biomes, validation is skipped entirely (backward compatible
// for worlds that never ran biome.seed_defaults); otherwise the biome name
// must be one of that world's registered biomes. Validation only runs when
// a `worldId` is given — a room created with no worldId has nothing to
// validate against, same as world_map's own convention.

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'
import { getBiomeRegistry } from './biome-manage'

export const ACTIONS = ['look', 'generate', 'update', 'get_exits', 'move', 'list', 'network_create', 'network_get', 'network_list'] as const
type SpatialAction = typeof ACTIONS[number]
const ALIASES: Record<string, SpatialAction> = {
  describe: 'look', observe: 'look', inspect: 'look',
  create: 'generate', new_room: 'generate', spawn: 'generate',
  edit: 'update', modify: 'update', patch: 'update',
  exits: 'get_exits', doors: 'get_exits',
  go: 'move', travel: 'move', walk: 'move',
  rooms: 'list', all_rooms: 'list',
  create_network: 'network_create', new_network: 'network_create',
  get_network: 'network_get', fetch_network: 'network_get',
  list_networks: 'network_list', networks: 'network_list',
}

const ExitSchema = z.object({ direction: z.string(), targetRoomId: z.string(), label: z.string().optional() })

const InputSchema = z.object({
  action: z.string(),
  roomId: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  biome: z.string().optional().default('dungeon'),
  atmosphere: z.array(z.string()).optional().default([]),
  exits: z.array(ExitSchema).optional().default([]),
  entityIds: z.array(z.string()).optional().default([]),
  direction: z.string().optional(),
  characterId: z.string().optional(),
  networkId: z.string().optional(),
  worldId: z.string().optional(),
  networkType: z.enum(['cluster', 'linear']).optional().default('cluster'),
  nodeIds: z.array(z.string()).optional().default([]),
  limit: z.number().int().min(1).max(100).optional().default(20),
  worldIdFilter: z.string().optional(),
})

// Shared by `generate`/`update` — returns an error message string when the
// biome isn't registered for this world, or null when validation passes
// (including the "no worldId given" / "world has zero registered biomes"
// backward-compatible skip cases).
async function validateBiome(db: D1Database, worldId: string | undefined, biome: string): Promise<string | null> {
  if (!worldId) return null
  const registry = await getBiomeRegistry(db, worldId)
  if (registry.size === 0) return null
  if (!registry.has(biome)) {
    return `Unknown biome "${biome}" for this world. Registered biomes: ${[...registry.keys()].sort().join(', ')}`
  }
  return null
}

export async function handleSpatialManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'look': {
      if (!a.roomId) return err('"roomId" is required')
      const room = await db.prepare('SELECT * FROM room_nodes WHERE id = ?').bind(a.roomId).first() as Record<string, unknown> | null
      if (!room) return err(`Room not found: ${a.roomId}`)
      const exits = JSON.parse(room.exits as string ?? '[]')
      const entityIds = JSON.parse(room.entity_ids as string ?? '[]')
      await db.prepare('UPDATE room_nodes SET visited_count = visited_count + 1, last_visited_at = ?, updated_at = ? WHERE id = ?').bind(now, now, a.roomId).run()
      return ok({
        success: true, actionType: 'look', roomId: a.roomId,
        name: room.name, description: room.base_description,
        biome: room.biome_context, worldId: room.world_id, atmosphere: JSON.parse(room.atmospherics as string ?? '[]'),
        exits, entityCount: entityIds.length, entityIds,
        visitedCount: (room.visited_count as number ?? 0) + 1,
      })
    }
    case 'generate': {
      if (!a.name) return err('"name" is required')
      const biomeError = await validateBiome(db, a.worldId, a.biome)
      if (biomeError) return err(biomeError)
      const id = crypto.randomUUID()
      const desc = a.description && a.description.trim().length >= 10 ? a.description : `${a.name}: a location waiting to be explored.`
      await db.prepare('INSERT INTO room_nodes (id, name, base_description, biome_context, atmospherics, exits, entity_ids, created_at, updated_at, visited_count, world_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, a.name, desc, a.biome, JSON.stringify(a.atmosphere), JSON.stringify(a.exits), JSON.stringify(a.entityIds), now, now, 0, a.worldId ?? null).run()
      return ok({ success: true, actionType: 'generate', roomId: id, name: a.name, biome: a.biome, worldId: a.worldId ?? null, exitCount: a.exits.length })
    }
    case 'update': {
      if (!a.roomId) return err('"roomId" is required')
      const room = await db.prepare('SELECT * FROM room_nodes WHERE id = ?').bind(a.roomId).first() as Record<string, unknown> | null
      if (!room) return err(`Room not found: ${a.roomId}`)
      if (a.biome !== undefined) {
        const effectiveWorldId = a.worldId ?? (room.world_id as string | null) ?? undefined
        const biomeError = await validateBiome(db, effectiveWorldId, a.biome)
        if (biomeError) return err(biomeError)
      }
      const updates: string[] = ['updated_at = ?']
      const binds: unknown[] = [now]
      if (a.name !== undefined) { updates.unshift('name = ?'); binds.unshift(a.name) }
      if (a.description !== undefined && a.description.trim().length >= 10) { updates.unshift('base_description = ?'); binds.unshift(a.description) }
      if (a.biome !== undefined) { updates.unshift('biome_context = ?'); binds.unshift(a.biome) }
      if (a.atmosphere.length > 0) { updates.unshift('atmospherics = ?'); binds.unshift(JSON.stringify(a.atmosphere)) }
      if (a.exits.length > 0) { updates.unshift('exits = ?'); binds.unshift(JSON.stringify(a.exits)) }
      if (a.worldId !== undefined) { updates.unshift('world_id = ?'); binds.unshift(a.worldId) }
      binds.push(a.roomId)
      await db.prepare(`UPDATE room_nodes SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run()
      return ok({ success: true, actionType: 'update', roomId: a.roomId })
    }
    case 'get_exits': {
      if (!a.roomId) return err('"roomId" is required')
      const room = await db.prepare('SELECT exits FROM room_nodes WHERE id = ?').bind(a.roomId).first() as { exits: string } | null
      if (!room) return err(`Room not found: ${a.roomId}`)
      const exits = JSON.parse(room.exits ?? '[]') as Array<{ direction: string; targetRoomId: string; label?: string }>
      return ok({ success: true, actionType: 'get_exits', roomId: a.roomId, exits, count: exits.length })
    }
    case 'move': {
      if (!a.roomId || !a.direction) return err('"roomId" (current) and "direction" are required')
      const room = await db.prepare('SELECT exits FROM room_nodes WHERE id = ?').bind(a.roomId).first() as { exits: string } | null
      if (!room) return err(`Room not found: ${a.roomId}`)
      const exits = JSON.parse(room.exits ?? '[]') as Array<{ direction: string; targetRoomId: string }>
      const exit = exits.find(e => e.direction.toLowerCase() === a.direction!.toLowerCase())
      if (!exit) return err(`No exit in direction "${a.direction}" from room ${a.roomId}`)
      const nextRoom = await db.prepare('SELECT id, name, base_description FROM room_nodes WHERE id = ?').bind(exit.targetRoomId).first() as Record<string, unknown> | null
      if (!nextRoom) return err(`Target room not found: ${exit.targetRoomId}`)
      return ok({ success: true, actionType: 'move', fromRoomId: a.roomId, direction: a.direction, toRoomId: nextRoom.id, roomName: nextRoom.name, description: nextRoom.base_description })
    }
    case 'list': {
      let query = 'SELECT id, name, biome_context, visited_count, world_id FROM room_nodes'
      const binds: unknown[] = []
      if (a.worldIdFilter) { query += ' WHERE world_id = ?'; binds.push(a.worldIdFilter) }
      query += ' ORDER BY created_at DESC LIMIT ?'
      binds.push(a.limit)
      const { results } = await db.prepare(query).bind(...binds).all()
      return ok({ success: true, actionType: 'list', rooms: results, count: results.length })
    }
    case 'network_create': {
      if (!a.name || !a.worldId) return err('"name" and "worldId" are required')
      const id = crypto.randomUUID()
      await db.prepare('INSERT INTO node_networks (id, name, type, world_id, center_x, center_y, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, a.name, a.networkType, a.worldId, 0, 0, now, now).run()
      return ok({ success: true, actionType: 'network_create', networkId: id, name: a.name, worldId: a.worldId, type: a.networkType })
    }
    case 'network_get': {
      if (!a.networkId) return err('"networkId" is required')
      const net = await db.prepare('SELECT * FROM node_networks WHERE id = ?').bind(a.networkId).first() as Record<string, unknown> | null
      if (!net) return err(`Network not found: ${a.networkId}`)
      const { results: nodes } = await db.prepare('SELECT id, name, biome_context FROM room_nodes WHERE network_id = ?').bind(a.networkId).all()
      return ok({ success: true, actionType: 'network_get', network: net, nodes, nodeCount: nodes.length })
    }
    case 'network_list': {
      const { results } = await db.prepare('SELECT id, name, type, world_id, created_at FROM node_networks ORDER BY created_at DESC LIMIT ?').bind(a.limit).all()
      return ok({ success: true, actionType: 'network_list', networks: results, count: results.length })
    }
  }
}
