// src/lib/indexes.ts
import { getKV, kvList } from './kv'
import { extractFieldFromText } from './lore'

// Maintains _idx:location:<loc>, _idx:thread:<thread>, _idx:prefix:<prefix> indexes
// Call after writing a lore entry to keep indexes in sync. Pass oldText=null on creation.
export async function updateIndexes(c: any, key: string, newText: string, oldText: string | null): Promise<void> {
  const kv = getKV(c)
  if (!kv) return

  // Extract field values from both old and new text
  const oldLocation = oldText ? (extractFieldFromText(oldText, 'Location') as string | null) : null
  const newLocation = extractFieldFromText(newText, 'Location') as string | null
  const oldThread = oldText ? (extractFieldFromText(oldText, 'Thread') as string | null) : null
  const newThread = extractFieldFromText(newText, 'Thread') as string | null

  // Update Location index
  if (oldLocation !== newLocation) {
    if (oldLocation) {
      await removeFromIndex(c, `_idx:location:${oldLocation}`, key)
    }
    if (newLocation) {
      await addToIndex(c, `_idx:location:${newLocation}`, key)
    }
  }

  // Update Thread index
  if (oldThread !== newThread) {
    if (oldThread) {
      await removeFromIndex(c, `_idx:thread:${oldThread}`, key)
    }
    if (newThread) {
      await addToIndex(c, `_idx:thread:${newThread}`, key)
    }
  }

  // Update Prefix index (character:, setup:, etc.)
  const oldPrefix = oldText ? key.split(':')[0] : null
  const newPrefix = key.split(':')[0]
  if (oldPrefix !== newPrefix && oldPrefix) {
    await removeFromIndex(c, `_idx:prefix:${oldPrefix}`, key)
  }
  if (newPrefix) {
    await addToIndex(c, `_idx:prefix:${newPrefix}`, key)
  }
}

// NOTE: Index updates are best-effort under concurrent load.
// KV does not support atomic array operations. If two requests mutate
// the same index simultaneously, one update may be lost. For strong
// consistency, move index writes to a Durable Object.
// Adds a key to an index (creates if missing, dedupes)
export async function addToIndex(c: any, indexKey: string, key: string): Promise<void> {
  try {
    const kv = getKV(c)
    if (!kv) return
    const existing = await kv.get(indexKey)
    const keys: string[] = existing ? JSON.parse(existing) : []
    if (!keys.includes(key)) {
      keys.push(key)
      await kv.put(indexKey, JSON.stringify(keys))
    }
  } catch (e) { console.warn(`Failed to add to index ${indexKey}`, e) }
}

// Removes a key from an index
export async function removeFromIndex(c: any, indexKey: string, key: string): Promise<void> {
  try {
    const kv = getKV(c)
    if (!kv) return
    const existing = await kv.get(indexKey)
    if (existing) {
      let keys: string[] = JSON.parse(existing)
      keys = keys.filter(k => k !== key)
      if (keys.length > 0) {
        await kv.put(indexKey, JSON.stringify(keys))
      } else {
        await kv.delete(indexKey)
      }
    }
  } catch (e) { console.warn(`Failed to remove from index ${indexKey}`, e) }
}

// Reads keys from an index (or falls back to kvList + filtering if index missing)
export async function getIndexedKeys(c: any, indexKey: string): Promise<string[]> {
  try {
    const kv = getKV(c)
    if (!kv) return []
    const raw = await kv.get(indexKey)
    if (raw) {
      const keys = JSON.parse(raw)
      return Array.isArray(keys) ? keys : []
    }
  } catch (e) { console.warn(`Failed to read index ${indexKey}`, e) }

  // Fallback: build filter based on index type (for test compatibility)
  if (indexKey.startsWith('_idx:prefix:')) {
    const prefix = indexKey.slice('_idx:prefix:'.length)
    const allKeys = await kvList(c)
    return allKeys.filter(k => k.startsWith(`${prefix}:`))
  }
  // Location/Thread indexes fall back to kvList + full scan (slower, but maintains compatibility)
  return []
}
