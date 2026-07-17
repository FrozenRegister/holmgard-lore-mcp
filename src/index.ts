// src/index.ts — slim entry point
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import type { AppBindings } from './types'
import { makeResult, makeError, validateRequest } from './lib/rpc'
import { kvGet, kvList, getKV } from './lib/kv'
import { parseKvEntry } from './lib/lore'
import rateLimitMiddleware, { wsReconnectRateLimit } from './middleware/rate-limit'
import { requestIdMiddleware, type RequestIdVariables } from './middleware/request-id'
import { toolDefinitions } from './tools/definitions'
import { toolRegistry } from './tools/registry'
import adminRoutes from './admin/routes'
import changesRouter from './changes/route'
import { HolmgardMCP } from './do/HolmgardMCP'
import { setToolIndex, setSchemaIndex, registerRpgSubSchema, registerRpgAlias } from './rpg/registry'
import { mathManageSchemaDoc } from './rpg/definitions'
import { handleBiomeManage } from './rpg/handlers/biome-manage'
import internalRoutes from './internal/routes'
import entityReadsRouter from './api/entity-reads'

// Export the DO class so wrangler can bind it
export { HolmgardMCP }

// Initialize meta-tool indexes once at module load time
setToolIndex(toolDefinitions.map((t: any) => ({ name: t.name, description: t.description ?? '' })))
// mathManageSchemaDoc is schema-index-only — it documents rpg({sub:'math',...})'s
// dice-notation grammar for load_tool_schema, but "math_manage" has no registry
// handler of its own, so it must not be added to the tool index (that would
// advertise a callable tool that 404s on tools/call).
setSchemaIndex([...toolDefinitions, mathManageSchemaDoc].map((t: any) => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema })))

// #339 — register rpg sub-level schemas so load_tool_schema({ toolName: "rpg", sub: "corpse" }) works.
// These are static documentation schemas describing each sub's parameters,
// extracted from their Zod InputSchema definitions.
// #404 (Tier 1) — a sub-level alias (same handler, different name a narrator
// might reach for) reuses its canonical entry's description/schema via
// `aliasOf` instead of hand-copying them — the exact copy-paste fragility
// that made "stealth"'s old duplicated entry drift from "perception"'s.
type SubSchemaEntry =
  | { sub: string; description: string; schema: Record<string, unknown> }
  | { sub: string; aliasOf: string }

