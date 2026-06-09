// src/lib/history.ts
import { getKV } from './kv'
import { CHANGELOG_KEY, HISTORY_DEPTH, CHANGELOG_MAX } from '../constants'

// Pushes currentRaw (the value about to be overwritten) onto _history:{key}.
// Pass the already-read raw string to avoid an extra KV round-trip.
export async function pushHistory(c: any, key: string, currentRaw: string): Promise<void> {
  const kv = getKV(c)
  if (!kv) return
  const historyKey = `_history:${key}`
  let history: string[] = []
  try {
    const existing = await kv.get(historyKey)
    if (existing) history = JSON.parse(existing)
  } catch {
    // silently ignore if history doesn't exist
  }
  history.unshift(currentRaw)
  history = history.slice(0, HISTORY_DEPTH)
  await kv.put(historyKey, JSON.stringify(history))
}

// Appends a write event to _changelog so the editor can do delta-only syncs.
// Each entry: { key, version, updatedAt, op }. Rolls off after CHANGELOG_MAX.
export async function appendChangelog(c: any, key: string, version: number, op = 'write'): Promise<void> {
  const kv = getKV(c)
  if (!kv) return
  let entries: Array<{ key: string; version: number; updatedAt: string; op: string }> = []
  try {
    const existing = await kv.get(CHANGELOG_KEY)
    if (existing) entries = JSON.parse(existing)
  } catch {
    // silently ignore if changelog doesn't exist
  }
  entries.push({ key, version, updatedAt: new Date().toISOString(), op })
  if (entries.length > CHANGELOG_MAX) entries = entries.slice(-CHANGELOG_MAX)
  await kv.put(CHANGELOG_KEY, JSON.stringify(entries))
}
