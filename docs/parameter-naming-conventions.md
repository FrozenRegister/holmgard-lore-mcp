# Parameter Naming Conventions

This document explains the cross-tool parameter naming conventions in the Holmgard Lore MCP, the inconsistencies that exist between the RPG (`rpg`) and non-RPG tools, and the bridges in place to make them interoperable.

## Background

The MCP has two layers of tools with different naming conventions:

1. **RPG tools** (`rpg` monolith with `sub` parameter) — use `camelCase` for multi-word parameters (`worldId`, `characterId`, `encounterId`). These are D1-backed mechanical state tools ported from Mnehmos v1.0.3.

2. **Non-RPG tools** (`continuity_manage`, `world_manage`, `entity_manage`, `scene_manage`, `lore_manage`) — use `snake_case` for multi-word parameters (`world_id`, `entity_key`, `location_key`). These are KV-backed narrative/lore tools.

This split is historical: the RPG layer was ported from a codebase that used camelCase throughout, while the non-RPG layer was designed around KV lore keys that are themselves snake_case (`character:yune`, `location:holmgard`).

## Cross-Tool Parameter Bridge (#377)

As of #377, RPG handlers that accept `worldId` also accept `world_id` as a snake_case alias. The normalization happens at the top of each handler:

```typescript
// #377 — normalize snake_case world_id → camelCase worldId
if (a.worldId === undefined && a.world_id !== undefined) a.worldId = a.world_id
```

Handlers with this bridge:

| Handler | Sub | Notes |
|---|---|---|
| `world-manage.ts` | `world` | `id` and `worldId` are interchangeable aliases |
| `weather-manage.ts` | `weather` | `worldId` required for all actions |
| `corpse-manage.ts` | `corpse` | `worldId` required for `scavenge_check` |
| `character-manage.ts` | (top-level `character_manage` tool) | Same direction as the snippet above (`world_id` → `worldId`); internal logic reads `a.worldId` |
| `time-manage.ts` | `time` | **Bridges the opposite direction** from the snippet above — `time`'s internal logic reads `a.world_id` (snake_case-only originally), so it normalizes camelCase `worldId` → `world_id`, not the other way around. Predates #377 (added in #336, when `time` was the snake_case-only outlier). |

