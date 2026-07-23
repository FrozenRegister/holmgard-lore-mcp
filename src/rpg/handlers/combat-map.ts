// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/combat-map.ts

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

export const ACTIONS = [
  'create',
  'get',
  'update',
  'move_token',
  'render',
  'delete',
  'get_terrain',
  'set_terrain',
  'calculate_aoe',
] as const
type CombatMapAction = (typeof ACTIONS)[number]
const ALIASES: Record<string, CombatMapAction> = {
  new_map: 'create',
  setup_map: 'create',
  init_battlefield: 'create',
  fetch: 'get',
  show: 'get',
  load: 'get',
  edit: 'update',
  modify: 'update',
  patch: 'update',
  move: 'move_token',
  reposition: 'move_token',
  display: 'render',
  ascii: 'render',
  view: 'render',
  remove: 'delete',
  destroy: 'delete',
  clear: 'delete',
  terrain: 'get_terrain',
  read_terrain: 'get_terrain',
  update_terrain: 'set_terrain',
  paint_terrain: 'set_terrain',
  aoe: 'calculate_aoe',
  area_of_effect: 'calculate_aoe',
  blast_radius: 'calculate_aoe',
}

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  encounterId: z.string().optional(),
  width: z.number().int().min(1).max(50).optional().default(10),
  height: z.number().int().min(1).max(50).optional().default(10),
  terrain: z
    .array(z.object({ x: z.number().int(), y: z.number().int(), type: z.string() }))
    .optional(),
  tokenId: z.string().optional(),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  origin: z.object({ x: z.number().int(), y: z.number().int() }).optional(),
  target: z.object({ x: z.number().int(), y: z.number().int() }).optional(),
  shape: z.enum(['circle', 'square', 'line']).optional().default('circle'),
  size: z.number().int().min(1).max(30).optional().default(1),
})

function bresenhamLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = []
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let error = dx + dy
  let x = x0
  let y = y0
  for (;;) {
    points.push({ x, y })
    if (x === x1 && y === y1) break
    const e2 = 2 * error
    if (e2 >= dy) {
      error += dy
      x += sx
    }
    if (e2 <= dx) {
      error += dx
      y += sy
    }
  }
  return points
}

function calculateAoe(
  origin: { x: number; y: number },
  shape: 'circle' | 'square' | 'line',
  size: number,
  target?: { x: number; y: number },
): Array<{ x: number; y: number }> {
  if (shape === 'line') {
    if (!target) return []
    return bresenhamLine(origin.x, origin.y, target.x, target.y)
  }
  const cells: Array<{ x: number; y: number }> = []
  for (let dx = -size; dx <= size; dx++) {
    for (let dy = -size; dy <= size; dy++) {
      if (shape === 'square' || Math.sqrt(dx * dx + dy * dy) <= size)
        cells.push({ x: origin.x + dx, y: origin.y + dy })
    }
  }
  return cells
}

function renderGrid(gridData: {
  width: number
  height: number
  terrain?: Array<{ x: number; y: number; type: string }>
  tokens?: Array<{ id: string; x: number; y: number; symbol?: string }>
}): string {
  const { width, height } = gridData
  const grid: string[][] = Array.from({ length: height }, () => Array(width).fill('.'))
  for (const t of gridData.terrain ?? []) {
    if (t.x < width && t.y < height) grid[t.y][t.x] = '#'
  }
  for (const t of gridData.tokens ?? []) {
    if (t.x < width && t.y < height) grid[t.y][t.x] = t.symbol ?? '@'
  }
  const lines = ['┌' + '─'.repeat(width) + '┐']
  for (const row of grid) lines.push('│' + row.join('') + '│')
  lines.push('└' + '─'.repeat(width) + '┘')
  return lines.join('\n')
}

