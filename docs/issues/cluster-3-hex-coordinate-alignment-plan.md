# Cluster 3 (#337, #340, #341) — Implementation Plan

**Status:** Plan, not yet implemented.
**Companion doc:** `docs/hex-map-system-architecture.md` (read first — this plan assumes that doc's findings).

## Correcting the premise

Issue #391's Cluster 3 summary frames #337/#340/#341 as needing a new **Cartesian tile-coordinate** mode ("the Preserve uses a 100×100 tile grid... `toX`/`toY`... `x`/`y` for waypoints") alongside the existing room-graph mode. Having read the actual code (both repos, `world-map.ts`, `waypoint-manage.ts`, `encounter-manage.ts`, `party-manage.ts`, and the D1 migrations), **that premise is wrong in a way that changes the plan**:

- The world map, landmarks, waypoints, and party position are **already stored as hex-axial `(q, r)`** in D1 (migrations 0019/0021), not Cartesian.
- `encounter-manage.ts`'s `resolveEncounterCore` already resolves biome by querying `hexes WHERE q = ? AND r = ?` — its parameters are just misleadingly named `x`/`y` (see architecture doc §1).
- `waypoint.register` **already requires `q`/`r` in addition to `lat`/`lon`** (`waypoint-manage.ts:100-101`) — issue #341's premise ("register uses lat/lon, no way to place at tile coordinates") is stale as of the current `main`; this predates the #391 triage, likely landed with #328's Gotland waypoint work (migration 0021).

So this is not "add a Cartesian tile mode to three D&D-shaped handlers." It's "wire `travel` and `spawn` to the hex tables that `world_map`/`waypoint`/`party` already use, using consistent `q`/`r` naming instead of introducing (or perpetuating) a fictional `x`/`y` grid." That's a smaller, lower-risk change than the issue as written implies, and it avoids creating a second coordinate system that would need reconciling with the hex one later (exactly the kind of schism `CLAUDE.md`'s KV/D1 guidance warns against creating).

## #341 (waypoint) — mostly already done; close or narrow

**Recommendation:** Verify against a live/test call, then close #341 with a comment explaining the `q`/`r` requirement already exists, **or** narrow it to the one real gap: `register` currently requires **both** `q`/`r` and `lat`/`lon` (`waypoint-manage.ts:100-101`, two separate `if` checks). A world that hasn't been geo-calibrated (no `world_state.geo_origin_lat/lon`/`geo_km_per_hex` row) has no meaningful `lat`/`lon` to supply, yet `register` still demands them. If Preserve-style worlds (tile/hex-only, no real-world geo anchor) need to register waypoints, that's a one-line relaxation:

```ts
// waypoint-manage.ts, 'register' case
if (a.q === undefined || a.r === undefined) return err('"q" and "r" are required')
// lat/lon become optional — only required if the caller wants geo round-tripping
```

`lat`/`lon` would become nullable in the `waypoints` table write (they're currently `NOT NULL` per migration 0021 — check before relaxing the handler; a schema change may be needed too, or fall back to `0`/`0` sentinel with a documented caveat). This is a judgment call on schema nullability, not spec-following — keep it with a human/full agent, don't delegate.

**Effort:** Trivial to Low (mostly verification; the nullable-lat/lon relaxation is the only real work, and only if a `NOT NULL` schema constraint needs migrating).

## #340 (spawn) — add `place_character`, keep `spawn_character` as the NPC generator

**Current state** (`spawn-manage.ts:54-63`): `spawn_character` always calls `crypto.randomUUID()` for a new `characters.id` — it ignores any `characterId` passed in and never touches map position at all (no `hexes`/`landmarks` write, no `q`/`r` params in the schema).

**Plan:** Add a new action, `place_character`, rather than overloading `spawn_character`'s semantics (the issue's own "Expected behavior" section prefers this as the second option, and it avoids a foot-gun where a typo'd `characterId` silently falls through to NPC generation).

```ts
const ACTIONS = ['spawn_character', 'spawn_encounter', 'spawn_location', 'add_to_encounter', 'list_spawned', 'place_character'] as const
```

`place_character` input: `characterId` (required — must reference an existing `characters` row, error if not found — this is the opposite failure mode of `spawn_character`, which never validates because it always creates), `worldId`, `q`, `r`, optionally `mapId` (defaults `'main'`, matching `hexes`/`landmarks` convention).

Two reasonable placement targets, both consistent with existing schema — a design call for the implementer (not obvious from the issue text, so flag it explicitly rather than guessing silently):

1. **Write to `landmarks`** (a landmark row per placed character) — fits the "named individual on the map" shape `landmarks` already models (id, q, r, name, category), but `landmarks` today has no FK to `characters` and no "this is a live actor, not a static POI" semantic; would need a `character_id` column or reuse of `data` JSON.
2. **Add `current_hex_q`/`current_hex_r`-style columns to `characters`** directly (mirroring `parties.current_hex_q/r` from migration 0021) — cleaner mechanically (position lives with the entity being positioned, queryable without a join), but is schema growth on the `characters` table and duplicates the pattern `parties` already has rather than reusing `landmarks`.

Recommendation: **(2)**, for symmetry with how `parties` already tracks hex position, and because `landmarks` is conceptually "point of interest," not "actor" — conflating the two would make `find_poi`/`query_zone` need to filter out characters. This needs a small migration (`characters.current_hex_q INTEGER`, `characters.current_hex_r INTEGER`, `characters.map_id TEXT`, nullable, no default — most characters aren't on any hex map).

```sql
-- schema/migrations/00XX_character_hex_position.sql
ALTER TABLE characters ADD COLUMN current_hex_q INTEGER;
ALTER TABLE characters ADD COLUMN current_hex_r INTEGER;
ALTER TABLE characters ADD COLUMN map_id TEXT;
```

```ts
case 'place_character': {
  if (!a.characterId) return err('"characterId" is required')
  if (a.q === undefined || a.r === undefined) return err('"q" and "r" are required')
  const char = await db.prepare('SELECT id, name FROM characters WHERE id = ?').bind(a.characterId).first()
  if (!char) return err(`Character not found: ${a.characterId}`)
  await db.prepare('UPDATE characters SET current_hex_q = ?, current_hex_r = ?, map_id = ?, updated_at = ? WHERE id = ?')
    .bind(a.q, a.r, a.mapId ?? 'main', now, a.characterId).run()
  return ok({ success: true, actionType: 'place_character', characterId: a.characterId, name: char.name, q: a.q, r: a.r, mapId: a.mapId ?? 'main' })
}
```

**Effort:** Medium (one new action, one small migration, straightforward tests — good candidate for delegation to a cheaper agent *once the landmarks-vs-characters-column decision above is made* by a human or full agent; the decision itself is not spec-following).

## #337 (travel) — add a hex movement action, reuse `parties.current_hex_q/r`

**Current state** (`travel-manage.ts`): `travel` action is entirely `room_nodes`-based (`toRoomId`/`fromRoomId`+`direction`). `resolveEncounter` support already threads `worldId`/`x`/`y` through to `resolveEncounterCore`, which — per the architecture doc — already queries the `hexes` table by `q`/`r` bound to those misleadingly-named params. So the encounter-resolution half of hex travel already works; what's missing is a travel action that (a) doesn't require a `room_nodes` row at all, and (b) writes the new position somewhere.

**Plan:** Add a `move_hex` action (parallel to, not replacing, `travel`) rather than overloading `travel`'s `toRoomId`/`fromRoomId` branching with a third mode — keeps the room-graph code path (used by dungeon-crawl worlds) untouched and avoids a four-way `if` in one switch case.

```ts
const ACTIONS = ['travel', 'loot', 'rest', 'move_hex'] as const
```

Input: `partyId` (required — hex travel is party-scoped, matching `parties.current_hex_q/r`'s existing ownership), `toQ`, `toR` (required — **use `q`/`r` naming, not `x`/`y`**, to match the schema and avoid perpetuating the naming confusion flagged in the architecture doc), `worldId` (required for biome/encounter lookup), plus the existing `resolveEncounter`/`partySize`/`timeOfDay`/etc. params (reused as-is — `resolveEncounterCore`'s signature doesn't need to change, only the caller needs to stop calling its params `x`/`y` internally, which is a bonus cleanup, not a breaking change since they're not part of the public tool schema for `travel`).

```ts
case 'move_hex': {
  if (!a.partyId) return err('"partyId" is required')
  if (!a.worldId) return err('"worldId" is required')
  if (a.toQ === undefined || a.toR === undefined) return err('"toQ" and "toR" are required')
  const party = await db.prepare('SELECT id FROM parties WHERE id = ?').bind(a.partyId).first()
  if (!party) return err(`Party not found: ${a.partyId}`)
  const hex = await db.prepare('SELECT biome FROM hexes WHERE world_id = ? AND q = ? AND r = ?').bind(a.worldId, a.toQ, a.toR).first() as { biome: string } | null
  await db.prepare('UPDATE parties SET current_hex_q = ?, current_hex_r = ?, updated_at = ? WHERE id = ?').bind(a.toQ, a.toR, now, a.partyId).run()
  if (a.resolveEncounter) {
    const encounter = await resolveEncounterCore(db, { worldId: a.worldId, x: a.toQ, y: a.toR, partySize: a.partySize, timeOfDay: a.timeOfDay, noiseLevel: a.noiseLevel, scentModifiers: a.scentModifiers, partyInjuries: a.partyInjuries, weather: a.weather, includeInjuries: a.includeInjuries, characterIds: a.characterIds })
    return ok({ success: true, actionType: 'move_hex', partyId: a.partyId, q: a.toQ, r: a.toR, biome: hex?.biome ?? null, encounter })
  }
  return ok({ success: true, actionType: 'move_hex', partyId: a.partyId, q: a.toQ, r: a.toR, biome: hex?.biome ?? null })
}
```

Movement cost (the issue's "queries biome for movement cost" ask) is **not** implemented here — there's no existing biome→cost table server-side (the client has `DEFAULT_TERRAIN_COSTS` in `mapTools.ts`, but that's client-only pathfinding, not synced to D1). Adding server-side movement cost is a separate, smaller follow-up once someone decides whether biome movement cost is narrator-set data (KV-shaped) or a fixed registry (D1-shaped, like `zone_types`/`biome-manage.ts`'s existing per-world biome registry) — flag as an open question rather than guessing.

**Depends on #340's `characters.current_hex_q/r` migration** only if per-character (not just per-party) position is wanted; party-level position alone (already present via migration 0021) is sufficient for `move_hex` as scoped above.

**Effort:** Medium. The encounter-resolution wiring already exists and just needs calling with correct naming; the new bit is the party-position UPDATE and the new action's tests (happy path, party not found, hex not found → still succeeds with `biome: null` since `hexes` rows aren't required to exist for every `q`/`r`, per `world_map`'s own graceful-degradation convention).

## Suggested execution order

1. **#341** — verify current behavior first (may just need closing with an explanatory comment); only do the `lat`/`lon`-optional relaxation if a concrete Preserve-style non-geo-calibrated world actually needs it.
2. **#340** — the `characters.current_hex_q/r` migration is a prerequisite most naturally done here; #337 doesn't strictly need it (party position is enough) but sequencing #340 first means both a character's and a party's map position use the same column-naming convention (`current_hex_q`/`current_hex_r`), reviewed once instead of twice.
3. **#337** — `move_hex`, reusing the encounter-resolution path that already exists.

All three should update `CLAUDE.md`'s architecture section (new actions on `travel`/`spawn`/`waypoint`) and both test suites (workers + live), per repo policy. Each also needs a `.changelog/fragments/` entry (`src/` changed) and — since these are new handler actions — 100% patch coverage including the "not found" and "hex has no biome row" branches.

## What this plan deliberately does not do

- **Does not touch `combat_map`** — that's an intentionally separate square tactical grid (see architecture doc §1); Cluster 3 is about the *world* map, not the *combat* map.
- **Does not drop `parties.position_x/position_y`** — dead but out of scope here, per migration 0021's own note; a separate small cleanup PR.
- **Does not rename `resolveEncounterCore`'s `x`/`y` parameters** in this pass, to avoid scope creep into a function with several existing call sites — noted as a follow-up cleanup in the architecture doc, not bundled into Cluster 3.
