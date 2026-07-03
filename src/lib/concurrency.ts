// src/lib/concurrency.ts
import { kvGet } from './kv'
import { parseKvEntry } from './lore'

export type ConflictCheck =
  | { conflict: false }
  | { conflict: true; currentVersion: number | null }

// Cloudflare KV has no compare-and-swap — a read-then-write cycle always has a
// race window. Re-reading `key` immediately before the write and comparing its
// version against `expectedVersion` (captured at the mutation's initial read)
// narrows that window from the full request round-trip down to this final
// check, and turns the common case of two overlapping writers into a detected,
// safe-to-retry conflict for the loser instead of a silent clobber. See #13.
export async function checkForConcurrentWrite(
  c: any,
  key: string,
  expectedVersion: number | undefined,
): Promise<ConflictCheck> {
  const freshRaw = await kvGet(c, key)
  if (!freshRaw) return { conflict: true, currentVersion: null }

  const { meta } = parseKvEntry(freshRaw)
  const currentVersion = typeof meta.version === 'number' ? meta.version : undefined
  if (currentVersion !== expectedVersion) {
    return { conflict: true, currentVersion: currentVersion ?? null }
  }
  return { conflict: false }
}