const SUB_SCHEMAS: SubSchemaEntry[] = [
  // ── Already registered (kept as-is) ──────────────────────────────────────
  { sub: 'corpse', description: 'Corpse ecology — decomposition, scavenging, looting, psychological impact. Actions: create, get, list, loot, decay, generate_loot, delete, register, decompose, scavenge_check, loot_corpse, recover, get_state, psychological_impact. NOTE: "id" is the corpse UUID (primary key of the corpses table), NOT a character ID. "characterId" is the dead character\'s UUID (required for create/register). "looterCharacterId" and "observerCharacterId" are living characters acting on the corpse. See docs/parameter-naming-conventions.md for the full cross-tool reference.',
    schema: { type: 'object', properties: { action: { type: 'string' }, id: { type: 'string', description: 'Corpse UUID (primary key of corpses table). Required for get/loot/decay/decompose/loot_corpse/recover/get_state/psychological_impact. NOT a character ID — use "characterId" for the dead character.' }, characterId: { type: 'string', description: 'Dead character\'s UUID. Required for create/register. Stored in corpses.character_id.' }, characterName: { type: 'string', description: 'Dead character\'s name. Required for create/register.' }, worldId: { type: 'string', description: 'World UUID. Accepts snake_case "world_id" as alias. Required for scavenge_check.' }, world_id: { type: 'string', description: 'Snake_case alias for worldId (cross-tool compatibility with non-RPG tools).' }, hoursSinceDeath: { type: 'number', description: 'Override computed elapsed time (decompose only)' }, looterCharacterId: { type: 'string', description: 'Character UUID of the looter (loot_corpse only)' }, observerCharacterId: { type: 'string', description: 'Character UUID of the observer (psychological_impact only)' }, recoveryType: { type: 'string', enum: ['memorial_package', 'warning_display', 'trophy_recovery', 'research_recovery'] }, relationship: { type: 'string', enum: ['stranger', 'party_member', 'betrayed_them', 'saved_them'] } }, required: ['action'] } },
  { sub: 'quest', description: 'Quest management. Actions: create, get, list, update, delete, complete, fail, add_objective, complete_objective.',
    schema: { type: 'object', properties: { action: { type: 'string' }, id: { type: 'string' }, questId: { type: 'string' }, worldId: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, objective: { type: 'object', description: '{ description: string, completed?: boolean, order?: number }' }, rewards: { type: 'object' }, prerequisites: { type: 'array', items: { type: 'string' } }, fields: { type: 'object', additionalProperties: true, description: '#425 — arbitrary D1 column passthrough for `update`. Blacklist: id, created_at, updated_at, world_id.' } }, required: ['action'] } },
  { sub: 'combat', description: 'Combat encounter management. Actions: create_encounter, get_encounter, list_encounters, add_combatant, remove_combatant, start, end, next_turn, get_state, death_save, legendary_action, lair_action.',
    schema: { type: 'object', properties: { action: { type: 'string' }, id: { type: 'string', description: 'Encounter ID' }, regionId: { type: 'string' }, characterId: { type: 'string' }, token: { type: 'object', description: '{ name: string, type: "pc"|"npc"|"enemy"|"neutral", initiative?: number, hp?: number }' }, filter: { type: 'string', enum: ['all', 'active', 'completed'] } }, required: ['action'] } },
  { sub: 'combat_action', description: 'Combat actions (attack, cast, use item). Actions: attack, cast, use_item, heal, defend, dodge, ready.',
    schema: { type: 'object', properties: { action: { type: 'string' }, encounterId: { type: 'string' }, actorId: { type: 'string' }, targetId: { type: 'string' }, weaponName: { type: 'string' }, spellName: { type: 'string' }, attackRoll: { type: 'number' }, damageRoll: { type: 'string' } }, required: ['action'] } },
  // ── #366 — character: add find_by_name and kill ─────────────────────────
  { sub: 'character', description: 'Character CRUD and management. Actions: create, get, list, update, delete, search, find_by_name, add_xp, get_progression, level_up, cast_spell, snapshot, activate, list_passengers, recompute_derived, kill.',
    schema: { type: 'object', properties: { action: { type: 'string' }, id: { type: 'string' }, characterId: { type: 'string' }, name: { type: 'string' }, worldId: { type: 'string' }, characterClass: { type: 'string' }, race: { type: 'string' }, level: { type: 'number' }, hp: { type: 'number' }, maxHp: { type: 'number' }, ac: { type: 'number' }, stats: { type: 'object' }, query: { type: 'string', description: 'Search query for search action' }, xp: { type: 'number' }, spellName: { type: 'string' }, slotLevel: { type: 'number' }, limit: { type: 'number' }, killerId: { type: 'string' }, causeOfDeath: { type: 'string' }, fields: { type: 'object', additionalProperties: true, description: '#425 — arbitrary D1 column passthrough for `update`, e.g. columns with no dedicated param yet. Blacklist: id, created_at, updated_at, world_id.' } }, required: ['action'] } },
  // #404 (Tier 1) — plural alias.
  { sub: 'characters', aliasOf: 'character' },
  { sub: 'aura', description: 'Aura and concentration management. Actions: create, get, list, remove, expire, get_affecting, concentrate, break_concentration, check_save, check_duration.',
    schema: { type: 'object', properties: { action: { type: 'string' }, id: { type: 'string', description: 'Aura instance UUID from create' }, ownerId: { type: 'string' }, targetId: { type: 'string' }, characterId: { type: 'string' }, spellName: { type: 'string' }, spellLevel: { type: 'number' }, radius: { type: 'number' } }, required: ['action'] } },
  { sub: 'secret', description: 'Secret management (hidden knowledge, backstory). Actions: create, get, list, update, delete, reveal, check_reveal.',
    schema: { type: 'object', properties: { action: { type: 'string' }, id: { type: 'string', description: 'Secret UUID from create' }, worldId: { type: 'string' }, name: { type: 'string' }, publicDescription: { type: 'string' }, secretDescription: { type: 'string' }, linkedEntityId: { type: 'string' }, sensitivity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, fields: { type: 'object', additionalProperties: true, description: '#425 — arbitrary D1 column passthrough for `update` (e.g. notes, linked_entity_type, leak_patterns, category). Blacklist: id, created_at, updated_at, world_id.' } }, required: ['action'] } },
  { sub: 'narrative', description: 'Narrative notes (plot threads, session logs). Actions: create, get, list, update, delete, archive, resolve.',
    schema: { type: 'object', properties: { action: { type: 'string' }, id: { type: 'string', description: 'Note UUID (noteId) from create' }, worldId: { type: 'string' }, type: { type: 'string', enum: ['plot_thread', 'canonical_moment', 'npc_voice', 'foreshadowing', 'session_log'] }, content: { type: 'string' }, visibility: { type: 'string', enum: ['dm_only', 'player_visible'] } }, required: ['action'] } },
  { sub: 'production', description: 'Production cycle — advance_day, perimeter, extraction. Actions: advance_day, get_state, update_state, set_schedule, list_events.',
    schema: { type: 'object', properties: { action: { type: 'string' }, worldId: { type: 'string' }, daysToAdvance: { type: 'number' }, fields: { type: 'object', additionalProperties: true, description: '#425 — arbitrary world_state column passthrough for `update_state` (e.g. production_mood, era, tick_speed — columns with no other write path). Blacklist: world_id.' } }, required: ['action', 'worldId'] } },
  { sub: 'stealth', aliasOf: 'perception' },

  // ── #360 — item: add schema with search action ───────────────────────────
  { sub: 'item', description: 'Item CRUD and search. Actions: create, get, list, update, delete, search.',
    schema: { type: 'object', properties: { action: { type: 'string' }, id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, type: { type: 'string' }, weight: { type: 'number' }, value: { type: 'number' }, query: { type: 'string', description: 'Search query for search action' }, itemType: { type: 'string' }, limit: { type: 'number' } }, required: ['action'] } },

  // ── #361 — resource: fix to match actual handler actions ─────────────────
  { sub: 'resource', description: 'Resource survival — prize crates, degradation, scavenging, crafting, improvisation. Actions: crate_drop, consume, degrade, improvise, scavenge, craft, get_state.',
    schema: { type: 'object', properties: { action: { type: 'string' }, ownerType: { type: 'string', enum: ['character', 'party'] }, ownerId: { type: 'string' }, worldId: { type: 'string' }, itemName: { type: 'string' }, category: { type: 'string', enum: ['medical', 'food', 'tools', 'weapon', 'intel'] }, quantity: { type: 'number' }, dayNumber: { type: 'number' }, ateToday: { type: 'boolean' }, complexity: { type: 'string', enum: ['basic', 'moderate', 'complex'] } }, required: ['action'] } },

  // ── #361 — broadcast: fix to match actual handler actions ────────────────
  { sub: 'broadcast', description: 'Broadcast and production intervention — audience approval, votes, interventions, Celeste moments. Actions: audience_pulse, resolve_vote, production_intervene, celeste_moment, get_state, trigger_event.',
    schema: { type: 'object', properties: { action: { type: 'string' }, worldId: { type: 'string' }, characterId: { type: 'string' }, voteType: { type: 'string', enum: ['fan_favorite', 'mercy_kill', 'hazard_boost', 'prize_drop_location', 'showdown'] }, interventionType: { type: 'string', enum: ['drone_harassment', 'predator_release', 'audio_broadcast', 'fake_prize_drop', 'perimeter_pulse', 'celeste_spotlight', 'medical_intervention', 'sabotage'] }, eventType: { type: 'string' }, direction: { type: 'string', enum: ['positive', 'negative'] }, winningOption: { type: 'string' } }, required: ['action', 'worldId'] } },

  // ── #362 — all previously missing rpg subs ───────────────────────────────
  { sub: 'math', description: 'Dice rolling, probability, and projectile physics. Actions: roll, probability, projectile, get_history.',
    schema: { type: 'object', properties: { action: { type: 'string' }, expression: { type: 'string', description: 'Dice notation (e.g. "2d20kh1+5", "4d6dl1")' }, target: { type: 'number' }, comparison: { type: 'string', enum: ['gte', 'lte', 'eq', 'gt', 'lt'] }, sides: { type: 'number' }, velocity: { type: 'number' }, angle: { type: 'number' }, gravity: { type: 'number' }, height: { type: 'number' }, sessionId: { type: 'string' }, limit: { type: 'number' } }, required: ['action'] } },
  { sub: 'world', description: 'World generation and management. Actions: create, get, list, delete, update, generate, get_state. "id" and "worldId" are interchangeable aliases for the world UUID. Accepts snake_case "world_id" as alias for "worldId" (cross-tool compatibility).',
    schema: { type: 'object', properties: { action: { type: 'string' }, id: { type: 'string', description: 'World UUID (alias for worldId)' }, worldId: { type: 'string', description: 'World UUID (alias for id)' }, world_id: { type: 'string', description: 'Snake_case alias for worldId (cross-tool compatibility with non-RPG tools)' }, name: { type: 'string' }, seed: { type: 'string' }, width: { type: 'number' }, height: { type: 'number' }, landRatio: { type: 'number' }, environment: { type: 'object' }, theme: { type: 'string' }, fields: { type: 'object', additionalProperties: true, description: '#425 — arbitrary D1 column passthrough for `update` (e.g. universe_id). Blacklist: id, created_at, updated_at.' } }, required: ['action'] } },
  { sub: 'party', description: 'Party management — creation, membership, trust, morale, march. Actions: create, get, list, update, delete, add_member, remove_member, set_leader, trust_shift, resolve_conflict, betrayal_check, morale_roll, watch_rotation, begin_march, get_march_status.',
    schema: { type: 'object', properties: { action: { type: 'string' }, id: { type: 'string' }, partyId: { type: 'string' }, name: { type: 'string' }, worldId: { type: 'string' }, characterId: { type: 'string' }, role: { type: 'string', enum: ['leader', 'member', 'companion', 'hireling', 'prisoner', 'mount'] }, fromCharacterId: { type: 'string' }, towardCharacterId: { type: 'string' }, status: { type: 'string', enum: ['active', 'dormant', 'archived'] }, fields: { type: 'object', additionalProperties: true, description: '#425 — arbitrary D1 column passthrough for `update` (e.g. formation, current_location, current_quest_id, current_poi, last_played_at). Blacklist: id, created_at, updated_at, world_id.' } }, required: ['action'] } },
  { sub: 'inventory', description: 'Character inventory management. Actions: add, remove, list, get, transfer, equip, unequip, use_item.',
    schema: { type: 'object', properties: { action: { type: 'string' }, characterId: { type: 'string' }, itemId: { type: 'string' }, quantity: { type: 'number' }, slot: { type: 'string' }, targetCharacterId: { type: 'string' }, worldId: { type: 'string' } }, required: ['action'] } },
  { sub: 'theft', description: 'Theft and pickpocket mechanics. Actions: attempt, check_dc, get_result, list_attempts.',
    schema: { type: 'object', properties: { action: { type: 'string' }, thiefId: { type: 'string' }, targetId: { type: 'string' }, itemId: { type: 'string' }, worldId: { type: 'string' }, checkType: { type: 'string', enum: ['stealth', 'sleight_of_hand', 'deception'] } }, required: ['action'] } },
  { sub: 'improvisation', description: 'Improvisation and jury-rigging. Actions: attempt, check_dc, get_result, list_recipes.',
    schema: { type: 'object', properties: { action: { type: 'string' }, characterId: { type: 'string' }, worldId: { type: 'string' }, recipeName: { type: 'string' }, materials: { type: 'array', items: { type: 'string' } }, complexity: { type: 'string', enum: ['trivial', 'easy', 'moderate', 'hard', 'extreme'] } }, required: ['action'] } },
  { sub: 'npc', description: 'NPC generation and behavior. Actions: generate, get, list, update, delete, react, get_dialogue.',
    schema: { type: 'object', properties: { action: { type: 'string' }, id: { type: 'string' }, worldId: { type: 'string' }, archetype: { type: 'string' }, personality: { type: 'string' }, role: { type: 'string' }, disposition: { type: 'string' } }, required: ['action'] } },
  // #404 (Tier 1) — descriptive alias for dialogue/reaction actions.
  { sub: 'npc_dialogue', aliasOf: 'npc' },
  { sub: 'session', description: 'Session management and state tracking. Actions: create, get, list, end, get_summary, save_checkpoint.',
    schema: { type: 'object', properties: { action: { type: 'string' }, id: { type: 'string' }, sessionId: { type: 'string' }, worldId: { type: 'string' }, name: { type: 'string' } }, required: ['action'] } },
  { sub: 'combat_map', description: 'Combat map grid and positioning. Actions: create, get, place_token, move_token, remove_token, get_adjacent, measure_distance.',
    schema: { type: 'object', properties: { action: { type: 'string' }, id: { type: 'string' }, encounterId: { type: 'string' }, tokenId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } }, required: ['action'] } },
  { sub: 'spawn', description: 'Entity spawning — characters, encounters, locations. Actions: spawn_character, spawn_encounter, spawn_location, add_to_encounter, list_spawned.',
    schema: { type: 'object', properties: { action: { type: 'string' }, name: { type: 'string' }, characterType: { type: 'string', enum: ['pc', 'npc', 'enemy', 'neutral'] }, characterClass: { type: 'string' }, race: { type: 'string' }, level: { type: 'number' }, hp: { type: 'number' }, ac: { type: 'number' }, encounterId: { type: 'string' }, regionId: { type: 'string' }, worldId: { type: 'string' }, count: { type: 'number' } }, required: ['action'] } },
  { sub: 'strategy', description: 'Grand strategy — nations, alliances, regions. Actions: create_nation, get_state, propose_alliance, claim_region, resolve_turn, list_nations.',
    schema: { type: 'object', properties: { action: { type: 'string' }, worldId: { type: 'string' }, nationId: { type: 'string' }, name: { type: 'string' }, leader: { type: 'string' }, ideology: { type: 'string', enum: ['democracy', 'autocracy', 'theocracy', 'tribal'] }, aggression: { type: 'number' }, trust: { type: 'number' } }, required: ['action'] } },
  { sub: 'turn', description: 'Turn order and initiative tracking. Actions: start, next, get_current, set_initiative, skip, reset.',
    schema: { type: 'object', properties: { action: { type: 'string' }, encounterId: { type: 'string' }, characterId: { type: 'string' }, initiative: { type: 'number' }, worldId: { type: 'string' } }, required: ['action'] } },
  { sub: 'spatial', description: 'Spatial queries — adjacency, range, line of sight. Actions: get_neighbors, get_in_radius, check_line_of_sight, get_distance, get_path.',
    schema: { type: 'object', properties: { action: { type: 'string' }, originId: { type: 'string' }, targetId: { type: 'string' }, radius: { type: 'number' }, worldId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, required: ['action'] } },
  // #423 — rewritten to match the actual hex-axial handler (world-map.ts),
  // rewritten for #320/#308-Phase-2 from a square-grid model this schema still
  // described until now. Coordinates are hex-axial q,r, not square x,y.
  { sub: 'world_map', description: 'Hex world map — hex tiles, landmarks, zones, POIs, SVG export, distance/pathfinding (#430). Actions: overview, region, hexes, patch, batch, preview, find_poi, suggest_poi, update_poi, query_zone, list_zones, render_svg, distance, pathfind. Aliases: update/update_tiles/update_hexes/modify→patch, tiles/get_tiles/get_hexes/hex_data→hexes, bulk/bulk_import/import_hexes→batch, search_poi/get_poi→find_poi, render/ascii/view→preview, svg/export_svg/map_svg→render_svg, dist/get_distance→distance, route/find_path/navigate/find_route→pathfind. Coordinates are hex-axial q,r (not square x,y). distance/pathfind report straightLineKm/totalKm/totalDays only when the world is geo-calibrated via waypoint.calibrate — otherwise those fields are null with an explanatory note, though hexDistance/path/terrainBreakdown hex counts are always accurate.',
    schema: { type: 'object', properties: {
      action: { type: 'string' },
      worldId: { type: 'string', description: 'World UUID (required for most actions)' },
      mapId: { type: 'string', description: 'Map identifier (default "main")' },
      q: { type: 'integer', description: 'Hex-axial column coordinate' },
      r: { type: 'integer', description: 'Hex-axial row coordinate' },
      width: { type: 'integer', description: 'Viewport width in hexes (hexes/preview/overview)' },
      height: { type: 'integer', description: 'Viewport height in hexes (hexes/preview/overview)' },
      hexes: { type: 'array', items: { type: 'object', properties: {
        q: { type: 'integer' }, r: { type: 'integer' },
        biome: { type: 'string' }, elevation: { type: 'integer' },
        moisture: { type: 'integer' }, temperature: { type: 'integer' },
        waterDepth: { type: ['number', 'null'], description: 'Fording depth in meters (#431). null = no explicit fording rule for this hex (defers to the biome\'s movement cost). Takes precedence over biome cost for foot/horse/carriage/car when set; ignored for aircraft.' },
      } }, description: 'Hex tile array for patch/batch actions' },
      validateBiomes: { type: 'boolean', description: 'Validate biomes against registry (batch, default true)' },
      regionId: { type: 'string', description: 'Region UUID (region/overview)' },
      query: { type: 'string', description: 'Search query or POI name' },
      structureType: { type: 'string', description: 'Landmark category' },
      structureId: { type: 'string', description: 'Landmark UUID (update_poi only)' },
      name: { type: 'string', description: 'Landmark name' },
      radius: { type: 'number', description: 'Zone circle radius in hexes' },
      polygon: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'Zone polygon as [q,r] pairs' },
      ringInner: { type: 'number', description: 'Zone ring inner radius' },
      ringOuter: { type: 'number', description: 'Zone ring outer radius' },
      ringPoints: { type: 'integer', description: 'Zone ring point count' },
      zoneType: { type: 'string', description: 'Zone type from zone_type registry' },
      predatorRef: { type: 'string', description: 'Entity lore key for zone predator' },
      threatLevel: { type: 'number', description: 'Threat level 0-100' },
      dominanceRank: { type: 'integer' },
      renderWidth: { type: 'integer', description: 'SVG viewport width in hexes (1-200)' },
      renderHeight: { type: 'integer', description: 'SVG viewport height in hexes (1-200)' },
      showStructures: { type: 'boolean' },
      showZones: { type: 'boolean' },
      showPerimeter: { type: 'boolean' },
      gridLabels: { type: 'boolean' },
      highlight: { type: 'array', items: { type: 'object', properties: {
        q: { type: 'number' }, r: { type: 'number' }, label: { type: 'string' }, color: { type: 'string' },
      } } },
      from: { type: 'object', properties: { q: { type: 'integer' }, r: { type: 'integer' } }, description: 'Origin hex for distance/pathfind (#430)' },
      to: { type: 'object', properties: { q: { type: 'integer' }, r: { type: 'integer' } }, description: 'Destination hex for distance/pathfind (#430)' },
      mode: { type: 'string', enum: ['foot', 'horse', 'carriage', 'car', 'aircraft'], description: 'Transport mode for distance/pathfind (#430). Defaults to foot. Same per-hex cost model as travel.move_hex (#429/#431).' },
      avoid: { type: 'array', items: { type: 'string' }, description: 'pathfind only (#430). Biome names or zone_type values to route around — matched against each world\'s own dynamic registries, not a fixed list.' },
    }, required: ['action'] } },
  // #404 (Tier 1) — shorter alias. Inherits the corrected schema above automatically.
  { sub: 'maps', aliasOf: 'world_map' },
  { sub: 'batch', description: 'Batch operations — bulk create/update/delete across handlers. Actions: create_many, update_many, delete_many, get_many.',
    schema: { type: 'object', properties: { action: { type: 'string' }, operations: { type: 'array', items: { type: 'object' } }, worldId: { type: 'string' }, entityType: { type: 'string' } }, required: ['action'] } },
  // #429 — corrected description/schema to match travel-manage.ts's actual actions
  // (previously advertised a stale action set — begin/advance/get_status/arrive/
  // check_encounter — none of which exist on the handler — plus a "speed" enum
  // that was never implemented). Added "mode" (#429) for move_hex passability
  // and effective-speed calculation.
  { sub: 'travel', description: 'Party/character travel. Actions: travel (room-graph movement via toRoomId or fromRoomId+direction), loot (search a room), rest (short/long, restores HP), move_hex (hex-grid party movement, mode-aware passability — #429). Aliases: move/go/journey/traverse→travel, search/forage/find/gather→loot, camp/sleep/recover/short_rest/long_rest→rest, hex_move/hex_travel/move_to_hex→move_hex.',
    schema: { type: 'object', properties: { action: { type: 'string' }, partyId: { type: 'string' }, fromRoomId: { type: 'string' }, toRoomId: { type: 'string' }, direction: { type: 'string' }, restType: { type: 'string', enum: ['short', 'long'] }, roomId: { type: 'string' }, characterIds: { type: 'array', items: { type: 'string' } }, resolveEncounter: { type: 'boolean' }, worldId: { type: 'string' }, q: { type: 'integer' }, r: { type: 'integer' }, toQ: { type: 'integer' }, toR: { type: 'integer' }, mode: { type: 'string', enum: ['foot', 'horse', 'carriage', 'car', 'aircraft'], description: 'Transport mode for move_hex (#429). Defaults to foot. Governs passability and effective speed via the destination biome\'s per-mode movement cost, or its explicit water_depth fording rule when set (#431, takes precedence over biome cost; response includes swimRisk: true for a >0.6m ford by foot/horse).' }, partySize: { type: 'integer' }, timeOfDay: { type: 'string', enum: ['dawn', 'dusk', 'night', 'midday', 'day'] }, noiseLevel: { type: 'string', enum: ['loud', 'moderate', 'silent'] }, weather: { type: 'string', enum: ['clear', 'rain', 'snow', 'fog'] } }, required: ['action'] } },
  { sub: 'perception', description: 'Perception and stealth checks. Actions: check, stealth_check, passive_perception, group_check, oppose_stealth.',
    schema: { type: 'object', properties: { action: { type: 'string' }, characterId: { type: 'string' }, targetId: { type: 'string' }, worldId: { type: 'string' }, dc: { type: 'number' }, bonus: { type: 'number' } }, required: ['action'] } },
  // ── #366 — scene: add state_snapshot ────────────────────────────────────
  { sub: 'scene', description: 'Scene management — narrative scenes with participants. Actions: create, get, list, update, delete, get_latest, state_snapshot.',
    schema: { type: 'object', properties: { action: { type: 'string' }, id: { type: 'string' }, worldId: { type: 'string' }, title: { type: 'string' }, whenLabel: { type: 'string' }, placeLabel: { type: 'string' }, narration: { type: 'string' }, participants: { type: 'array', items: { type: 'string' } }, previousSceneId: { type: 'string' }, limit: { type: 'number' }, sceneId: { type: 'string' }, include: { type: 'object' } }, required: ['action'] } },
  { sub: 'rest', description: 'Rest mechanics — short and long rest recovery. Actions: long_rest, short_rest.',
    schema: { type: 'object', properties: { action: { type: 'string' }, characterId: { type: 'string' }, partyId: { type: 'string' }, healAmount: { type: 'number' } }, required: ['action'] } },
  { sub: 'scroll', description: 'Magic scroll creation and usage. Actions: create, use, identify, get_dc, get_details.',
    schema: { type: 'object', properties: { action: { type: 'string' }, id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, spellName: { type: 'string' }, spellLevel: { type: 'number' }, saveDc: { type: 'number' }, casterId: { type: 'string' }, worldId: { type: 'string' } }, required: ['action'] } },
  { sub: 'event', description: 'World events and encounters. Actions: create, get, list, resolve, trigger, get_active.',
    schema: { type: 'object', properties: { action: { type: 'string' }, id: { type: 'string' }, worldId: { type: 'string' }, type: { type: 'string' }, description: { type: 'string' }, locationId: { type: 'string' }, participants: { type: 'array', items: { type: 'string' } } }, required: ['action'] } },
  { sub: 'drama', description: 'Drama and narrative tension engine. Actions: inject_complication, resolve_tension, get_active_threads, escalate, introduce_twist, check_pacing.',
    schema: { type: 'object', properties: { action: { type: 'string' }, worldId: { type: 'string' }, threadId: { type: 'string' }, characterId: { type: 'string' }, tensionType: { type: 'string' }, intensity: { type: 'number' } }, required: ['action'] } },
  // #312 — corrected description/schema to match time-manage.ts's actual actions
  // (previously advertised a stale action set — get_current/set_time/get_calendar/
  // check_event/get_phase — none of which exist on the handler). Added owner-based
  // clock-lock actions (set_owner/get_owner) and the "owner" param on advance.
  { sub: 'time', description: 'In-game time and calendar. Actions: set_date, get_date, get_age, advance, get_timeline, jump_to, set_owner, get_owner. "advance" accepts an optional "owner" (agent self-identifier) to guard against a different agent moving the same world\'s clock — see set_owner/get_owner.',
    schema: { type: 'object', properties: { action: { type: 'string' }, world_id: { type: 'string' }, worldId: { type: 'string' }, date: { type: 'string' }, era: { type: 'string' }, character_id: { type: 'string' }, by: { type: 'string', description: 'e.g. "3 months", "1 year", "7 days"' }, from: { type: 'string' }, to: { type: 'string' }, thread: { type: 'string' }, mode: { type: 'string', enum: ['observe', 'play'] }, limit: { type: 'number' }, owner: { type: ['string', 'null'], description: 'Agent self-identifier for the clock-lock guard on advance/set_owner/get_owner' } }, required: ['action'] } },
  { sub: 'timeline', description: 'Timeline engine — branching, snapshots, paradox detection. Actions: create_branch, get_state, snapshot, restore, check_paradox, list_branches.',
    schema: { type: 'object', properties: { action: { type: 'string' }, worldId: { type: 'string' }, branchId: { type: 'string' }, fromBranchId: { type: 'string' }, snapshotId: { type: 'string' }, label: { type: 'string' } }, required: ['action'] } },
  // #429 — corrected stale "terrainType" field (never implemented; the real
  // fields are category/glyph/colorHex/baseThreat) and added modeCosts.
  { sub: 'biome', description: 'Per-world biome registry and terrain movement rules. Actions: register, list, get, update, delete, validate, seed_defaults.',
    schema: { type: 'object', properties: { action: { type: 'string' }, id: { type: 'string' }, biomeId: { type: 'string' }, worldId: { type: 'string' }, name: { type: 'string' }, glyph: { type: 'string' }, category: { type: 'string', enum: ['terrain', 'aquatic', 'urban', 'hazard', 'magical', 'coastal', 'subterranean', 'void', 'custom'] }, colorHex: { type: 'string' }, movementCost: { type: 'number', description: 'Foot-equivalent baseline cost. Higher = slower, 0 = impassable.' }, baseThreat: { type: 'number' }, modeCosts: { type: 'object', additionalProperties: { type: 'number' }, description: 'Per-travel-mode cost overrides (#429), e.g. {"carriage": 0, "horse": 2.5}. Same semantics as movementCost. A mode with no entry falls back to movementCost. On update, shallow-merged into the existing object.' }, description: { type: 'string' } }, required: ['action'] } },
  { sub: 'encounter', description: 'Random encounter tables and resolution. Actions: create_table, get_table, list_tables, roll_encounter, resolve, add_entry, remove_entry.',
    schema: { type: 'object', properties: { action: { type: 'string' }, id: { type: 'string' }, tableId: { type: 'string' }, worldId: { type: 'string' }, regionId: { type: 'string' }, biomeId: { type: 'string' }, threatLevel: { type: 'number' }, entry: { type: 'object' } }, required: ['action'] } },
  { sub: 'zone_type', description: 'Zone type registry — map zone classification. Actions: register, list, get, update, delete, validate, seed_defaults.',
    schema: { type: 'object', properties: { action: { type: 'string' }, id: { type: 'string' }, zoneTypeId: { type: 'string' }, worldId: { type: 'string' }, name: { type: 'string' }, glyph: { type: 'string' }, colorHex: { type: 'string' }, description: { type: 'string' } }, required: ['action'] } },
  { sub: 'waypoint', description: 'Waypoint registry — named map coordinates and distance matrix. Actions: register, list, get, update, delete, validate, seed_defaults, calibrate, hex_to_latlon.',
    schema: { type: 'object', properties: { action: { type: 'string' }, id: { type: 'string' }, waypointId: { type: 'string' }, worldId: { type: 'string' }, name: { type: 'string' }, lat: { type: 'number' }, lon: { type: 'number' }, q: { type: 'number' }, r: { type: 'number' } }, required: ['action'] } },
  // ── #366 — weather: lazy-population forecasts ─────────────────────────
  { sub: 'weather', description: 'Weather forecasts per world/day. Actions: get_forecast, set_forecast, list_forecasts. "worldId" is required for all actions — accepts snake_case "world_id" as alias (cross-tool compatibility).',
    schema: { type: 'object', properties: { action: { type: 'string' }, worldId: { type: 'string', description: 'World UUID (required for all weather actions)' }, world_id: { type: 'string', description: 'Snake_case alias for worldId (cross-tool compatibility with non-RPG tools)' }, day: { type: 'number' }, weather: { type: 'string', enum: ['storm', 'rain', 'overcast', 'clear'] }, fog: { type: 'boolean' }, encounterModifier: { type: 'number' }, movementModifier: { type: 'number' }, season: { type: 'string' }, limit: { type: 'number' } }, required: ['action', 'worldId'] } },
]

