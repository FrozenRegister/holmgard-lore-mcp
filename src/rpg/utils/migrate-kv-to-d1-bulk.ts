// Bulk KV-to-D1 character migration utility
// Migrates character:* entries from KV to D1 and updates KV with redirect markers

import type { AppBindings } from '../../types'
import { kvGet, kvList } from '../../lib/kv'
import { parseKvEntry } from '../../lib/lore'
import { parseKvCharToD1 } from './kv-to-d1'

export interface MigrationResult {
  key: string
  status: 'migrated' | 'skipped' | 'error'
  d1Id?: string
  error?: string
}

/**
 * Migrate a single character from KV to D1.
 * Reads KV entry, parses to D1 format, inserts to D1, updates KV with marker.
 * Any infrastructure error (missing binding, DB failure) is caught and returned as status: 'error'.
 */
export async function migrateCharacterKvToD1(
  c: { env: AppBindings },
  kvKey: string,
): Promise<MigrationResult> {
  try {
    // 1. Check if already migrated
    const kvRaw = await kvGet(c, kvKey)
    if (!kvRaw) {
      return { key: kvKey, status: 'error', error: 'KV entry not found' }
    }

    const entry = parseKvEntry(kvRaw)
    if (entry.text.includes('## D1-Migrated: true')) {
      return { key: kvKey, status: 'skipped', error: 'Already migrated' }
    }

    // 2. Generate D1 ID and parse KV text
    const d1Id = crypto.randomUUID()
    const d1Row = parseKvCharToD1(kvKey, entry.text, d1Id)

    // Neutralize foreign key references that may not exist in target D1
    // (location data is preserved in KV narrative and resource_pools)
    d1Row.current_room_id = null

    // 3. Insert into D1 — throws if RPG_DB binding is unavailable or INSERT fails
    const fields = Object.keys(d1Row) as Array<keyof typeof d1Row>
    const placeholders = fields.map(() => '?').join(',')
    const values = fields.map(f => d1Row[f])
    const insertSql = `INSERT INTO characters (${fields.join(',')}) VALUES (${placeholders})`
    await c.env.RPG_DB!.prepare(insertSql).bind(...values).run()

    // 4. Update KV with redirect marker — throws if LORE_DB binding is unavailable
    const marker = [
      `## D1-Migrated: true`,
      `## D1-Character-ID: ${d1Id}`,
      `## Status: Legacy entry — migrated to D1 on ${new Date().toISOString()}`,
    ].join('\n')
    const updatedEntry = JSON.stringify({
      text: `${marker}\n\n${entry.text}`,
      meta: { ...entry.meta, d1_id: d1Id, migrated_at: new Date().toISOString() },
    })
    await c.env.LORE_DB!.put(kvKey, updatedEntry)

    return { key: kvKey, status: 'migrated', d1Id }
  } catch (err) {
    return { key: kvKey, status: 'error', error: String(err) }
  }
}

/**
 * Migrate multiple characters from KV to D1.
 * Processes sequentially; each individual migration has its own error handling.
 * kvList and migrateCharacterKvToD1 both handle their own errors, so this function
 * does not need a surrounding try/catch.
 */
export async function migrateCharactersKvToD1(
  c: { env: AppBindings },
  limit: number = 5,
): Promise<MigrationResult[]> {
  const allKeys = await kvList(c)
  const characterKeys = allKeys
    .filter(k => k.startsWith('character:'))
    .slice(0, limit)

  if (characterKeys.length === 0) {
    return [{ key: 'all', status: 'error', error: 'No character keys found in KV' }]
  }

  const results: MigrationResult[] = []
  for (const key of characterKeys) {
    const result = await migrateCharacterKvToD1(c, key)
    results.push(result)
  }
  return results
}
