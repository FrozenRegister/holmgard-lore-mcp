// src/rpg/handlers/time-manage.ts
// World clock, character birthdates, age computation, and date advancement.
// All reads/writes go to D1 (world_state and characters tables).

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'
import { handleEventManage } from './event-manage'

const ACTIONS = ['set_date', 'get_date', 'get_age', 'advance', 'get_timeline', 'jump_to'] as const
type TimeAction = typeof ACTIONS[number]
const ALIASES: Record<string, TimeAction> = {
  set:      'set_date',
  date:     'get_date',
  age:      'get_age',
  tick:     'advance',
  forward:  'advance',
  clock:    'get_date',
  timeline: 'get_timeline',
  events:   'get_timeline',
  jump:     'jump_to',
  goto:     'jump_to',
}

const InputSchema = z.object({
  action:       z.string(),
  world_id:     z.string().optional(),
  // #336 — every other rpg sub accepts camelCase worldId; time was the one
  // snake_case-only outlier. Accept both, normalized to world_id below,
  // since all of this handler's internal logic already reads a.world_id.
  worldId:      z.string().optional(),
  date:         z.string().optional(),
  era:          z.string().optional(),
  character_id: z.string().optional(),
  by:           z.string().optional(),
  from:         z.string().optional(),
  to:           z.string().optional(),
  thread:       z.string().optional(),
  mode:         z.enum(['observe', 'play']).optional(),
  limit:        z.number().int().min(1).max(500).optional(),
})

// ── Date arithmetic helpers ───────────────────────────────────────────────────

function daysInMonth(year: number, month: number): number {
  const dims = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
    return leap ? 29 : 28
  }
  return dims[month]
}