for (const s of SUB_SCHEMAS) {
  if ('aliasOf' in s) {
    // Trusted by construction — every aliasOf target above names a real
    // canonical entry in this same static array (see the comment on
    // SubSchemaEntry). Not a defensive check: an invalid aliasOf would be a
    // typo caught by any test exercising load_tool_schema for that alias,
    // not a runtime condition to guard against.
    const canonical = SUB_SCHEMAS.find((c): c is Extract<SubSchemaEntry, { schema: unknown }> => 'schema' in c && c.sub === s.aliasOf)!
    registerRpgSubSchema(s.sub, canonical.description, canonical.schema)
    registerRpgAlias(s.sub, s.aliasOf)
  } else {
    registerRpgSubSchema(s.sub, s.description, s.schema)
  }
}

// ── App ───────────────────────────────────────────────────────────────────────

const getIsAuthenticated = (c: any): boolean => {
  const key = c.env.MCP_API_KEY
  return !key || c.req.header('X-Api-Key') === key
}

// Pre-built Streamable HTTP handler — routes spec-compliant MCP SDK clients to
// the HolmgardMCP DO via the agents SDK session management.
const mcpServeHandler = HolmgardMCP.serve('/mcp', { binding: 'MCP_OBJECT', transport: 'streamable-http' })

