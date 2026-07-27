// src/rpg/register-agent-manage.ts
// Registration of agent_manage tool via the Phase 1 registerTool() infrastructure (#544)

import { registerTool, type RegisteredTool } from '../tools/register'
import { InputSchema, handleAgentManage } from './handlers/agent-manage'
import { wrap } from './registry'

/**
 * Register agent_manage with the new registerTool() infrastructure.
 * This is a parallel path to rpgToolRegistry — both remain active.
 * (Phase 1 #540, Phase 3 #544)
 */
export function registerAgentManageTool(): void {
  const tool: RegisteredTool = {
    name: 'agent_manage',
    title: 'Agent Management',
    version: '1.0.0',
    description:
      'NPC AI agent management backed by Cloudflare Workers AI. Each agent is bound 1:1 to a character and emits plain-text intent when invoked. Actions: create, get, list, update, delete, resume, health, budget, set_slice, remove_slice, toggle_slice, list_slices, narrate, broadcast, preview_prompt, add_secret, list_secrets, remove_secret, add_journal, get_journal, invoke, replay.',
    category: 'rpg',
    inputSchema: InputSchema,
    handler: wrap(handleAgentManage),
  }
  registerTool(tool)
}