function addToDate(dateStr: string, amount: number, unit: 'days' | 'months' | 'years'): string {
  let [y, m, d] = dateStr.split('-').map(Number)

  if (unit === 'years') {
    y += amount
    d = Math.min(d, daysInMonth(y, m))
  } else if (unit === 'months') {
    m += amount
    while (m > 12) { m -= 12; y++ }
    while (m < 1)  { m += 12; y-- }
    d = Math.min(d, daysInMonth(y, m))
  } else {
    d += amount
    while (d > daysInMonth(y, m)) {
      d -= daysInMonth(y, m)
      m++
      if (m > 12) { m = 1; y++ }
    }
    while (d < 1) {
      m--
      if (m < 1) { m = 12; y-- }
      d += daysInMonth(y, m)
    }
  }

  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function parseDateParts(dateStr: string): [number, number, number] {
  const [y, m, d] = dateStr.split('-').map(Number)
  return [y, m, d]
}

function dateDiff(fromStr: string, toStr: string): number {
  // Returns the number of days from fromStr to toStr (approximate, for response only)
  const [fy, fm, fd] = parseDateParts(fromStr)
  const [ty, tm, td] = parseDateParts(toStr)
  return (ty - fy) * 365 + (tm - fm) * 30 + (td - fd)
}

function season(month: number): string {
  if (month <= 2)  return 'winter'
  if (month <= 5)  return 'spring'
  if (month <= 8)  return 'summer'
  if (month <= 11) return 'autumn'
  return 'winter'
}

function birthdayInRange(born: string, fromDate: string, toDate: string): boolean {
  const [, birthMonth, birthDay] = parseDateParts(born)
  if (birthMonth === undefined || birthDay === undefined) return false
  const [fy] = parseDateParts(fromDate)
  const [ty] = parseDateParts(toDate)
  for (let y = fy; y <= ty; y++) {
    const bday = `${y}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`
    if (bday > fromDate && bday <= toDate) return true
  }
  return false
}

function nextBirthday(born: string, currentDate: string): string | null {
  const [, birthMonth, birthDay] = parseDateParts(born)
  if (birthMonth === undefined || birthDay === undefined) return null
  const [cy] = parseDateParts(currentDate)
  const bdayThisYear = `${cy}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`
  if (bdayThisYear >= currentDate) return bdayThisYear
  return `${cy + 1}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`
}

function computeAge(born: string, currentDate: string): { years: number; months: number | null; days: number | null } {
  const [by, bm, bd] = parseDateParts(born)
  const [cy, cm, cd] = parseDateParts(currentDate)

  if (bm === undefined || bd === undefined) {
    // Year-only born date — month/day can't be computed, only the year delta.
    return { years: cy - by, months: null, days: null }
  }

  let years = cy - by
  let months = cm - bm
  let days = cd - bd

  if (days < 0) {
    months--
    const prevMonth = cm === 1 ? 12 : cm - 1
    const prevYear  = cm === 1 ? cy - 1 : cy
    days += daysInMonth(prevYear, prevMonth)
  }
  if (months < 0) {
    years--
    months += 12
  }

  return { years, months, days }
}

function parseByString(by: string): { amount: number; unit: 'days' | 'months' | 'years' } | null {
  const m = by.trim().match(/^(\d+)\s*(day|days|month|months|year|years)$/i)
  if (!m) return null
  const amount = parseInt(m[1], 10)
  const raw = m[2].toLowerCase()
  const unit: 'days' | 'months' | 'years' = raw.startsWith('y') ? 'years' : raw.startsWith('mo') ? 'months' : 'days'
  return { amount, unit }
}

// ── World state seeding (#330) ───────────────────────────────────────────────
// world_manage.create/generate never seeded a world_state row (unlike
// biomes/zone-types, which do get auto-seeded there) — every world_state
// column besides world_id has a DEFAULT or is nullable, so a bare insert is
// sufficient. Idempotent: `INSERT OR IGNORE` is a no-op for a world that
// already has a row (e.g. one that already called set_date).
export async function seedWorldState(db: D1Database, worldId: string): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO world_state (world_id) VALUES (?)').bind(worldId).run()
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function handleTimeManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  if (a.world_id === undefined && a.worldId !== undefined) a.world_id = a.worldId

  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)

  const db = env.RPG_DB!

  switch (match.matched) {
    case 'set_date': {
      if (!a.world_id) return err('"world_id" is required')
      if (!a.date)     return err('"date" is required')
      await db
        .prepare(`INSERT INTO world_state (world_id, "current_date", era)
                  VALUES (?, ?, ?)
                  ON CONFLICT(world_id) DO UPDATE SET
                    "current_date" = excluded."current_date",
                    era            = COALESCE(excluded.era, world_state.era)`)
        .bind(a.world_id, a.date, a.era ?? null)
        .run()
      const row = await db
        .prepare('SELECT "current_date", era FROM world_state WHERE world_id = ?')
        .bind(a.world_id)
        .first() as { current_date: string; era: string | null } | null
      return ok({ success: true, actionType: 'set_date', world_id: a.world_id, current_date: row?.current_date, era: row?.era ?? null })
    }

    case 'get_date': {
      if (!a.world_id) return err('"world_id" is required')
      const row = await db
        .prepare('SELECT "current_date", era FROM world_state WHERE world_id = ?')
        .bind(a.world_id)
        .first() as { current_date: string; era: string | null } | null
      if (!row) return err(`No world_state found for world_id: ${a.world_id}`)
      const [, month] = parseDateParts(row.current_date)
      const [year] = parseDateParts(row.current_date)
      return ok({
        success: true, actionType: 'get_date',
        world_id: a.world_id,
        current_date: row.current_date,
        era: row.era ?? null,
        season: season(month),
        days_in_month: daysInMonth(year, month),
      })
    }

    case 'get_age': {
      if (!a.world_id)     return err('"world_id" is required')
      if (!a.character_id) return err('"character_id" is required')
      const [ws, char] = await Promise.all([
        db.prepare('SELECT "current_date" FROM world_state WHERE world_id = ?').bind(a.world_id).first() as Promise<{ current_date: string } | null>,
        db.prepare('SELECT id, name, born FROM characters WHERE id = ?').bind(a.character_id).first() as Promise<{ id: string; name: string; born: string | null } | null>,
      ])
      if (!ws)   return err(`No world_state found for world_id: ${a.world_id}`)
      if (!char) return err(`Character not found: ${a.character_id}`)
      if (!char.born) {
        return ok({ success: true, actionType: 'get_age', character: char.name, age: null, birthday: null, next_birthday: null, is_birthday_today: false })
      }
      const age = computeAge(char.born, ws.current_date)
      const bday = nextBirthday(char.born, ws.current_date)
      const isPartialDate = bday === null
      const isToday = !isPartialDate && ws.current_date.slice(5) === char.born.slice(5)
      return ok({
        success: true, actionType: 'get_age',
        character: char.name, character_id: char.id,
        born: char.born,
        age,
        next_birthday: bday,
        is_birthday_today: isToday,
        is_partial_date: isPartialDate,
      })
    }

    case 'advance': {
      if (!a.world_id) return err('"world_id" is required')
      if (!a.by)       return err('"by" is required (e.g. "3 months", "1 year", "7 days")')
      const parsed_by = parseByString(a.by)
      if (!parsed_by) return err('"by" must be a whole number followed by days/months/years (e.g. "3 months")')

      const ws = await db
        .prepare('SELECT "current_date" FROM world_state WHERE world_id = ?')
        .bind(a.world_id)
        .first() as { current_date: string } | null
      if (!ws) return err(`No world_state found for world_id: ${a.world_id}`)

      const oldDate = ws.current_date
      const newDate = addToDate(oldDate, parsed_by.amount, parsed_by.unit)
      const now = new Date().toISOString()

      await db
        .prepare('UPDATE world_state SET "current_date" = ?, last_advanced_at = ? WHERE world_id = ?')
        .bind(newDate, now, a.world_id)
        .run()

      const chars = await db
        .prepare('SELECT id, name, born FROM characters WHERE born IS NOT NULL')
        .all() as { results: Array<{ id: string; name: string; born: string }> }

      const birthdaysTriggered: Array<{ id: string; name: string; born: string }> = []
      for (const c of chars.results) {
        if (birthdayInRange(c.born, oldDate, newDate)) {
          birthdaysTriggered.push({ id: c.id, name: c.name, born: c.born })
          await handleEventManage(env, {
            action: 'emit',
            eventType: 'world_change',
            payload: { type: 'birthday', character_id: c.id, character_name: c.name, born: c.born, current_date: newDate },
            sourceType: 'system',
            sourceId: 'time',
          })
        }
      }

      return ok({
        success: true, actionType: 'advance',
        world_id: a.world_id,
        old_date: oldDate,
        new_date: newDate,
        by: a.by,
        days_elapsed: dateDiff(oldDate, newDate),
        birthdays_triggered: birthdaysTriggered,
      })
    }

    case 'get_timeline': {
      if (!a.world_id) return err('"world_id" is required')
      const limit = a.limit ?? 100
      const parts: string[] = ['SELECT * FROM timeline_events WHERE world_id = ?']
      const binds: unknown[] = [a.world_id]
      if (a.thread) { parts.push('AND thread_id = ?'); binds.push(a.thread) }
      if (a.from)   { parts.push('AND event_at >= ?'); binds.push(a.from) }
      if (a.to)     { parts.push('AND event_at <= ?'); binds.push(a.to) }
      parts.push('ORDER BY event_at ASC LIMIT ?'); binds.push(limit)
      const rows = await db.prepare(parts.join(' ')).bind(...binds).all() as { results: unknown[] }
      return ok({ success: true, actionType: 'get_timeline', world_id: a.world_id, count: rows.results.length, events: rows.results })
    }

    case 'jump_to': {
      if (!a.world_id) return err('"world_id" is required')
      if (!a.date)     return err('"date" is required')
      const mode = a.mode ?? 'observe'
      const [beforeRow, afterRow] = await Promise.all([
        db.prepare(
          'SELECT * FROM timeline_events WHERE world_id = ? AND is_canonical = 1 AND event_at <= ? ORDER BY event_at DESC LIMIT 1'
        ).bind(a.world_id, a.date).first() as Promise<unknown>,
        db.prepare(
          'SELECT * FROM timeline_events WHERE world_id = ? AND is_canonical = 1 AND event_at > ? ORDER BY event_at ASC LIMIT 1'
        ).bind(a.world_id, a.date).first() as Promise<unknown>,
      ])
      const presentChars = await db
        .prepare('SELECT DISTINCT entity_id FROM timeline_events WHERE world_id = ? AND event_at <= ? AND entity_id IS NOT NULL')
        .bind(a.world_id, a.date)
        .all() as { results: Array<{ entity_id: string }> }
      const result: Record<string, unknown> = {
        success: true, actionType: 'jump_to',
        world_id: a.world_id,
        date: a.date,
        mode,
        gap: { before_event: beforeRow ?? null, after_event: afterRow ?? null },
        present_characters: presentChars.results.map(r => r.entity_id),
      }
      if (mode === 'play' && afterRow) {
        result.constraint = `Must be consistent with the event that follows at ${(afterRow as Record<string, unknown>).event_at}`
      }
      return ok(result)
    }
  }
}
