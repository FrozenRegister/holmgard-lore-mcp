// src/lib/entity-resolve.ts
// Resolves a caller-supplied entity/location reference against the lore KV store,
// tolerating bare names (e.g. "eira-holt") in addition to full prefixed keys
// (e.g. "character:eira-holt"). Falls back to a did-you-mean substring scan.
import { kvGet, kvList } from './kv'

const COMMON_PREFIXES = ['character', 'npc', 'location', 'faction', 'item', 'entity', 'relationship', 'setup', 'archetype', 'scene']

export interface ResolvedEntity {
  key: string
  raw: string | null
  suggestion: string | null
}

export async function resolveEntityKey(c: any, inputKey: string): Promise<ResolvedEntity> {
  const trimmed = inputKey.trim().toLowerCase()
  const directRaw = await kvGet(c, trimmed)
  if (directRaw) return { key: trimmed, raw: directRaw, suggestion: null }

  if (!trimmed.includes(':')) {
    const candidates = COMMON_PREFIXES.map(p => `${p}:${trimmed}`)
    const raws = await Promise.all(candidates.map(k => kvGet(c, k)))
    const hitIndex = raws.findIndex(r => r !== null)
    if (hitIndex !== -1) return { key: candidates[hitIndex], raw: raws[hitIndex], suggestion: null }
  }

  const allKeys = await kvList(c)
  const query = trimmed.includes(':') ? trimmed.split(':').pop()! : trimmed
  const suggestion = allKeys.find(k => k !== trimmed && k.includes(query)) ?? null
  return { key: trimmed, raw: null, suggestion }
}
