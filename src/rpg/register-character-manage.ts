// src/rpg/register-character-manage.ts
// Registration of character_manage tool via the Phase 1 registerTool() infrastructure (#543)

import { registerTool, type RegisteredTool } from '../tools/register'
import { InputSchema, handleCharacterManage } from './handlers/character-manage'
import { wrap } from './registry'

/**
 * Register character_manage with the new registerTool() infrastructure.
 * This is a parallel path to rpgToolRegistry — both remain active.
 * (Phase 1 #540, Phase 2 pilot #543)
 */
export function registerCharacterManageTool(): void {
  const tool: RegisteredTool = {
    name: 'character_manage',
    title: 'Character Management',
    version: '1.0.0',
    description:
      'Comprehensive character management — create, query, update character stats, progression, spellcasting, death, and tactical positioning.',
    category: 'rpg',
    inputSchema: InputSchema,
    handler: wrap(handleCharacterManage),
  }
  registerTool(tool)
}
