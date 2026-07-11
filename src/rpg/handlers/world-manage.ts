// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/world-manage.ts

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError, CRUD_ALIASES } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'
import { seedDefaultBiomes } from './biome-manage'

const ACTIONS = ['create', 'get', 'list', 'delete', 'update', 'generate', 'get_state'] as const
type WorldAction = typeof ACTIONS[number]
const ALIASES: Record<string, WorldAction> = { ...CRUD_ALIASES, generate: 'generate', get_state: 'get_state', state: 'get_state' } as Record<string, WorldAction>

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  worldId: z.string().optional(),
  name: z.string().optional(),
  seed: z.string().optional(),
  width: z.number().int().min(10).max(1000).optional(),
  height: z.number().int().min(10).max(1000).optional(),
  landRatio: z.number().min(0.1).max(0.9).optional(),
  environment: z.record(z.unknown()).optional(),
  theme: z.string().optional(),
})

export async function handleWorldManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
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
      const seed = a.seed ?? crypto.randomUUID().slice(0, 8)
      const width = a.width ?? 100
      const height = a.height ?? 100
      await db.prepare('INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, a.name, seed, width, height, now, now).run()
      await seedDefaultBiomes(db, id)
      return ok({ success: true, actionType: 'create', worldId: id, name: a.name, seed, width, height })
    }
    case 'get': {
      const targetId = a.id ?? a.worldId
      if (!targetId) return err('"id" or "worldId" is required')
      const row = await db.prepare('SELECT * FROM worlds WHERE id = ?').bind(targetId).first()
      if (!row) return err(`World not found: ${targetId}`)
      return ok({ success: true, actionType: 'get', world: row })
    }
    case 'list': {
      const { results } = await db.prepare('SELECT id, name, seed, width, height, created_at FROM worlds ORDER BY created_at DESC').all()
      return ok({ success: true, actionType: 'list', worlds: results, count: results.length })
    }
    case 'delete': {
      const targetId = a.id ?? a.worldId
      if (!targetId) return err('"id" or "worldId" is required')
      await db.prepare('DELETE FROM worlds WHERE id = ?').bind(targetId).run()
      return ok({ success: true, actionType: 'delete', worldId: targetId })
    }
    case 'update': {
      const targetId = a.id ?? a.worldId
      if (!targetId) return err('"id" or "worldId" is required')
      const sets: string[] = ['updated_at = ?']
      const vals: unknown[] = [now]
      if (a.name) { sets.push('name = ?'); vals.push(a.name) }
      if (a.environment) { sets.push('seed = ?'); vals.push(JSON.stringify(a.environment)) }
      vals.push(targetId)
      await db.prepare(`UPDATE worlds SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
      return ok({ success: true, actionType: 'update', worldId: targetId })
    }
    case 'generate': {
      if (!a.name) return err('"name" is required for generate')
      const id = crypto.randomUUID()
      const seed = a.seed ?? crypto.randomUUID().slice(0, 8)
      const width = a.width ?? 100
      const height = a.height ?? 100
      await db.prepare('INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, a.name, seed, width, height, now, now).run()
      await seedDefaultBiomes(db, id)
      return ok({ success: true, actionType: 'generate', worldId: id, name: a.name, seed, width, height, note: 'World created with seed. Tile generation is a separate process.' })
    }
    case 'get_state': {
      const targetId = a.id ?? a.worldId
      if (!targetId) return err('"id" or "worldId" is required')
      const world = await db.prepare('SELECT * FROM worlds WHERE id = ?').bind(targetId).first()
      if (!world) return err(`World not found: ${a.id}`)
      const [nationsRes, partiesRes, turnState] = await Promise.all([
        db.prepare('SELECT id, name, leader FROM nations WHERE world_id = ?').bind(a.id).all(),
        db.prepare('SELECT id, name, status FROM parties WHERE world_id = ?').bind(a.id).all(),
        db.prepare('SELECT * FROM turn_state WHERE world_id = ?').bind(a.id).first(),
      ])
      return ok({ success: true, actionType: 'get_state', world, nations: nationsRes.results, parties: partiesRes.results, turnState })
    }
  }
}
