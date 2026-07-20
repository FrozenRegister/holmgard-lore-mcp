// Migration: Seed dissolution config into KV
// Idempotent — only writes if key doesn't exist or version is stale
// Usage: Run on deploy via scripts/migrate-dissolution-config.ts

import type { AppBindings } from '../../types'
import { STAGE_MUTATIONS, TERMINAL_CONVERSIONS, DEFAULT_DISSOLUTION_CONFIG } from './dissolution_config'
import { CONFIG_KEY, type SerializedConfig } from './dissolution'

// #472 — bumped for the `terminalStage` field added to SerializedConfig
// (nothing has ever been seeded in production — this function had zero call
// sites before #472 — so there's no live data to migrate; the version bump
// is future-proofing only, matching this file's own existing
// stale-version-update path).
const CONFIG_VERSION = 2

/**
 * Seed the dissolution config into KV if it doesn't exist.
 * Idempotent: skips if key exists with matching version.
 * Only overwrites if version is stale (future-proofing).
 */
export async function seedDissolutionConfigKV(c: { env: AppBindings }): Promise<{
  action: 'seeded' | 'skipped' | 'updated'
  previousVersion?: number
  error?: string
}> {
  try {
    const kv = c.env.LORE_DB
    if (!kv) {
      return { action: 'skipped' }
    }

    // Check if config already exists
    const existing = await kv.get(CONFIG_KEY, 'json') as SerializedConfig | null

    if (existing) {
      // If version matches, we're good — no need to overwrite
      if (existing.version === CONFIG_VERSION) {
        return { action: 'skipped' }
      }
      // If version is stale (lower), update
      if (existing.version < CONFIG_VERSION) {
        const data: SerializedConfig = {
          version: CONFIG_VERSION,
          stages: STAGE_MUTATIONS,
          terminalStage: DEFAULT_DISSOLUTION_CONFIG.terminalStage,
          terminalConversions: TERMINAL_CONVERSIONS,
          migrated_at: new Date().toISOString(),
        }
        await kv.put(CONFIG_KEY, JSON.stringify(data))
        return { action: 'updated', previousVersion: existing.version }
      }
      // Version is higher than expected — don't overwrite
      return { action: 'skipped' }
    }

    // Key doesn't exist — seed it
    const data: SerializedConfig = {
      version: CONFIG_VERSION,
      stages: STAGE_MUTATIONS,
      terminalStage: DEFAULT_DISSOLUTION_CONFIG.terminalStage,
      terminalConversions: TERMINAL_CONVERSIONS,
      migrated_at: new Date().toISOString(),
    }
    await kv.put(CONFIG_KEY, JSON.stringify(data))
    return { action: 'seeded' }
  } catch (err) {
    return { action: 'skipped', error: String(err) }
  }
}
