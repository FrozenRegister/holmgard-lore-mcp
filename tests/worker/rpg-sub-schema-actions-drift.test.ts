// #468 — lightweight drift guard for the #462-#467 bug class. SUB_SCHEMAS in
// src/index.ts is a hand-maintained doc surface for load_tool_schema; each
// handler's `ACTIONS` array (now exported) is the actual runtime source of
// truth — see matchAction(a.action, ACTIONS, ALIASES) in every handler and
// utils/fuzzy-enum.ts:62. Nothing previously checked the two stayed in sync,
// which is exactly how six subs ended up advertising wrong or 0%-overlap
// action lists. This test fails CI the moment a future hand-edit lets a sub's
// SUB_SCHEMAS description omit a real action — i.e. the "missing action"
// half of the drift. The "phantom action in prose" half isn't checked here:
// descriptions are free-text prose (cross-references, disambiguation notes)
// that a generic regex can't safely distinguish stale action names from, so
// that stays a per-sub assertion added at fix time (see
// rpg-schema-accuracy.test.ts).
//
// Deliberately does NOT export/check InputSchema or descriptions — see #468's
// discussion for why full schema codegen was rejected in favor of this
// narrower guard (no new dependency, no generated file, no build script;
// prose descriptions stay human-curated).
import { describe } from './support/helpers'
import { SELF } from 'cloudflare:test'
import { expect, it } from 'vitest'

import { ACTIONS as MATH_ACTIONS } from '@/rpg/handlers/math-manage'
import { ACTIONS as WORLD_ACTIONS } from '@/rpg/handlers/world-manage'
import { ACTIONS as CHARACTER_ACTIONS } from '@/rpg/handlers/character-manage'
import { ACTIONS as PARTY_ACTIONS } from '@/rpg/handlers/party-manage'
import { ACTIONS as QUEST_ACTIONS } from '@/rpg/handlers/quest-manage'
import { ACTIONS as ITEM_ACTIONS } from '@/rpg/handlers/item-manage'
import { ACTIONS as INVENTORY_ACTIONS } from '@/rpg/handlers/inventory-manage'
import { ACTIONS as CORPSE_ACTIONS } from '@/rpg/handlers/corpse-manage'
import { ACTIONS as NARRATIVE_ACTIONS } from '@/rpg/handlers/narrative-manage'
import { ACTIONS as SECRET_ACTIONS } from '@/rpg/handlers/secret-manage'
import { ACTIONS as THEFT_ACTIONS } from '@/rpg/handlers/theft-manage'
import { ACTIONS as AURA_ACTIONS } from '@/rpg/handlers/aura-manage'
import { ACTIONS as IMPROVISATION_ACTIONS } from '@/rpg/handlers/improvisation-manage'
import { ACTIONS as NPC_ACTIONS } from '@/rpg/handlers/npc-manage'
import { ACTIONS as SESSION_ACTIONS } from '@/rpg/handlers/session-manage'
import { ACTIONS as COMBAT_ACTIONS } from '@/rpg/handlers/combat-manage'
import { ACTIONS as COMBAT_ACTION_ACTIONS } from '@/rpg/handlers/combat-action'
import { ACTIONS as COMBAT_MAP_ACTIONS } from '@/rpg/handlers/combat-map'
import { ACTIONS as SPAWN_ACTIONS } from '@/rpg/handlers/spawn-manage'
import { ACTIONS as STRATEGY_ACTIONS } from '@/rpg/handlers/strategy-manage'
import { ACTIONS as TURN_ACTIONS } from '@/rpg/handlers/turn-manage'
import { ACTIONS as SPATIAL_ACTIONS } from '@/rpg/handlers/spatial-manage'
import { ACTIONS as WORLD_MAP_ACTIONS } from '@/rpg/handlers/world-map'
import { ACTIONS as BATCH_ACTIONS } from '@/rpg/handlers/batch-manage'
import { ACTIONS as TRAVEL_ACTIONS } from '@/rpg/handlers/travel-manage'
import { ACTIONS as PERCEPTION_ACTIONS } from '@/rpg/handlers/perception-manage'
import { ACTIONS as SCENE_ACTIONS } from '@/rpg/handlers/scene-manage'
import { ACTIONS as REST_ACTIONS } from '@/rpg/handlers/rest-manage'
import { ACTIONS as SCROLL_ACTIONS } from '@/rpg/handlers/scroll-manage'
import { ACTIONS as EVENT_ACTIONS } from '@/rpg/handlers/event-manage'
import { ACTIONS as DRAMA_ACTIONS } from '@/rpg/handlers/drama-manage'
import { ACTIONS as TIME_ACTIONS } from '@/rpg/handlers/time-manage'
import { ACTIONS as TIMELINE_ACTIONS } from '@/rpg/handlers/timeline-manage'
import { ACTIONS as BIOME_ACTIONS } from '@/rpg/handlers/biome-manage'
import { ACTIONS as ZONE_TYPE_ACTIONS } from '@/rpg/handlers/zone-type-manage'
import { ACTIONS as WAYPOINT_ACTIONS } from '@/rpg/handlers/waypoint-manage'
import { ACTIONS as ENCOUNTER_ACTIONS } from '@/rpg/handlers/encounter-manage'
import { ACTIONS as PRODUCTION_ACTIONS } from '@/rpg/handlers/production-manage'
import { ACTIONS as RESOURCE_ACTIONS } from '@/rpg/handlers/resource-manage'
import { ACTIONS as BROADCAST_ACTIONS } from '@/rpg/handlers/broadcast-manage'
import { ACTIONS as WEATHER_ACTIONS } from '@/rpg/handlers/weather-manage'
import { ACTIONS as CONFLICT_TYPE_ACTIONS } from '@/rpg/handlers/conflict-type-manage'
import { ACTIONS as CREATURE_ACTIONS } from '@/rpg/handlers/creature-manage'

