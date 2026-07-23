// src/changes/route.ts
// Returns write events since a given ISO timestamp (1 KV read, no per-topic reads).
// Editor uses this for delta-only auto-sync — only fetches topics that changed.
// Query params:
//   since  (ISO string)  — return only events after this time, e.g. ?since=2026-05-26T12:00:00Z
// Response: { changes: ChangelogEntry[], count: number, generated_at: string }
import { Hono } from 'hono'
import type { AppBindings } from '../types'
import { getKV } from '../lib/kv'
import { CHANGELOG_KEY } from '../constants'

const changesRouter = new Hono<{ Bindings: AppBindings }>()

changesRouter.get('/', async (c) => {
  const since = c.req.query('since')
  const kv = getKV(c)
  let entries: Array<{ key: string; version: number; updatedAt: string; op: string }> = []
  if (kv) {
    try {
      const raw = await kv.get(CHANGELOG_KEY)
      if (raw) entries = JSON.parse(raw)
    } catch (e) {
      console.warn('changelog read failed', e)
    }
  }
  if (since) {
    const sinceMs = new Date(since).getTime()
    if (!isNaN(sinceMs)) {
      entries = entries.filter((e) => new Date(e.updatedAt).getTime() > sinceMs)
    }
  }
  c.header('Content-Type', 'application/json')
  c.header('Cache-Control', 'no-store')
  return c.json(
    { changes: entries, count: entries.length, generated_at: new Date().toISOString() },
    200,
  )
})

export default changesRouter