export async function handleCombatMap(
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
    case 'create': {
      if (!a.encounterId) return err('"encounterId" is required')
      const id = crypto.randomUUID()
      const gridData = { width: a.width, height: a.height, terrain: a.terrain ?? [], tokens: [] }
      await db
        .prepare(
          'INSERT INTO battlefield (id, encounter_id, grid_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(id, a.encounterId, JSON.stringify(gridData), now, now)
        .run()
      return ok({
        success: true,
        actionType: 'create',
        mapId: id,
        encounterId: a.encounterId,
        width: a.width,
        height: a.height,
      })
    }
    case 'get': {
      const id = a.id ?? a.encounterId
      if (!id) return err('"id" or "encounterId" is required')
      const row = a.id
        ? await db.prepare('SELECT * FROM battlefield WHERE id = ?').bind(id).first()
        : await db
            .prepare('SELECT * FROM battlefield WHERE encounter_id = ? LIMIT 1')
            .bind(id)
            .first()
      if (!row) return err(`Battlefield not found`)
      return ok({
        success: true,
        actionType: 'get',
        map: {
          ...(row as Record<string, unknown>),
          grid_data: JSON.parse((row as any).grid_data ?? '{}'),
        },
      })
    }
    case 'update': {
      if (!a.id) return err('"id" is required')
      const row = (await db
        .prepare('SELECT grid_data FROM battlefield WHERE id = ?')
        .bind(a.id)
        .first()) as { grid_data: string } | null
      if (!row) return err(`Battlefield not found: ${a.id}`)
      const gridData = JSON.parse(row.grid_data)
      if (a.terrain) gridData.terrain = a.terrain
      if (a.width) gridData.width = a.width
      if (a.height) gridData.height = a.height
      await db
        .prepare('UPDATE battlefield SET grid_data = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(gridData), now, a.id)
        .run()
      return ok({ success: true, actionType: 'update', id: a.id })
    }
    case 'move_token': {
      if (!a.id || !a.tokenId || a.x === undefined || a.y === undefined)
        return err('"id", "tokenId", "x", and "y" are required')
      const row = (await db
        .prepare('SELECT grid_data FROM battlefield WHERE id = ?')
        .bind(a.id)
        .first()) as { grid_data: string } | null
      if (!row) return err(`Battlefield not found: ${a.id}`)
      const gridData = JSON.parse(row.grid_data)
      if (!gridData.tokens) gridData.tokens = []
      const tokenIdx = gridData.tokens.findIndex((t: { id: string }) => t.id === a.tokenId)
      if (tokenIdx >= 0) {
        gridData.tokens[tokenIdx].x = a.x
        gridData.tokens[tokenIdx].y = a.y
      } else gridData.tokens.push({ id: a.tokenId, x: a.x, y: a.y })
      await db
        .prepare('UPDATE battlefield SET grid_data = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(gridData), now, a.id)
        .run()
      return ok({
        success: true,
        actionType: 'move_token',
        mapId: a.id,
        tokenId: a.tokenId,
        x: a.x,
        y: a.y,
      })
    }
    case 'render': {
      const id = a.id ?? a.encounterId
      if (!id) return err('"id" or "encounterId" is required')
      const row = a.id
        ? ((await db
            .prepare('SELECT grid_data FROM battlefield WHERE id = ?')
            .bind(id)
            .first()) as { grid_data: string } | null)
        : ((await db
            .prepare('SELECT grid_data FROM battlefield WHERE encounter_id = ? LIMIT 1')
            .bind(id)
            .first()) as { grid_data: string } | null)
      if (!row) return err('Battlefield not found')
      const gridData = JSON.parse(row.grid_data)
      const rendered = renderGrid(gridData)
      return ok({ success: true, actionType: 'render', ascii: rendered })
    }
    case 'delete': {
      if (!a.id) return err('"id" is required')
      await db.prepare('DELETE FROM battlefield WHERE id = ?').bind(a.id).run()
      return ok({ success: true, actionType: 'delete', id: a.id })
    }
    case 'get_terrain': {
      const id = a.id ?? a.encounterId
      if (!id) return err('"id" or "encounterId" is required')
      const row = a.id
        ? ((await db
            .prepare('SELECT grid_data FROM battlefield WHERE id = ?')
            .bind(id)
            .first()) as { grid_data: string } | null)
        : ((await db
            .prepare('SELECT grid_data FROM battlefield WHERE encounter_id = ? LIMIT 1')
            .bind(id)
            .first()) as { grid_data: string } | null)
      if (!row) return err('Battlefield not found')
      const gridData = JSON.parse(row.grid_data)
      return ok({
        success: true,
        actionType: 'get_terrain',
        terrain: gridData.terrain ?? [],
        width: gridData.width,
        height: gridData.height,
      })
    }
    case 'set_terrain': {
      if (!a.id) return err('"id" is required')
      if (!a.terrain) return err('"terrain" is required')
      const row = (await db
        .prepare('SELECT grid_data FROM battlefield WHERE id = ?')
        .bind(a.id)
        .first()) as { grid_data: string } | null
      if (!row) return err(`Battlefield not found: ${a.id}`)
      const gridData = JSON.parse(row.grid_data)
      gridData.terrain = a.terrain
      await db
        .prepare('UPDATE battlefield SET grid_data = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(gridData), now, a.id)
        .run()
      return ok({
        success: true,
        actionType: 'set_terrain',
        id: a.id,
        terrainCount: a.terrain.length,
      })
    }
    case 'calculate_aoe': {
      if (!a.origin) return err('"origin" ({x, y}) is required')
      if (a.shape === 'line' && !a.target)
        return err('"target" ({x, y}) is required for a line AoE')
      const cells = calculateAoe(a.origin, a.shape, a.size, a.target)
      return ok({
        success: true,
        actionType: 'calculate_aoe',
        shape: a.shape,
        size: a.size,
        origin: a.origin,
        cells,
        count: cells.length,
      })
    }
  }
}