const app = new Hono<{ Bindings: AppBindings; Variables: RequestIdVariables }>()

app.use('*', requestIdMiddleware)
app.use('*', rateLimitMiddleware)

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Secret', 'X-Api-Key'],
}) as any)

// ── Health check endpoint ────────────────────────────────────────────────────
// GET /health — returns basic service status. Intentionally unauthenticated so
// orchestrators, load balancers, and monitoring tools can probe it.
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: Date.now(),
  }, 200)
})

// ── Streamable HTTP middleware (spec 2025-03-26) ──────────────────────────────
// Intercepts requests with Streamable HTTP transport markers before route
// handlers run. Legacy raw JSON-RPC requests fall through via next().
app.use('/mcp', wsReconnectRateLimit)

app.use('/mcp', async (c, next) => {
  const sessionId = c.req.header('Mcp-Session-Id')
  const acceptHeader = c.req.header('Accept') ?? ''
  const isStreamableHttp =
    !!sessionId ||
    (acceptHeader.includes('application/json') && acceptHeader.includes('text/event-stream'))

  if (!isStreamableHttp || !c.env.MCP_OBJECT) return next()

  const apiKey = c.env.MCP_API_KEY
  if (apiKey && c.req.header('X-Api-Key') !== apiKey) {
    return c.json({ error: 'Unauthorized: valid X-Api-Key header required' }, 401)
  }

  return mcpServeHandler.fetch(c.req.raw, c.env as any, c.executionCtx as any)
})

