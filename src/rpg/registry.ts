// src/rpg/registry.ts
// Wraps transport-agnostic RPG handlers into ToolHandler (ctx) => Promise<Response> format.

import type { ToolHandler } from '../tools/types'
import type { AppBindings } from '../types'
import { makeResult } from '../lib/rpc'
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
import { handleSearchTools, setToolIndex } from './handlers/search-tools'
import { handleLoadToolSchema, setSchemaIndex } from './handlers/load-tool-schema'
import { handleAgentManage } from './handlers/agent-manage'

export { setToolIndex, setSchemaIndex }

type RpgFn = (env: AppBindings, args: Record<string, unknown>) => Promise<McpResponse>

function wrap(fn: RpgFn): ToolHandler {
  return async ({ c, id, args }) => {
    const result = await fn(c.env, args ?? {})
    return c.json(makeResult(id, result), 200)
  }
}

export const rpgToolRegistry: Record<string, ToolHandler> = {
  math_manage:          wrap(handleMathManage),
  world_manage:         wrap(handleWorldManage),
  character_manage:     wrap(handleCharacterManage),
  party_manage:         wrap(handlePartyManage),
  quest_manage:         wrap(handleQuestManage),
  item_manage:          wrap(handleItemManage),
  inventory_manage:     wrap(handleInventoryManage),
  corpse_manage:        wrap(handleCorpseManage),
  narrative_manage:     wrap(handleNarrativeManage),
  secret_manage:        wrap(handleSecretManage),
  theft_manage:         wrap(handleTheftManage),
  aura_manage:          wrap(handleAuraManage),
  improvisation_manage: wrap(handleImprovisationManage),
  npc_manage:           wrap(handleNpcManage),
  session_manage:       wrap(handleSessionManage),
  combat_manage:        wrap(handleCombatManage),
  combat_action:        wrap(handleCombatAction),
  combat_map:           wrap(handleCombatMap),
  spawn_manage:         wrap(handleSpawnManage),
  strategy_manage:      wrap(handleStrategyManage),
  turn_manage:          wrap(handleTurnManage),
  spatial_manage:       wrap(handleSpatialManage),
  world_map:            wrap(handleWorldMap),
  batch_manage:         wrap(handleBatchManage),
  travel_manage:        wrap(handleTravelManage),
  perception_manage:    wrap(handlePerceptionManage),
  scene_manage:         wrap(handleSceneManage),
  search_tools:         wrap(handleSearchTools),
  load_tool_schema:     wrap(handleLoadToolSchema),
  agent_manage:         wrap(handleAgentManage),
}
