// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/math-manage.ts
// Dice/probability implemented inline (no seedrandom/nerdamer deps in Workers).

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['roll', 'probability', 'solve', 'simplify', 'projectile', 'get_history'] as const
type MathAction = typeof ACTIONS[number]
const ALIASES: Record<string, MathAction> = {
  dice: 'roll', dice_roll: 'roll', d20: 'roll', throw: 'roll',
  prob: 'probability', calculate_probability: 'probability', odds: 'probability', chance: 'probability',
  algebra_solve: 'solve', equation: 'solve', solve_equation: 'solve',
  algebra_simplify: 'simplify', reduce: 'simplify', simplify_expression: 'simplify',
  physics: 'projectile', physics_projectile: 'projectile', trajectory: 'projectile', launch: 'projectile',
  history: 'get_history', past: 'get_history', calculations: 'get_history', rolls: 'get_history',
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
  limit: z.number().int().min(1).max(100).optional().default(20),
  calculationId: z.string().optional(),
  kind: z.enum(['roll', 'probability']).optional(),
})

// ── RNG ──────────────────────────────────────────────────────────────────────
// Crypto-backed by default (Workers has Web Crypto; crypto.randomUUID() is
// already used elsewhere in this codebase). The Monte-Carlo probability loop
// explicitly opts into a fast Math.random-backed source instead — cryptographic
// unpredictability buys nothing for a probability *estimate*, and the crypto
// path would add CPU-time cost across 10,000 samples for no benefit.

type RngSource = () => number

function defaultCryptoUint32(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]
}

function fastUint32(): number {
  return Math.floor(Math.random() * 0x100000000)
}

// Rejection sampling avoids modulo bias: redraw whenever the raw value falls
// in the tail that wouldn't map evenly onto [0, maxExclusive).
function randomInt(maxExclusive: number, rawSource: RngSource = defaultCryptoUint32): number {
  const RANGE = 0x100000000 // 2^32 possible Uint32 values
  const limit = Math.floor(RANGE / maxExclusive) * maxExclusive
  let value = rawSource()
  while (value >= limit) value = rawSource()
  return value % maxExclusive
}

function rollDice(sides: number, rawSource?: RngSource): number { return randomInt(sides, rawSource) + 1 }
function rollFudge(rawSource?: RngSource): number { return randomInt(3, rawSource) - 1 } // -1, 0, +1

// ── Dice engine ──────────────────────────────────────────────────────────────

interface ParsedDice {
  count: number
  sides: number
  fudge: boolean
  modifier: number
  dropLowest?: number
  dropHighest?: number
  keepHighest?: number
  keepLowest?: number
  explode: boolean
  rerollOnce: boolean
  successThreshold?: number
}

// Two staged passes rather than one large regex: the head identifies the die
// type (normal/percentile/Fudge), the suffix carries every optional modifier.
function parseDice(expr: string): ParsedDice {
  const head = expr.match(/^(\d+)?d(%|F|\d+)/)
  if (!head) throw new Error(`Invalid dice expression: ${expr}`)
  const count = head[1] ? parseInt(head[1]) : 1
  const fudge = head[2] === 'F'
  const sides = head[2] === '%' ? 100 : fudge ? 0 : parseInt(head[2])

  const rest = expr.slice(head[0].length)
  const tail = rest.match(/^(r1)?(?:(dl|dh|kl|kh)(\d+))?(!)?([+-]\d+)?(?:>(\d+))?$/)
  if (!tail) throw new Error(`Invalid dice expression: ${expr}`)

  const rerollOnce = !!tail[1]
  const dropKeepType = tail[2]
  const dropKeepN = tail[3] ? parseInt(tail[3]) : undefined
  const explode = !!tail[4]
  const modifier = tail[5] ? parseInt(tail[5]) : 0
  const successThreshold = tail[6] ? parseInt(tail[6]) : undefined

  if (successThreshold !== undefined && modifier !== 0) {
    throw new Error('A success threshold (">N") cannot be combined with a flat modifier — the semantics are ambiguous')
  }
  if (fudge && explode) {
    throw new Error('Exploding Fudge dice ("dF!") is not a supported mechanic')
  }
  if ((fudge || head[2] === '%') && successThreshold !== undefined) {
    throw new Error('A success threshold (">N") is not meaningful for percentile/Fudge dice')
  }

  return {
    count, sides, fudge, modifier, explode, rerollOnce, successThreshold,
    dropLowest: dropKeepType === 'dl' ? dropKeepN : undefined,
    dropHighest: dropKeepType === 'dh' ? dropKeepN : undefined,
    keepHighest: dropKeepType === 'kh' ? dropKeepN : undefined,
    keepLowest: dropKeepType === 'kl' ? dropKeepN : undefined,
  }
}

