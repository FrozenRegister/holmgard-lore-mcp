// src/lib/kv.ts
import type { AppBindings } from '../types'
import { CHANGELOG_KEY } from '../constants'
import { getKvListCache, setKvListCache, getKvListMapsCache, setKvListMapsCache } from './cache'

// ── In-memory fallback ────────────────────────────────────────────────────────
// Keeps the server functional when Cloudflare KV is unavailable (e.g. local dev).
// Not persisted across worker restarts — KV is the source of truth.
export const loreDB: Record<string, string> = {}

// ── KV helpers ────────────────────────────────────────────────────────────────
// Reads fall back to loreDB automatically so callers don't need to handle it.
// List operations are cached within request scope to avoid redundant KV calls.

export function getKV(c: { env: AppBindings }): KVNamespace | null {
  return c.env.LORE_DB ?? null
}

export async function kvGet(c: { env: AppBindings }, key: string): Promise<string | null> {
  try {
    const kv = getKV(c)
    if (kv) return (await kv.get(key)) ?? loreDB[key] ?? null
  } catch (e) { console.warn('KV get failed', e) }
  return loreDB[key] ?? null
}

export async function kvList(c: { env: AppBindings }): Promise<string[]> {
  // Check request-scoped cache first (avoids redundant KV calls within single request)
  const cached = getKvListCache(c as any)
  if (cached) return cached

  try {
    const kv = getKV(c)
    if (kv) {
      const keys: string[] = []
      let cursor: string | undefined
      do {
        const listed: any = await kv.list(cursor ? { cursor } : undefined)
        for (const k of listed.keys) {
          if (!k.name.startsWith('_history:') && !k.name.startsWith('_idx:') && k.name !== CHANGELOG_KEY && !k.name.startsWith('events:') && !k.name.startsWith('_snapshot:') && !k.name.startsWith('_tags:') && !k.name.startsWith('map:')) keys.push(k.name)
        }
        cursor = listed.list_complete ? undefined : listed.cursor
      } while (cursor)
      setKvListCache(c as any, keys)
      return keys
    }
  } catch (e) {
    console.warn('KV list failed', e)
  }

  const fallbackKeys = Object.keys(loreDB).filter(k => !k.startsWith('_history:') && !k.startsWith('_idx:') && k !== CHANGELOG_KEY && !k.startsWith('events:') && !k.startsWith('_snapshot:') && !k.startsWith('_tags:') && !k.startsWith('map:'))
  setKvListCache(c as any, fallbackKeys)
  return fallbackKeys
}

export async function kvListMaps(c: { env: AppBindings }): Promise<string[]> {
  // Check request-scoped cache first (avoids redundant KV calls within single request)
  const cached = getKvListMapsCache(c as any)
  if (cached) return cached

  try {
    const kv = getKV(c)
    if (kv) {
      const keys: string[] = []
      let cursor: string | undefined
      do {
        const listed: any = await kv.list(cursor ? { cursor } : undefined)
        for (const k of listed.keys) {
          if (k.name.startsWith('map:')) keys.push(k.name)
        }
        cursor = listed.list_complete ? undefined : listed.cursor
      } while (cursor)
      setKvListMapsCache(c as any, keys)
      return keys
    }
  } catch (e) {
    console.warn('KV list maps failed', e)
  }

  const fallbackKeys = Object.keys(loreDB).filter(k => k.startsWith('map:'))
  setKvListMapsCache(c as any, fallbackKeys)
  return fallbackKeys
}

export async function kvPut(c: { env: AppBindings }, key: string, value: string): Promise<boolean> {
  try {
    const kv = getKV(c)
    if (kv) { await kv.put(key, value); return true }
  } catch (e) { console.warn('KV put failed', e) }
  return false
}

export async function kvDelete(c: { env: AppBindings }, key: string): Promise<boolean> {
  try {
    const kv = getKV(c)
    if (kv) { await kv.delete(key); return true }
  } catch (e) { console.warn('KV delete failed', e) }
  return false
}

// Export cache utilities for mutation handlers to clear cache after writes
export { clearRequestCache } from './cache'
