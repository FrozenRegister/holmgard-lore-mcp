// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/math-manage.ts
// Dice/probability implemented inline (no seedrandom/nerdamer deps in Workers).

import { z } from 'zod'
import { randomUUID } from 'crypto'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['roll', 'probability', 'solve', 'simplify', 'projectile'] as const
type MathAction = typeof ACTIONS[number]
const ALIASES: Record<string, MathAction> = {
  dice: 'roll', dice_roll: 'roll', d20: 'roll', throw: 'roll',
  prob: 'probability', calculate_probability: 'probability', odds: 'probability', chance: 'probability',
  algebra_solve: 'solve', equation: 'solve', solve_equation: 'solve',
  algebra_simplify: 'simplify', reduce: 'simplify', simplify_expression: 'simplify',
  physics: 'projectile', physics_projectile: 'projectile', trajectory: 'projectile', launch: 'projectile',
}

const InputSchema = z.object({
  action: z.string(),
  expression: z.string().optional(),
  seed: z.string().optional(),
  sides: z.number().int().min(2).optional(),
  target: z.number().optional(),
  comparison: z.enum(['gte', 'lte', 'eq', 'gt', 'lt']).optional(),
  equation: z.string().optional(),
  variable: z.string().optional(),
  velocity: z.number().optional(),
  angle: z.number().optional(),
  height: z.number().optional(),
  gravity: z.number().optional(),
  sessionId: z.string().optional(),
})

// ── Dice engine ──────────────────────────────────────────────────────────────

function parseDice(expr: string): { count: number; sides: number; modifier: number; dropLowest?: number; dropHighest?: number; keepHighest?: number; keepLowest?: number; explode?: boolean } {
  const m = expr.match(/^(\d+)?d(\d+)(?:(dl|dh|kl|kh)(\d+))?([+-]\d+)?(!)?$/)
  if (!m) throw new Error(`Invalid dice expression: ${expr}`)
  return {
    count: m[1] ? parseInt(m[1]) : 1,
    sides: parseInt(m[2]),
    modifier: m[5] ? parseInt(m[5]) : 0,
    dropLowest: m[3] === 'dl' ? parseInt(m[4]) : undefined,
    dropHighest: m[3] === 'dh' ? parseInt(m[4]) : undefined,
    keepHighest: m[3] === 'kh' ? parseInt(m[4]) : undefined,
    keepLowest: m[3] === 'kl' ? parseInt(m[4]) : undefined,
    explode: !!m[6],
  }
}

function rollDice(sides: number): number { return Math.floor(Math.random() * sides) + 1 }

function executeRoll(expr: string): { total: number; rolls: number[]; steps: string[] } {
  const { count, sides, modifier, dropLowest, dropHighest, keepHighest, keepLowest, explode } = parseDice(expr)
  const rolls: number[] = []
  for (let i = 0; i < count; i++) {
    let r = rollDice(sides)
    rolls.push(r)
    if (explode) {
      while (r === sides) { r = rollDice(sides); rolls.push(r) }
    }
  }
  let kept = [...rolls]
  const steps: string[] = [`Rolled ${count}d${sides}: [${rolls.join(', ')}]`]
  if (dropLowest !== undefined) { kept.sort((a, b) => a - b); kept = kept.slice(dropLowest); steps.push(`Dropped lowest ${dropLowest}: kept [${kept.join(', ')}]`) }
  if (dropHighest !== undefined) { kept.sort((a, b) => b - a); kept = kept.slice(dropHighest); steps.push(`Dropped highest ${dropHighest}: kept [${kept.join(', ')}]`) }
  if (keepHighest !== undefined) { kept.sort((a, b) => b - a); kept = kept.slice(0, keepHighest); steps.push(`Kept highest ${keepHighest}: [${kept.join(', ')}]`) }
  if (keepLowest !== undefined) { kept.sort((a, b) => a - b); kept = kept.slice(0, keepLowest); steps.push(`Kept lowest ${keepLowest}: [${kept.join(', ')}]`) }
  const sum = kept.reduce((a, b) => a + b, 0)
  const total = sum + modifier
  if (modifier !== 0) steps.push(`+${modifier} modifier → ${total}`)
  else steps.push(`Total: ${total}`)
  return { total, rolls, steps }
}

// Simple Monte-Carlo probability (1000 samples)
function calcProbability(expr: string, target: number, comparison: string): number {
  const SAMPLES = 10000
  let hits = 0
  for (let i = 0; i < SAMPLES; i++) {
    const { total } = executeRoll(expr)
    const match = comparison === 'gte' ? total >= target
      : comparison === 'lte' ? total <= target
      : comparison === 'gt' ? total > target
      : comparison === 'lt' ? total < target
      : total === target
    if (match) hits++
  }
  return hits / SAMPLES
}

// Projectile physics
function projectile(velocity: number, angleDeg: number, gravity: number, initialHeight: number) {
  const g = gravity || 9.81
  const a = (angleDeg * Math.PI) / 180
  const vy = velocity * Math.sin(a)
  const vx = velocity * Math.cos(a)
  // time of flight (solve: h0 + vy*t - 0.5*g*t^2 = 0)
  const disc = vy * vy + 2 * g * initialHeight
  const timeOfFlight = disc >= 0 ? (vy + Math.sqrt(disc)) / g : 0
  const range = vx * timeOfFlight
  const maxHeight = initialHeight + (vy * vy) / (2 * g)
  return { range: Math.round(range * 100) / 100, maxHeight: Math.round(maxHeight * 100) / 100, timeOfFlight: Math.round(timeOfFlight * 100) / 100 }
}

export async function handleMathManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const now = new Date().toISOString()
  const db = env.RPG_DB

  switch (match.matched) {
    case 'roll': {
      if (!a.expression) return err('"expression" is required for roll')
      const { total, rolls, steps } = executeRoll(a.expression)
      const id = randomUUID()
      if (db) await db.prepare('INSERT INTO calculations (id, input, result, steps, seed, timestamp) VALUES (?, ?, ?, ?, ?, ?)').bind(id, a.expression, String(total), JSON.stringify(steps), a.seed ?? null, now).run()
      return ok({ success: true, actionType: 'roll', expression: a.expression, total, rolls, steps, calculationId: id })
    }
    case 'probability': {
      const expr = a.expression ?? (a.sides ? `1d${a.sides}` : undefined)
      if (!expr || a.target === undefined) return err('"expression" (or "sides") and "target" are required')
      const comp = a.comparison ?? 'gte'
      const prob = calcProbability(expr, a.target, comp)
      const id = randomUUID()
      if (db) await db.prepare('INSERT INTO calculations (id, input, result, timestamp) VALUES (?, ?, ?, ?)').bind(id, JSON.stringify({ expression: expr, target: a.target, comparison: comp }), String(prob), now).run()
      return ok({ success: true, actionType: 'probability', expression: expr, target: a.target, comparison: comp, probability: prob, probabilityPercent: `${(prob * 100).toFixed(1)}%`, calculationId: id })
    }
    case 'solve':
    case 'simplify':
      return ok({ success: false, actionType: match.matched, message: 'Algebra solver not available in Workers context. Use roll for dice math.' })
    case 'projectile': {
      if (a.velocity === undefined || a.angle === undefined) return err('"velocity" and "angle" are required')
      const result = projectile(a.velocity, a.angle, a.gravity ?? 9.81, a.height ?? 0)
      return ok({ success: true, actionType: 'projectile', velocity: a.velocity, angle: a.angle, ...result })
    }
  }
}