interface RollResult {
  total: number
  rolls: number[]
  steps: string[]
  successes?: number
  critical?: 'success' | 'failure' | null
}

function rollOnce(dice: ParsedDice, rawSource?: RngSource): RollResult {
  const { count, sides, fudge, modifier, dropLowest, dropHighest, keepHighest, keepLowest, explode, rerollOnce, successThreshold } = dice
  const rolls: number[] = []
  for (let i = 0; i < count; i++) {
    let r = fudge ? rollFudge(rawSource) : rollDice(sides, rawSource)
    rolls.push(r)
    if (explode) {
      while (r === sides) { r = rollDice(sides, rawSource); rolls.push(r) }
    }
  }
  const steps: string[] = [`Rolled ${count}${fudge ? 'dF' : 'd' + sides}: [${rolls.join(', ')}]`]

  let working = rolls
  if (rerollOnce) {
    working = rolls.map((r, i) => {
      if (r !== 1) return r
      const newVal = fudge ? rollFudge(rawSource) : rollDice(sides, rawSource)
      steps.push(`Rerolled a 1 (position ${i + 1}): → ${newVal}`)
      return newVal
    })
  }

  let kept = [...working]
  if (dropLowest !== undefined) { kept.sort((a, b) => a - b); kept = kept.slice(dropLowest); steps.push(`Dropped lowest ${dropLowest}: kept [${kept.join(', ')}]`) }
  if (dropHighest !== undefined) { kept.sort((a, b) => b - a); kept = kept.slice(dropHighest); steps.push(`Dropped highest ${dropHighest}: kept [${kept.join(', ')}]`) }
  if (keepHighest !== undefined) { kept.sort((a, b) => b - a); kept = kept.slice(0, keepHighest); steps.push(`Kept highest ${keepHighest}: [${kept.join(', ')}]`) }
  if (keepLowest !== undefined) { kept.sort((a, b) => a - b); kept = kept.slice(0, keepLowest); steps.push(`Kept lowest ${keepLowest}: [${kept.join(', ')}]`) }

  if (successThreshold !== undefined) {
    const successes = kept.filter(v => v > successThreshold).length
    steps.push(`Counted successes > ${successThreshold}: ${successes}`)
    return { total: successes, rolls, steps, successes }
  }

  const sum = kept.reduce((a, b) => a + b, 0)
  const total = sum + modifier
  if (modifier !== 0) steps.push(`+${modifier} modifier → ${total}`)
  else steps.push(`Total: ${total}`)

  // Critical hit/fumble is only meaningful for a single d20 check (1d20) or an
  // advantage/disadvantage pair (2d20kh1 / 2d20kl1 — the existing keep syntax
  // already expresses advantage/disadvantage, no new notation needed for it).
  // Omitted (not `null`) for anything else — 8d20 pools, 2d6+3, d%, dF, plain
  // 2d20 with no kh/kl — so callers can safely branch on `'critical' in result`.
  let critical: 'success' | 'failure' | null | undefined
  if (sides === 20 && !fudge && (count === 1 || ((keepHighest === 1 || keepLowest === 1) && count === 2))) {
    const natural = kept[0]
    critical = natural === 20 ? 'success' : natural === 1 ? 'failure' : null
  }

  return { total, rolls, steps, critical }
}