app.get('/mcp', (c) => {
  c.header('Content-Type', 'application/json')
  c.header('Cache-Control', 'no-store')
  return c.json(makeError(null, -32600, 'Invalid Request: use POST JSON-RPC'), 200)
})

app.post('/mcp', async (c) => {
  // ── Legacy hand-rolled JSON-RPC handler ───────────────────────────────────
  // Streamable HTTP requests are handled by the app.use('/mcp', ...) middleware
  // above and never reach this handler.
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(makeError(null, -32700, 'Parse error: invalid JSON'), 200)
  }

  const requestId = c.get('requestId')

  try {
    try { console.log('MCP incoming:', JSON.stringify({ request_id: requestId, body })) } catch { /* ignore log error */ }

    const validated = validateRequest(body)
    if (!validated.ok) return c.json(validated.error, 200)

    const req = validated.req
    const id = req.id ?? null
    const method = req.method!
    const params = (req.params ?? {}) as Record<string, unknown>

    // ── initialize ────────────────────────────────────────────────────────────
    if (method === 'initialize') {
      c.header('Cache-Control', 'no-store')
      c.header('Content-Type', 'application/json')
      return c.json(makeResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { list: true, call: true } },
        serverInfo: { name: 'holmgard-lore-mcp', version: '0.3.0', description: 'Holmgard lore MCP' }
      }), 200)
    }

    if (method === 'ping') {
      return c.json(makeResult(id, {}), 200)
    }

    // ── tools/list ────────────────────────────────────────────────────────────
    if (method === 'tools/list') {
      c.header('Cache-Control', 'no-store')
      c.header('Content-Type', 'application/json')
      return c.json(makeResult(id, { tools: toolDefinitions }), 200)
    }

    // ── tools/call ────────────────────────────────────────────────────────────
    if (method === 'tools/call') {
      const toolName = params?.name
      const args = (params?.arguments ?? {}) as Record<string, any>
      if (!toolName || typeof toolName !== 'string')
        return c.json(makeError(id, -32602, 'Invalid params: missing tool name'), 200)

      const isAuthenticated = getIsAuthenticated(c)

      if (toolName === 'lore_manage') {
        const action = typeof args?.action === 'string' ? args.action : null
        if (action === 'ping') {
          return c.json(makeResult(id, { content: [{ type: 'text', text: 'pong' }], metadata: { source: 'internal' } }), 200)
        }
        if (action === 'auth_check') {
          return c.json(makeResult(id, {
            content: [{ type: 'text', text: isAuthenticated ? 'Authenticated.' : 'Not authenticated — request was made without a valid API key.' }],
            metadata: { authenticated: isAuthenticated }
          }), 200)
        }
        // fall through to auth guard + registry for all other lore_manage actions
      }

      if (!isAuthenticated) {
        return c.json(makeError(id, -32001, 'Unauthorized: valid X-Api-Key header required'), 200)
      }

      const handler = toolRegistry[toolName]
      if (handler) {
        return handler({ c, id, args, isAuthenticated })
      }

      return c.json(makeError(id, -32601, `Method not found: tool "${toolName}"`), 200)
    }

    // ── Legacy bare-method handlers (pre-tools/call clients) ──────────────────
    // In production (MCP_API_KEY is set) require same auth check as tools/call.

    if (method === 'list_topics') {
      if (!getIsAuthenticated(c)) {
        return c.json(makeError(id, -32001, 'Unauthorized: valid X-Api-Key header required'), 200)
      }
      const keys = await kvList(c)
      return c.json(makeResult(id, { keys }), 200)
    }

    if (method === 'get_lore') {
      if (!getIsAuthenticated(c)) {
        return c.json(makeError(id, -32001, 'Unauthorized: valid X-Api-Key header required'), 200)
      }
      const key = (params?.key ?? params?.query ?? '').toString().toLowerCase()
      if (!key) return c.json(makeError(id, -32602, 'Invalid params: missing key'), 200)

      const raw = await kvGet(c, key)
      if (!raw) return c.json(makeError(id, -32601, `No lore found for key: ${key}`), 200)

      const { text, meta } = parseKvEntry(raw)
      return c.json(makeResult(id, { key, text, meta }), 200)
    }

    if (method === 'get_world_biomes') {
      if (!getIsAuthenticated(c)) {
        return c.json(makeError(id, -32001, 'Unauthorized: valid X-Api-Key header required'), 200)
      }
      const worldId = (params?.worldId ?? '').toString()
      if (!worldId) return c.json(makeError(id, -32602, 'Invalid params: missing worldId'), 200)
      if (!c.env.RPG_DB) return c.json(makeError(id, -32603, 'RPG_DB not available', null), 200)

      // Reuses biome-manage.ts's existing `list` action — one handler, two
      // envelopes (content-block for tools/call via rpg{sub:'biome'}, clean
      // structured JSON here) — same pattern as get_lore/list_topics.
      const listResult = await handleBiomeManage(c.env, { action: 'list', worldId })
      const parsed = JSON.parse(listResult.content[0].text) as { error?: boolean; message?: string; biomes?: unknown[]; count?: number }
      if (parsed.error) return c.json(makeError(id, -32000, parsed.message ?? 'Failed to list biomes', null), 200)
      return c.json(makeResult(id, { worldId, biomes: parsed.biomes, count: parsed.count }), 200)
    }

    if (method === 'get_lore_batch') {
      const MCP_LEGACY_API_KEY = c.env.MCP_API_KEY
      if (MCP_LEGACY_API_KEY && c.req.header('X-Api-Key') !== MCP_LEGACY_API_KEY) {
        return c.json(makeError(id, -32001, 'Unauthorized: valid X-Api-Key header required'), 200)
      }
      const keys: string[] = Array.isArray(params?.keys) ? params.keys.map((k: string) => k.trim().toLowerCase()) : []
      if (!keys.length) return c.json(makeError(id, -32602, 'Invalid params: missing keys array'), 200)
      const rawValues = await Promise.all(keys.map(k => kvGet(c, k)))
      const results: Record<string, any> = {}
      keys.forEach((k, i) => { results[k] = rawValues[i] ? parseKvEntry(rawValues[i]!) : null })
      return c.json(makeResult(id, { results }), 200)
    }

    if (method === 'get_topic_histories') {
      const MCP_LEGACY_API_KEY = c.env.MCP_API_KEY
      if (MCP_LEGACY_API_KEY && c.req.header('X-Api-Key') !== MCP_LEGACY_API_KEY) {
        return c.json(makeError(id, -32001, 'Unauthorized: valid X-Api-Key header required'), 200)
      }
      const keys: string[] = Array.isArray(params?.keys) ? params.keys.map((k: string) => k.trim().toLowerCase()) : []
      if (!keys.length) return c.json(makeError(id, -32602, 'Invalid params: missing keys array'), 200)

      const kv = getKV(c)
      if (!kv) return c.json(makeError(id, -32603, 'KV not available', null), 200)

      const histories: Record<string, Array<{ text: string; meta: Record<string, unknown> }>> = {}

      try {
        for (const key of keys) {
          const historyKey = `_history:${key}`
          const historyRaw = await kv.get(historyKey)
          const snapshots: Array<{ text: string; meta: Record<string, unknown> }> = []

          if (historyRaw) {
            const historyList: string[] = JSON.parse(historyRaw)
            for (const snapshot of historyList) {
              snapshots.push(parseKvEntry(snapshot))
            }
          }

          histories[key] = snapshots
        }
      } catch {
        return c.json(makeError(id, -32603, 'Failed to read histories', null), 200)
      }

      return c.json(makeResult(id, histories), 200)
    }

    return c.json(makeError(id, -32601, `Method not found: ${method}`), 200)

  } catch (e: unknown) {
    console.error(JSON.stringify({ request_id: requestId, error: 'Unhandled exception in MCP handler', message: e instanceof Error ? e.message : String(e) }))
    return c.json(makeError(null, -32603, 'Internal error', { message: e instanceof Error ? e.message : String(e), request_id: requestId }), 200)
  }
})

