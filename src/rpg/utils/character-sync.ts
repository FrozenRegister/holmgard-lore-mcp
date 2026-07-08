// Character sync utilities: D1 ↔ KV projection management
// Ensures D1 is the source of truth and KV contains generated markdown projections

import type { AppBindings } from '../../types'
import { formatD1CharToKv } from './kv-to-d1'

/**
 * Sync a D1 character row to KV as a markdown projection.
 * Writes the character as a `character:<name-slug>` KV entry with D1-Migrated marker.
 *
 * @param env Cloudflare bindings (LORE_DB for KV, RPG_DB for D1)
 * @param charId D1 character ID to sync
 * @param slug Optional: KV key slug (defaults to character name slugified)
 * @returns KV key used to store the projection
 */
export async function syncCharacterToKv(
  env: AppBindings,
  charId: string,
  slug?: string
): Promise<string | null> {
  if (!env.LORE_DB) return null
  if (!env.RPG_DB) return null

  try {
    // Fetch D1 character
    const row = await env.RPG_DB.prepare('SELECT * FROM characters WHERE id = ?').bind(charId).first()
    if (!row) return null

    // Generate KV projection
    const kvText = formatD1CharToKv(row as Record<string, unknown>)

    // Determine KV key from slug or name
    const name = (row.name as string) || 'character'
    const kvSlug = slug || name.toLowerCase().replace(/\s+/g, '-')
    const kvKey = kvSlug.startsWith('character:') ? kvSlug : `character:${kvSlug}`

    // Write to KV with metadata
    const kvValue = JSON.stringify({
      text: kvText,
      meta: {
        version: 1,
        updatedAt: new Date().toISOString(),
        d1_id: charId,
        d1_migrated: true,
      },
    })

    await env.LORE_DB.put(kvKey, kvValue)
    return kvKey
  } catch {
    // Silently fail — D1 sync is best-effort projection, not critical path
    return null
  }
}

/**
 * Sync all D1 characters that don't have KV projections yet.
 * Used for one-time migration from dual-source to D1-authoritative.
 *
 * @param env Cloudflare bindings
 * @returns Count of characters synced
 */
export async function syncAllCharactersToKv(env: AppBindings): Promise<number> {
  if (!env.RPG_DB || !env.LORE_DB) return 0

  try {
    const rows = await env.RPG_DB.prepare(
      'SELECT id, name FROM characters ORDER BY name ASC'
    ).all() as { results: Array<Record<string, unknown>> }

    let synced = 0
    for (const row of rows.results || []) {
      const charId = row.id as string
      const result = await syncCharacterToKv(env, charId)
      if (result) synced++
    }
    return synced
  } catch {
    return 0
  }
}
