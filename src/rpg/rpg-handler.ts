// src/rpg/rpg-handler.ts
// Single dispatcher: routes { sub, action, ...rest } to one of 27 RPG handler functions.

import type { ToolHandler } from '../tools/types'
import { makeError, makeResult } from '../lib/rpc'
import type { AppBindings } from '../types'
import type { McpResponse } from './utils/response'

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

type RpgFn = (env: AppBindings, args: Record<string, unknown>) => Promise<McpResponse>

const SUB_MAP: Record<string, RpgFn> = {
  math:          handleMathManage,
  world:         handleWorldManage,
  character:     handleCharacterManage,
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
  session:       handleSessionManage,
  combat:        handleCombatManage,
  combat_action: handleCombatAction,
  combat_map:    handleCombatMap,
  spawn:         handleSpawnManage,
  strategy:      handleStrategyManage,
  turn:          handleTurnManage,
  spatial:       handleSpatialManage,
  world_map:     handleWorldMap,
  batch:         handleBatchManage,
  travel:        handleTravelManage,
  perception:    handlePerceptionManage,
  scene:         handleSceneManage,
  rest:          handleRestManage,
  scroll:        handleScrollManage,
  event:         handleEventManage,
  drama:         handleDramaManage,
  time:          handleTimeManage,
  timeline:      handleTimelineManage,
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

  const result = await fn(c.env, rest as Record<string, unknown>)
  return c.json(makeResult(id, result), 200)
}
