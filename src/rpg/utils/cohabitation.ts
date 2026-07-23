// src/rpg/utils/cohabitation.ts
// #315 — shared host/driver resolution for co-habitating characters.
//
// Reuses the existing host_body_id/active model from #226 Phase 2 (migration
// 0008) rather than the parallel co_habitation junction table #315 originally
// proposed — character-manage.ts's `activate`/`list_passengers` already own
// group membership and driver switching. This module adds the one piece that
// was still missing: resolving *combat/check stats* through the split —
// physical (str/dex/con/hp/max_hp/ac) always from the host body row, mental
// (int/wis/cha) from whichever row in the group currently has active = 1.
//
// A co-habitation group is the host row (its own host_body_id is NULL) plus
// every row whose host_body_id points to the host's id — see migration
// 0008's comment for why host_body_id has no inline REFERENCES clause (it's
// a plain TEXT column by convention, not FK-enforced, so a dangling
// host_body_id pointing at a deleted/nonexistent host row is reachable — in
// that case we fall back to treating the requested character as its own
// host rather than silently resolving against a row that doesn't exist).

export interface StatBlock {
  str: number
  dex: number
  con: number
  int: number
  wis: number
  cha: number
}

interface GroupRow {
  id: string
  name: string
  stats: string
  hp: number
  max_hp: number
  ac: number
  active: number
  updated_at: string
}

interface Group {
  characterId: string
  hostRow: GroupRow
  rows: GroupRow[]
}

async function fetchGroup(db: D1Database, characterId: string): Promise<Group | null> {
  const char = (await db
    .prepare('SELECT host_body_id FROM characters WHERE id = ?')
    .bind(characterId)
    .first()) as { host_body_id: string | null } | null
  if (!char) return null
  const claimedHostBodyId = char.host_body_id ?? characterId

  const { results } = (await db
    .prepare(
      'SELECT id, name, stats, hp, max_hp, ac, active, updated_at FROM characters WHERE id = ? OR host_body_id = ?',
    )
    .bind(claimedHostBodyId, claimedHostBodyId)
    .all()) as { results: GroupRow[] }

  // `characterId` is always present in `results`: either it *is* the host
  // (claimedHostBodyId === characterId, matched by the `id = ?` clause), or
  // its own host_body_id column equals claimedHostBodyId (matched by the
  // `host_body_id = ?` clause). If the claimed host row itself doesn't exist
  // (dangling reference), fall back to the requesting character as its own
  // host rather than resolving against a phantom id.
  const hostRow =
    results.find((r) => r.id === claimedHostBodyId) ?? results.find((r) => r.id === characterId)!

  return { characterId, hostRow, rows: results }
}

function pickDriver(rows: GroupRow[], hostRow: GroupRow): GroupRow {
  const activeRows = rows.filter((r) => r.active === 1)
  if (activeRows.length === 0) return hostRow
  // Tie-break on most-recently-updated: `activate` bumps updated_at on the row
  // it activates, so the most recent claim wins even though the host's own row
  // is never deactivated by `activate` (it only toggles sibling passenger rows).
  return activeRows.reduce((best, r) => (r.updated_at > best.updated_at ? r : best))
}

export interface CohabitationResolution {
  hostBodyId: string
  driverId: string
  isCohabitating: boolean
}

// Resolves the host-body id and current driver id for any character id in a
// co-habitation group (host row or passenger row). Returns null if the
// character doesn't exist. A solo (non-co-habitating) character resolves to
// itself for both hostBodyId and driverId.
export async function resolveCohabitation(
  db: D1Database,
  characterId: string,
): Promise<CohabitationResolution | null> {
  const group = await fetchGroup(db, characterId)
  if (!group) return null
  const { hostRow, rows } = group

  return {
    hostBodyId: hostRow.id,
    driverId: pickDriver(rows, hostRow).id,
    isCohabitating: rows.length > 1,
  }
}

export interface EffectiveStats {
  hostBodyId: string
  driverId: string
  isCohabitating: boolean
  name: string
  stats: StatBlock
  hp: number
  max_hp: number
  ac: number
}

// Resolves the *effective* combat/check profile for a character id: physical
// stats + HP pool + AC always from the host body row; mental stats (and the
// display name) from the current driver. For a non-co-habitating character
// this is simply its own row. Returns null only if the character itself
// doesn't exist.
export async function resolveEffectiveStats(
  db: D1Database,
  characterId: string,
): Promise<EffectiveStats | null> {
  const group = await fetchGroup(db, characterId)
  if (!group) return null
  const { hostRow, rows } = group

  const driverRow = pickDriver(rows, hostRow)
  const hostStats = JSON.parse(hostRow.stats) as StatBlock
  const mentalStats =
    driverRow.id === hostRow.id ? hostStats : (JSON.parse(driverRow.stats) as StatBlock)

  return {
    hostBodyId: hostRow.id,
    driverId: driverRow.id,
    isCohabitating: rows.length > 1,
    name: driverRow.name,
    stats: {
      str: hostStats.str,
      dex: hostStats.dex,
      con: hostStats.con,
      int: mentalStats.int,
      wis: mentalStats.wis,
      cha: mentalStats.cha,
    },
    hp: hostRow.hp,
    max_hp: hostRow.max_hp,
    ac: hostRow.ac,
  }
}