// ── CSP violation reporting ──────────────────────────────────────────────────────
app.post('/csp-report', async (c) => {
  try {
    const report = await c.req.json() as Record<string, unknown>
    const timestamp = new Date().toISOString()

    const violation = {
      timestamp,
      blockedUri: report['blocked-uri'] || 'unknown',
      violatedDirective: report['violated-directive'] || 'unknown',
      sourceFile: report['source-file'] || 'unknown',
      lineNumber: report['line-number'],
      columnNumber: report['column-number'],
      originalPolicy: report['original-policy'] || 'unknown',
      disposition: report['disposition'] || 'enforce'
    }

    console.log('[CSP Violation]', JSON.stringify(violation))

    return c.json({ status: 'reported' }, 200)
  } catch (e) {
    console.error('[CSP Report] Error processing report:', e)
    return c.json({ error: 'Failed to process CSP report' }, 400)
  }
})

// ── Admin routes ──────────────────────────────────────────────────────────────
app.route('/admin', adminRoutes)

// ── Internal routes ────────────────────────────────────────────────────────────
app.route('/internal', internalRoutes)

// ── Entity list reads (open, no auth) ─────────────────────────────────────────
app.route('/api/entities', entityReadsRouter)

// ── GET /changes ──────────────────────────────────────────────────────────────
app.route('/changes', changesRouter)

app.all('*', (c) => c.text('Not Found', 404))

export default app