// load_tool_schema (and every other rpg-registry tool routed through wrap() in
// rpg/registry.ts) returns its payload as ok(data) — a JSON-stringified blob
// inside content[0].text — same unwrapping pattern as rpg-schema-accuracy.test.ts.
async function callTool(name: string, args: Record<string, unknown>) {
  const res = await SELF.fetch('http://example.com/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const json = (await res.json()) as Record<string, any>
  const text = json.result?.content?.[0]?.text
  return text ? JSON.parse(text) : json
}

// Canonical sub -> real ACTIONS, mirroring SUB_MAP in src/rpg/rpg-handler.ts.
// Alias subs (characters->character, npc_dialogue->npc, maps->world_map,
// stealth->perception) share their canonical entry's handler and SUB_SCHEMAS
// description (registerRpgAlias in index.ts), so testing the canonical name
// once is sufficient — no need to duplicate every alias here.
const SUB_ACTIONS: Record<string, readonly string[]> = {
  math: MATH_ACTIONS,
  world: WORLD_ACTIONS,
  character: CHARACTER_ACTIONS,
  party: PARTY_ACTIONS,
  quest: QUEST_ACTIONS,
  item: ITEM_ACTIONS,
  inventory: INVENTORY_ACTIONS,
  corpse: CORPSE_ACTIONS,
  narrative: NARRATIVE_ACTIONS,
  secret: SECRET_ACTIONS,
  theft: THEFT_ACTIONS,
  aura: AURA_ACTIONS,
  improvisation: IMPROVISATION_ACTIONS,
  npc: NPC_ACTIONS,
  session: SESSION_ACTIONS,
  combat: COMBAT_ACTIONS,
  combat_action: COMBAT_ACTION_ACTIONS,
  combat_map: COMBAT_MAP_ACTIONS,
  spawn: SPAWN_ACTIONS,
  strategy: STRATEGY_ACTIONS,
  turn: TURN_ACTIONS,
  spatial: SPATIAL_ACTIONS,
  world_map: WORLD_MAP_ACTIONS,
  batch: BATCH_ACTIONS,
  travel: TRAVEL_ACTIONS,
  perception: PERCEPTION_ACTIONS,
  scene: SCENE_ACTIONS,
  rest: REST_ACTIONS,
  scroll: SCROLL_ACTIONS,
  event: EVENT_ACTIONS,
  drama: DRAMA_ACTIONS,
  time: TIME_ACTIONS,
  timeline: TIMELINE_ACTIONS,
  biome: BIOME_ACTIONS,
  zone_type: ZONE_TYPE_ACTIONS,
  waypoint: WAYPOINT_ACTIONS,
  encounter: ENCOUNTER_ACTIONS,
  production: PRODUCTION_ACTIONS,
  resource: RESOURCE_ACTIONS,
  broadcast: BROADCAST_ACTIONS,
  weather: WEATHER_ACTIONS,
  conflict_type: CONFLICT_TYPE_ACTIONS,
  creature: CREATURE_ACTIONS,
}

describe('rpg sub-schema actions drift guard (#468)', () => {
  for (const [sub, actions] of Object.entries(SUB_ACTIONS)) {
    it(`${sub}: SUB_SCHEMAS description advertises every real handler action`, async () => {
      const r = await callTool('load_tool_schema', { toolName: 'rpg', sub })
      expect(r.success).toBe(true)
      const description: string = r.schema.description
      const missing = actions.filter((action) => !new RegExp(`\\b${action}\\b`).test(description))
      expect(
        missing,
        `sub "${sub}" description is missing real action(s): ${missing.join(', ')}`,
      ).toEqual([])
    })
  }
})
