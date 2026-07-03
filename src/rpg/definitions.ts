// src/rpg/definitions.ts

const SUB_VALUES = [
  'math', 'world', 'character', 'party', 'quest', 'item', 'inventory',
  'corpse', 'narrative', 'secret', 'theft', 'aura', 'improvisation',
  'npc', 'session', 'combat', 'combat_action', 'combat_map', 'spawn',
  'strategy', 'turn', 'spatial', 'world_map', 'batch', 'travel',
  'perception', 'scene', 'rest', 'scroll', 'event',
]

export const rpgToolDefinitions: any[] = [
  {
    name: 'rpg',
    title: 'RPG Engine',
    version: '1.0.0',
    description: `RPG engine operations. Set sub to one of: ${SUB_VALUES.join(', ')}. Set action to the sub-tool operation. Each sub maps to an existing handler — use load_tool_schema with the old handler name (e.g. "character_manage") to see available actions for each sub. Examples: { sub: "character", action: "create", name: "Aldric" }, { sub: "combat", action: "create_encounter", regionId: "r1" }, { sub: "combat_action", action: "attack", ... }.`,
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        sub: {
          type: 'string',
          description: `RPG sub-system to target. One of: ${SUB_VALUES.join(', ')}`,
          enum: SUB_VALUES,
        },
        action: {
          type: 'string',
          description: 'Action to perform within the sub-system (same actions as the previous individual tool)',
        },
      },
      required: ['sub', 'action'],
      additionalProperties: true,
    },
    examples: [
      { arguments: { sub: 'character', action: 'create', name: 'Aldric', characterClass: 'fighter', race: 'human', level: 1 } },
      { arguments: { sub: 'combat', action: 'create_encounter', regionId: 'region-1' } },
      { arguments: { sub: 'combat_action', action: 'attack' } },
      { arguments: { sub: 'quest', action: 'list' } },
    ],
  },
  {
    name: 'agent_manage', title: 'Agent Manage', version: '1.0.0',
    description: 'NPC AI agent management backed by Cloudflare Workers AI. Each agent is bound 1:1 to a character and emits plain-text intent when invoked — the DM decides what to do with the response. Actions: create, get, list, update, delete, resume (reset circuit breaker), health (can invoke?), budget (token usage/cap), set_slice (upsert prompt slice), remove_slice, toggle_slice, list_slices, narrate (append observation to one agent), broadcast (append to many), preview_prompt (build messages without calling AI), add_secret, list_secrets, remove_secret, add_journal, get_journal, invoke (call Cloudflare AI and return plain-text intent), replay (re-run a stored call).',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: { type: 'string', description: 'Action to perform (fuzzy-matched). Use get/list/create/update/delete or tool-specific actions.' },
        id: { type: 'string', description: 'Agent ID' },
        agentId: { type: 'string', description: 'Alias for id' },
        characterId: { type: 'string', description: 'Character this agent is bound to (required for create; used as lookup key for get)' },
        model: { type: 'string', description: 'Cloudflare AI model ID, e.g. @cf/meta/llama-3.1-8b-instruct' },
        status: { type: 'string', enum: ['active', 'paused', 'retired'] },
        autoOnTurn: { type: 'boolean', description: 'Auto-invoke on character\'s turn' },
        temperature: { type: 'number', minimum: 0, maximum: 2 },
        maxTokens: { type: 'integer', minimum: 1, maximum: 8192 },
        budgetTokens: { type: 'integer', minimum: 0, description: 'Total token budget (null = unlimited); used by budget action to set limit' },
        sliceId: { type: 'string', description: 'Prompt slice ID (used by set_slice, remove_slice, toggle_slice, remove_secret)' },
        kind: { type: 'string', description: 'Slice kind: persona | directive | secrets | narrative_feed | recent | character_state | custom' },
        label: { type: 'string', description: 'Optional label for narrate/broadcast slices' },
        content: { type: 'string', description: 'Slice content or journal/secret body' },
        orderIndex: { type: 'integer', description: 'Slice assembly order (lower = earlier)' },
        enabled: { type: 'boolean', description: 'Toggle slice on/off' },
        situation: { type: 'string', description: 'DM-supplied scene description sent to the LLM as the user message' },
        encounterId: { type: 'string' },
        requestId: { type: 'string', description: 'Optional session/trace ID for audit log' },
        agentIds: { type: 'array', items: { type: 'string' }, description: 'Target agent IDs for broadcast' },
        observation: { type: 'string', description: 'Text to append as a narrative_feed slice (narrate/broadcast)' },
        callId: { type: 'string', description: 'agent_calls row ID to replay' },
        importance: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Secret importance level' },
        journalKind: { type: 'string', enum: ['response', 'observation', 'plan', 'reflection', 'dm_note'] },
        round: { type: 'integer', description: 'Combat round for journal entry' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
        filter: { type: 'string', description: 'Status filter for list (all | active | paused | retired); slice filter (enabled | disabled); journal/secret filter by kind or importance' },
      },
      required: ['action'], additionalProperties: false
    }
  },
]