Other RPG subs that accept `worldId` (but don't yet have the `world_id` alias) will be updated incrementally. The `time` sub was the first to get this treatment (#336).

**This per-handler approach only ever covered 5 of ~40 RPG handlers** (#511 tracked the remainder) and only ever bridged `worldId`/`world_id` — every other camelCase/snake_case pair (`entityKey`/`entity_key`, `locationKey`/`location_key`, `sceneKey`/`scene_key`, `factionKey`/`faction_key`, ...) was still silently dropped by whichever tool didn't expect the casing it was given. See the global bridge below, which supersedes this for anything going through `tools/call`.

## Global Parameter-Casing Bridge (#511)

As of #511, casing normalization happens once, at the transport boundary — in `src/index.ts`'s `tools/call` handler, via `normalizeParamCasing()` (`src/lib/normalize-param-casing.ts`) — for **every** tool, not just the 5 RPG handlers above:

```typescript
const args = normalizeParamCasing(
  coerceTransportArgs((params?.arguments ?? {}) as Record<string, any>),
)
```

For every top-level key in the incoming arguments, it adds the other casing's alias if that alias isn't already present:

- `world_id: "w1"` → also sets `worldId: "w1"`
- `entityKey: "character:yune"` → also sets `entity_key: "character:yune"`

It does **not** inspect any tool's Zod schema to decide whether to add an alias — an alias a schema doesn't recognize is simply an extra key that gets silently stripped during validation, exactly as unrecognized keys always have been. This means the bridge works uniformly for every RPG sub and every non-RPG tool with zero per-handler changes, and any new handler gets it automatically.

**Collision safety:** if a caller supplies *both* casings for the same concept (e.g. both `worldId` and `world_id`), normalization is skipped for that key — neither value is touched or overwritten. This has never been a case where the two forms carried different meanings anywhere in this codebase.

**Scope:** this only bridges *top-level* argument keys, same as the 5 handler-level bridges it generalizes. It does not recurse into nested objects or array elements.

**The 5 existing per-handler bridges are now redundant but were deliberately left in place** — they matter for the (mostly test-only) callers that invoke a handler function directly (e.g. `handleTimeManage(env, {...})`) rather than going through `POST /mcp`'s `tools/call`, which is the only place `normalizeParamCasing()` runs.

## Entity Reference Naming

The same character can be referenced by five different parameter names depending on which tool you're calling:

| Parameter | Tool | Type | Example |
|---|---|---|---|
| `entity_key` | `continuity_manage.append_event` | KV lore key | `character:yune` |
| `entity_id` | `continuity_manage.append_event` | D1 character UUID | `550e8400-e29b-41d4-a716-446655440000` |
| `characterId` | `rpg` (most subs) | D1 character UUID | `550e8400-e29b-41d4-a716-446655440000` |
| `id` | `rpg` (character sub) | D1 character UUID (alias for `characterId`) | `550e8400-e29b-41d4-a716-446655440000` |
| `entity_name` | `world_manage.get_entity_knowledge` | KV lore key or alias | `character:yune` or `yune` |

### Translation guide

When a narrative beat spans both layers (e.g., append an event about a character):

1. The RPG layer gives you a `characterId` (D1 UUID) from `rpg({ sub: "character", action: "create" })`.
2. To log an event in `continuity_manage.append_event`, you need an `entity_key` (KV lore key like `character:yune`).
3. The character's KV key is typically `character:<slug>` where slug is the lowercased name.
4. If you also want to dual-write to D1, pass `entity_id` (the D1 UUID) and `world_id` to `append_event`.

## `id` Ambiguity by Sub

The `id` parameter means different things in different RPG subs:

| Sub | `id` means | Also accepts | Notes |
|---|---|---|---|
| `character` | Character UUID | `characterId` (alias) | Both accepted, interchangeable |
| `corpse` | **Corpse UUID** (not character!) | `characterId` (dead character, for create/register only) | `id` is the corpse row PK. `characterId` is the dead character. `looterCharacterId` and `observerCharacterId` are living characters. |
| `encounter` | Encounter ID | — | No `encounterId` param |
| `scene` | Scene UUID | `sceneId` (alias) | Both accepted |
| `waypoint` | Waypoint ID | `waypointId` (alias) | Both accepted |
| `world` | World UUID | `worldId` (alias) | Both accepted |
| `aura` | Aura instance UUID | — | From `create` response |
| `secret` | Secret UUID | — | From `create` response |
| `narrative` | Note UUID | — | From `create` response |
| `quest` | Quest ID | `questId` (alias) | Both accepted |
| `biome` | Biome ID | `biomeId` (alias) | Both accepted |
| `zone_type` | Zone type ID | `zoneTypeId` (alias) | Both accepted |

### Corpse `id` — the worst offender

The `corpse` sub's `id` parameter is the corpse UUID (primary key of the `corpses` table), NOT a character ID. This is the most confusing case because:

- `id` is required for most actions (get, loot, decay, decompose, loot_corpse, recover, get_state, psychological_impact)
- `characterId` is a different thing — it's the dead character's UUID, required only for `create` and `register`
- `looterCharacterId` is a living character who is looting the corpse
- `observerCharacterId` is a living character observing the corpse (for psychological impact)

The schema description (visible via `load_tool_schema({ toolName: "rpg", sub: "corpse" })`) now documents this clearly.

## `worldId` Required vs Optional

| Sub | `worldId` required? | Notes |
|---|---|---|
| `weather` | **Yes** — all actions | Returns clear error if missing |
| `production` | **Yes** — all actions | Returns clear error if missing |
| `broadcast` | **Yes** — all actions | Returns clear error if missing |
| All others | Optional at schema level | May fail at runtime if the action needs it |

For subs where `worldId` is optional at the schema level but required by specific actions, the handler returns a descriptive error message when the parameter is missing (e.g., `"worldId" is required for scavenge_check`).

## Discovering Schemas

Use `load_tool_schema` to discover the parameters for any tool or RPG sub:

```json
// Top-level RPG tool
{ "toolName": "rpg" }

// Sub-level schema (recommended)
{ "toolName": "rpg", "sub": "corpse" }
{ "toolName": "rpg", "sub": "world" }
{ "toolName": "rpg", "sub": "weather" }
```

The sub-level schemas include parameter descriptions that explain what each parameter means and when it's required.

## Summary of Changes (#377)

1. **`world` sub `get_state` bug fixed** — was using `a.id` (potentially undefined) instead of `targetId` for sub-queries, causing crashes when only `worldId` was passed (#376).
2. **`world_id` snake_case alias** added to `world`, `weather`, `corpse`, and `time` subs — bridges the camelCase/snake_case gap between RPG and non-RPG tools.
3. **Corpse schema documented** — `id` is now clearly described as "Corpse UUID" in the schema, with `characterId` described as "Dead character's UUID". The `required` array was fixed to only require `action` (not `id`, since `create`/`register`/`list` don't need it).
4. **Weather schema documented** — `worldId` description now says "required for all weather actions".
5. **World schema documented** — `id` and `worldId` described as interchangeable aliases, `world_id` added as snake_case alias.
6. **This document** created to capture the full cross-tool parameter naming landscape.
