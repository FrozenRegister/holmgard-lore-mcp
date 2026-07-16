// src/rpg/rpg-handler.ts
// Single dispatcher: routes { sub, action, ...rest } to one of 27 RPG handler functions.

import type { ToolHandler } from '../tools/types'
import { makeError, makeResult } from '../lib/rpc'
import type { AppBindings } from '../types'
import type { McpResponse } from './utils/response'
import { resolveAlias } from './action-aliases'

import { handleMathManage } from './handlers/math-manage'
import { handleWorldManage } from './handlers/world-manage'
import { handleCharacterManage } from './handlers/character-manage'
import { handlePartyManage } from './handlers/party-manage'
import { handleQuestManage } from './handlers/quest-manage'
import { handleItemManage } from './handlers/item-manage'
import { handleInventoryManage } from './handlers/inventory-manage'
import { handleCorpseManage } from './handlers/corpse-manage'
import { handleNarrativeManage } from './handlers/narrative-manage'
import { handleSecretManage } from './handlers/secret-manage'
import { handleTheftManage } from './handlers/theft-manage'
import { handleAuraManage } from './handlers/aura-manage'
import { handleImprovisationManage } from './handlers/improvisation-manage'
import { handleNpcManage } from './handlers/npc-manage'
import { handleSessionManage } from './handlers/session-manage'
import { handleCombatManage } from './handlers/combat-manage'
import { handleCombatAction } from './handlers/combat-action'
import { handleCombatMap } from './handlers/combat-map'
import { handleSpawnManage } from './handlers/spawn-manage'
import { handleStrategyManage } from './handlers/strategy-manage'
import { handleTurnManage } from './handlers/turn-manage'
import { handleSpatialManage } from './handlers/spatial-manage'
import { handleWorldMap } from './handlers/world-map'
import { handleBatchManage } from './handlers/batch-manage'
import { handleTravelManage } from './handlers/travel-manage'
import { handlePerceptionManage } from './handlers/perception-manage'
import { handleSceneManage } from './handlers/scene-manage'
import { handleRestManage } from './handlers/rest-manage'
import { handleScrollManage } from './handlers/scroll-manage'
import { handleEventManage } from './handlers/event-manage'
import { handleDramaManage } from './handlers/drama-manage'
import { handleTimeManage } from './handlers/time-manage'
import { handleTimelineManage } from './handlers/timeline-manage'
import { handleBiomeManage } from './handlers/biome-manage'
import { handleZoneTypeManage } from './handlers/zone-type-manage'
import { handleWaypointManage } from './handlers/waypoint-manage'
import { handleEncounterManage } from './handlers/encounter-manage'
import { handleProductionManage } from './handlers/production-manage'
import { handleResourceManage } from './handlers/resource-manage'
import { handleBroadcastManage } from './handlers/broadcast-manage'
import { handleWeatherManage } from './handlers/weather-manage'
import { handleConflictTypeManage } from './handlers/conflict-type-manage'

type RpgFn = (env: AppBindings, args: Record<string, unknown>) => Promise<McpResponse>

const SUB_MAP: Record<string, RpgFn> = {
  math:          handleMathManage,
  world:         handleWorldManage,
  character:     handleCharacterManage,
  // #404 — plural alias; narrators reach for either form interchangeably.
  characters:    handleCharacterManage,
  party:         handlePartyManage,
  quest:         handleQuestManage,
  item:          handleItemManage,
  inventory:     handleInventoryManage,
  corpse:        handleCorpseManage,
  narrative:     handleNarrativeManage,
  secret:        handleSecretManage,
  theft:         handleTheftManage,
  aura:          handleAuraManage,
  improvisation: handleImprovisationManage,
  npc:           handleNpcManage,
  // #404 — descriptive alias; narrators reach for this when they specifically
  // mean dialogue/reaction actions rather than NPC CRUD.
  npc_dialogue:  handleNpcManage,
  session:       handleSessionManage,
  combat:        handleCombatManage,
  combat_action: handleCombatAction,
  combat_map:    handleCombatMap,
  spawn:         handleSpawnManage,
  strategy:      handleStrategyManage,
  turn:          handleTurnManage,
  spatial:       handleSpatialManage,
  world_map:     handleWorldMap,
  // #404 — shorter alias for world_map.
  maps:          handleWorldMap,
  batch:         handleBatchManage,
  travel:        handleTravelManage,
  perception:    handlePerceptionManage,
  // #335 — "stealth" is the name narrators reach for (and what #285's own
  // issue title used), but the actual mechanic (stealth_check) lives under
  // perception's action set, not a separate handler. Alias the sub name
  // rather than duplicating/splitting the handler.
  stealth:       handlePerceptionManage,
  scene:         handleSceneManage,
  rest:          handleRestManage,
  scroll:        handleScrollManage,
  event:         handleEventManage,
  drama:         handleDramaManage,
  time:          handleTimeManage,
  timeline:      handleTimelineManage,
  biome:         handleBiomeManage,
  zone_type:     handleZoneTypeManage,
  waypoint:      handleWaypointManage,
  encounter:     handleEncounterManage,
  production:    handleProductionManage,
  resource:      handleResourceManage,
  broadcast:     handleBroadcastManage,
  weather:       handleWeatherManage,
  conflict_type: handleConflictTypeManage,
}

export const handle_rpg: ToolHandler = async ({ c, id, args }) => {
  const { sub, ...rest } = args ?? {}

  if (!sub || typeof sub !== 'string') {
    return c.json(makeError(id, -32602, 'Missing required param: sub', null), 200)
  }

  const fn = SUB_MAP[sub]
  if (!fn) {
    return c.json(makeError(id, -32602, `Unknown sub "${sub}"`, null), 200)
  }

  // #404 (Tier 2) — some actions live on a different sub than the one a
  // caller naturally reaches for (character.place_character really means
  // spawn.place_character). Rewrite {sub, action} to the canonical pair
  // before dispatch; the target handler never sees the alias. Every alias
  // target is a real SUB_MAP entry by construction (see action-aliases.ts),
  // so the resolved sub is always resolvable.
  const restArgs = rest as Record<string, unknown>
  const requestedAction = restArgs.action
  const resolved = typeof requestedAction === 'string' ? resolveAlias(sub, requestedAction) : { sub, action: requestedAction }
  const targetFn = resolved.sub === sub ? fn : SUB_MAP[resolved.sub]!

  const result = await targetFn(c.env, { ...restArgs, action: resolved.action })
  return c.json(makeResult(id, result), 200)
}
