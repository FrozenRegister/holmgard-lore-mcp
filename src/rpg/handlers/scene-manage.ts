// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/scene-manage.ts
// scenes table: id, world_id, title, when_label, place_label, narration,
//               engine_state, participants, previous_scene_id, created_at
// (no status, mood, tags, updated_at, or room_id columns)

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError, CRUD_ALIASES } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['create', 'get', 'list', 'update', 'delete', 'get_latest'] as const
type SceneAction = typeof ACTIONS[number]
const ALIASES: Record<string, SceneAction> = {
  ...CRUD_ALIASES,
  new_scene: 'create', begin_scene: 'create', open: 'create',
  show: 'get', fetch: 'get', load: 'get',
  scenes: 'list', all_scenes: 'list',
  edit: 'update', modify: 'update', patch: 'update',
  remove: 'delete', close: 'delete', end_scene: 'delete',
  latest: 'get_latest', current: 'get_latest', active: 'get_latest',
} as Record<string, SceneAction>

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  worldId: z.string().optional(),
  title: z.string().optional(),
  whenLabel: z.string().optional(),
  placeLabel: z.string().optional(),
  narration: z.string().optional(),
  participants: z.array(z.string()).optional().default([]),
  previousSceneId: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional().default(20),
})

export async function handleSceneManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'create': {
      if (!a.worldId) return err('"worldId" is required')
      if (!a.narration) return err('"narration" is required')
      const id = crypto.randomUUID()
      await db.prepare('INSERT INTO scenes (id, world_id, title, when_label, place_label, narration, engine_state, participants, previous_scene_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, a.worldId, a.title ?? null, a.whenLabel ?? null, a.placeLabel ?? null, a.narration, '{}', JSON.stringify(a.participants), a.previousSceneId ?? null, now).run()
      return ok({ success: true, actionType: 'create', sceneId: id, worldId: a.worldId, title: a.title })
    }
    case 'get': {
      if (!a.id) return err('"id" is required')
      const scene = await db.prepare('SELECT * FROM scenes WHERE id = ?').bind(a.id).first() as Record<string, unknown> | null
      if (!scene) return err(`Scene not found: ${a.id}`)
      return ok({ success: true, actionType: 'get', scene: { ...scene, participants: JSON.parse(scene.participants as string ?? '[]'), engine_state: JSON.parse(scene.engine_state as string ?? '{}') } })
    }
    case 'list': {
      let query = 'SELECT id, world_id, title, when_label, place_label, created_at FROM scenes'
      const binds: unknown[] = []
      if (a.worldId) { query += ' WHERE world_id = ?'; binds.push(a.worldId) }
      query += ' ORDER BY created_at DESC LIMIT ?'
      binds.push(a.limit)
      const { results } = await db.prepare(query).bind(...binds).all()
      return ok({ success: true, actionType: 'list', scenes: results, count: results.length })
    }
    case 'update': {
      if (!a.id) return err('"id" is required')
      const existing = await db.prepare('SELECT id FROM scenes WHERE id = ?').bind(a.id).first()
      if (!existing) return err(`Scene not found: ${a.id}`)
      const updates: string[] = []
      const binds: unknown[] = []
      if (a.title !== undefined) { updates.push('title = ?'); binds.push(a.title) }
      if (a.whenLabel !== undefined) { updates.push('when_label = ?'); binds.push(a.whenLabel) }
      if (a.placeLabel !== undefined) { updates.push('place_label = ?'); binds.push(a.placeLabel) }
      if (a.narration !== undefined) { updates.push('narration = ?'); binds.push(a.narration) }
      if (a.participants.length > 0) { updates.push('participants = ?'); binds.push(JSON.stringify(a.participants)) }
      if (updates.length === 0) return err('No fields to update provided')
      binds.push(a.id)
      await db.prepare(`UPDATE scenes SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run()
      return ok({ success: true, actionType: 'update', sceneId: a.id })
    }
    case 'delete': {
      if (!a.id) return err('"id" is required')
      const existing = await db.prepare('SELECT id FROM scenes WHERE id = ?').bind(a.id).first()
      if (!existing) return err(`Scene not found: ${a.id}`)
      await db.prepare('DELETE FROM scenes WHERE id = ?').bind(a.id).run()
      return ok({ success: true, actionType: 'delete', sceneId: a.id })
    }
    case 'get_latest': {
      let query = 'SELECT * FROM scenes'
      const binds: unknown[] = []
      if (a.worldId) { query += ' WHERE world_id = ?'; binds.push(a.worldId) }
      const scene = await db.prepare(query + ' ORDER BY created_at DESC LIMIT 1').bind(...binds).first() as Record<string, unknown> | null
      if (!scene) return err('No scenes found')
      return ok({ success: true, actionType: 'get_latest', scene: { ...scene, participants: JSON.parse(scene.participants as string ?? '[]'), engine_state: JSON.parse(scene.engine_state as string ?? '{}') } })
    }
  }
}
