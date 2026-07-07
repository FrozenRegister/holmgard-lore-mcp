// src/rpg/definitions.ts

const SUB_VALUES = [
  'math', 'world', 'character', 'party', 'quest', 'item', 'inventory',
  'corpse', 'narrative', 'secret', 'theft', 'aura', 'improvisation',
  'npc', 'session', 'combat', 'combat_action', 'combat_map', 'spawn',
  'strategy', 'turn', 'spatial', 'world_map', 'batch', 'travel',
  'perception', 'scene', 'rest', 'scroll', 'event', 'drama', 'time', 'timeline',
]

export const rpgToolDefinitions: any[] = [
  {
    name: 'rpg',
    title: 'RPG Engine',
    version: '1.0.0',
    description: `RPG engine operations. Set sub to one of: ${SUB_VALUES.join(', ')}. Set action to the sub-tool operation. Each sub maps to an existing handler — use load_tool_schema with the old handler name (e.g. "character_manage") to see available actions for each sub. Examples: { sub: "character", action: "create", name: "Aldric" }, { sub: "combat", action: "create_encounter", regionId: "r1" }, { sub: "combat_action", action: "attack", ... }. Dice rolling / d20 checks / probability: { sub: "math", action: "roll", expression: "2d20kh1+5" } — see load_tool_schema({ toolName: "math_manage" }) for the full dice notation grammar.`,
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

// Discovery-only schema doc for `rpg({ sub: "math", ... })` — NOT a callable top-level
// tool (there is no `math_manage` entry in toolRegistry/rpgToolRegistry; calls go
// through `rpg` with sub: "math"). Merged into the schema index only (never the
// tool index) in src/index.ts, so `load_tool_schema({ toolName: "math_manage" })`
// resolves this grammar reference without advertising a broken callable name.
export const mathManageSchemaDoc: any = {
  name: 'math_manage',
  title: 'Math Manage (dice notation reference — call via rpg({ sub: "math", ... }))',
  version: '1.0.0',
  description: 'Dice rolling, probability, and projectile physics. Not directly callable — invoke via rpg({ sub: "math", action, ... }). Actions: roll, probability, projectile, get_history (solve/simplify are algebra stubs, unavailable in Workers).',
  inputSchema: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['roll', 'probability', 'projectile', 'get_history', 'solve', 'simplify'] },
      expression: {
        type: 'string',
        description: [
          'Dice notation for "roll"/"probability". Grammar: [count]d(sides|%|F)[r1][dl|dh|kl|kh N][!][+/-N][>N].',
          '  - count: number of dice, default 1',
          '  - sides: number of faces; "%" = percentile (d100); "F" = Fudge/Fate die (-1, 0, or +1)',
          '  - r1: reroll any natural 1 once',
          '  - dlN / dhN: drop lowest/highest N dice; klN / khN: keep lowest/highest N dice (only one of these four per expression)',
          '  - Advantage/disadvantage use this same keep syntax: 2d20kh1 = advantage, 2d20kl1 = disadvantage — no separate "adv"/"dis" keyword.',
          '  - !: exploding dice — a natural max face rerolls and adds, chaining while max keeps coming up',
          '  - +N / -N: flat modifier (cannot combine with ">N" success-counting — ambiguous)',
          '  - >N: count successes (kept dice rolling greater than N) instead of summing; response has `successes` instead of a summed total',
          'Examples: "2d6+3", "1d20", "2d20kh1+5" (advantage), "4d6dl1" (ability-score roll), "d%", "4dF", "2d6r1", "5d10>7", "3d6!"',
        ].join('\n'),
      },
      target: { type: 'number', description: '"probability": value to compare the roll total against' },
      comparison: { type: 'string', enum: ['gte', 'lte', 'eq', 'gt', 'lt'], description: '"probability": comparison operator, default gte' },
      sides: { type: 'integer', minimum: 2, description: '"probability": shorthand for a 1dN expression when expression is omitted' },
      velocity: { type: 'number', description: '"projectile": launch speed' },
      angle: { type: 'number', description: '"projectile": launch angle in degrees' },
      gravity: { type: 'number', description: '"projectile": defaults to 9.81' },
      height: { type: 'number', description: '"projectile": initial height, default 0' },
      sessionId: { type: 'string', description: 'Optional tag stored with the roll/probability calculation, filterable via get_history' },
      seed: { type: 'string', description: 'Stored alongside the calculation for record-keeping only — does not currently make the roll reproducible' },
      calculationId: { type: 'string', description: '"get_history": look up a single past roll/probability by its returned calculationId' },
      kind: { type: 'string', enum: ['roll', 'probability'], description: '"get_history": filter to only rolls or only probability calculations' },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: '"get_history": max rows returned, default 20' },
    },
    required: ['action'],
    additionalProperties: true,
  },
  examples: [
    { arguments: { action: 'roll', expression: '2d20kh1+5' } },
    { arguments: { action: 'roll', expression: '4d6dl1' } },
    { arguments: { action: 'roll', expression: '5d10>7' } },
    { arguments: { action: 'get_history', sessionId: 'session-1', limit: 10 } },
  ],
}