function executeRoll(expr: string, rawSource?: RngSource): RollResult & { dice: ParsedDice } {
  const dice = parseDice(expr)
  return { ...rollOnce(dice, rawSource), dice }
}

// Monte-Carlo probability (10,000 samples)
function calcProbability(expr: string, target: number, comparison: string): number {
  const dice = parseDice(expr)
  const SAMPLES = 10000
  let hits = 0
  for (let i = 0; i < SAMPLES; i++) {
    const { total } = rollOnce(dice, fastUint32)
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

function parseCalcRow(row: Record<string, unknown>) {
  return {
    ...row,
    steps: row.steps ? JSON.parse(row.steps as string) : null,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
  }
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
      let result: RollResult & { dice: ParsedDice }
      try {
        result = executeRoll(a.expression)
      } catch (e) {
        return err(e instanceof Error ? e.message : `Invalid dice expression: ${a.expression}`)
      }
      const { total, rolls, steps, successes, critical, dice } = result
      const id = crypto.randomUUID()
      const metadata = JSON.stringify({
        kind: 'roll', rolls,
        dropLowest: dice.dropLowest, dropHighest: dice.dropHighest, keepHighest: dice.keepHighest, keepLowest: dice.keepLowest,
        explode: dice.explode, rerollOnce: dice.rerollOnce, successThreshold: dice.successThreshold, critical,
      })
      if (db) {
        await db.prepare('INSERT INTO calculations (id, session_id, input, result, steps, seed, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(id, a.sessionId ?? null, a.expression, String(total), JSON.stringify(steps), a.seed ?? null, now, metadata).run()
      }
      return ok({ success: true, actionType: 'roll', expression: a.expression, total, rolls, steps, successes, critical, calculationId: id })
    }
    case 'probability': {
      const expr = a.expression ?? (a.sides ? `1d${a.sides}` : undefined)
      if (!expr || a.target === undefined) return err('"expression" (or "sides") and "target" are required')
      const comp = a.comparison ?? 'gte'
      let prob: number
      try {
        prob = calcProbability(expr, a.target, comp)
      } catch (e) {
        return err(e instanceof Error ? e.message : `Invalid dice expression: ${expr}`)
      }
      const id = crypto.randomUUID()
      const metadata = JSON.stringify({ kind: 'probability', comparison: comp, target: a.target, samples: 10000 })
      if (db) {
        await db.prepare('INSERT INTO calculations (id, session_id, input, result, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(id, a.sessionId ?? null, JSON.stringify({ expression: expr, target: a.target, comparison: comp }), String(prob), now, metadata).run()
      }
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
    case 'get_history': {
      if (a.calculationId) {
        const row = await db!.prepare('SELECT * FROM calculations WHERE id = ?').bind(a.calculationId).first() as Record<string, unknown> | null
        if (!row) return err(`Calculation not found: ${a.calculationId}`)
        return ok({ success: true, actionType: 'get_history', calculation: parseCalcRow(row) })
      }
      const conditions: string[] = []
      const binds: unknown[] = []
      if (a.sessionId) { conditions.push('session_id = ?'); binds.push(a.sessionId) }
      if (a.kind) { conditions.push("json_extract(metadata, '$.kind') = ?"); binds.push(a.kind) }
      let query = 'SELECT * FROM calculations'
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ')
      query += ' ORDER BY timestamp DESC LIMIT ?'
      binds.push(a.limit)
      const { results } = await db!.prepare(query).bind(...binds).all()
      return ok({ success: true, actionType: 'get_history', calculations: (results as Record<string, unknown>[]).map(parseCalcRow), count: results.length })
    }
  }
}
