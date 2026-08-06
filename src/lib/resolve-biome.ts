// #433 — bridges the hexes table's `terrain` (editor-owned, freeform strings
// like "Woods") and `biome` (MCP-owned, registry-validated names like
// "forest") columns. The two are intentionally decoupled (migration 0019,
// admin push-hexes COALESCE guard) so a hex can have `terrain` set with
// `biome` NULL — encounter/spawn handlers that only read `biome` would treat
// that hex as unclassified even though the editor's paint implies a biome.
//
// This is a best-effort fallback, not a source of truth: it looks at other
// hexes in the same world that share the same terrain string and already
// have a biome assigned (via world_map.patch or manual assignment), and
// picks the most common one. If no hex has ever bridged that terrain string
// to a biome, there is nothing to resolve to and the caller keeps treating
// the hex as unclassified — same behavior as before this helper existed.

export interface ResolvedBiome {
  biome: string | null
  // 'direct': hex already had biome set. 'terrain_bridge': resolved via a
  // sibling hex sharing the same terrain string. 'none': no biome found.
  source: 'direct' | 'terrain_bridge' | 'none'
}

/**
 * Given a terrain string, finds the biome most commonly assigned to other
 * hexes in the same world with that exact terrain (case-insensitive).
 * Deterministic: ties broken by biome name ascending, so repeated calls
 * against unchanged data always return the same result.
 */
export async function resolveBiomeForTerrain(
  db: D1Database,
  worldId: string,
  terrain: string,
): Promise<string | null> {
  const row = (await db
    .prepare(
      `SELECT biome, COUNT(*) as cnt
       FROM hexes
       WHERE world_id = ? AND terrain = ? COLLATE NOCASE AND biome IS NOT NULL
       GROUP BY biome
       ORDER BY cnt DESC, biome ASC
       LIMIT 1`,
    )
    .bind(worldId, terrain)
    .first()) as { biome: string; cnt: number } | null
  return row?.biome ?? null
}

/**
 * Resolves the effective biome for a specific hex: its own `biome` column if
 * set, otherwise a terrain→biome bridge via `resolveBiomeForTerrain`.
 */
export async function resolveBiomeForHex(
  db: D1Database,
  worldId: string,
  q: number,
  r: number,
): Promise<ResolvedBiome> {
  const hex = (await db
    .prepare('SELECT biome, terrain FROM hexes WHERE world_id = ? AND q = ? AND r = ?')
    .bind(worldId, q, r)
    .first()) as { biome: string | null; terrain: string | null } | null

  if (!hex) return { biome: null, source: 'none' }
  if (hex.biome) return { biome: hex.biome, source: 'direct' }
  if (!hex.terrain) return { biome: null, source: 'none' }

  const bridged = await resolveBiomeForTerrain(db, worldId, hex.terrain)
  return bridged ? { biome: bridged, source: 'terrain_bridge' } : { biome: null, source: 'none' }
}
