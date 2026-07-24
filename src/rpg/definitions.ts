// src/rpg/definitions.ts

const SUB_VALUES = [
  'math',
  'world',
  'character',
  'party',
  'quest',
  'item',
  'inventory',
  'corpse',
  'narrative',
  'secret',
  'theft',
  'aura',
  'improvisation',
  'npc',
  'session',
  'combat',
  'combat_action',
  'combat_map',
  'spawn',
  'strategy',
  'turn',
  'spatial',
  'world_map',
  'batch',
  'travel',
  'perception',
  'scene',
  'rest',
  'scroll',
  'event',
  'drama',
  'time',
  'timeline',
  'biome',
  'encounter',
  'production',
  'resource',
  'broadcast',
  'zone_type',
  'waypoint',
  'stealth',
  'weather',
  'conflict_type',
  // #404 (Tier 1) — sub-level aliases (same handler, different name).
  'characters',
  'maps',
  'npc_dialogue',
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
          description:
            'Action to perform within the sub-system (same actions as the previous individual tool)',
        },
      },
      required: ['sub', 'action'],
      additionalProperties: true,
    },
    examples: [
      {
        arguments: {
          sub: 'character',
          action: 'create',
          name: 'Aldric',
          characterClass: 'fighter',
          race: 'human',
          level: 1,
        },
      },
      { arguments: { sub: 'combat', action: 'create_encounter', regionId: 'region-1' } },
      { arguments: { sub: 'combat_action', action: 'attack' } },
      { arguments: { sub: 'quest', action: 'list' } },
    ],
  },
  {
    name: 'agent_manage',
    title: 'Agent Manage',
    version: '1.0.0',
    description:
      'NPC AI agent management backed by Cloudflare Workers AI. Each agent is bound 1:1 to a character and emits plain-text intent when invoked — the DM decides what to do with the response. Actions: create, get, list, update, delete, resume (reset circuit breaker), health (can invoke?), budget (token usage/cap), set_slice (upsert prompt slice), remove_slice, toggle_slice, list_slices, narrate (append observation to one agent), broadcast (append to many), preview_prompt (build messages without calling AI), add_secret, list_secrets, remove_secret, add_journal, get_journal, invoke (call Cloudflare AI and return plain-text intent), replay (re-run a stored call).',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            'Action to perform (fuzzy-matched). Use get/list/create/update/delete or tool-specific actions.',
        },
        id: { type: 'string', description: 'Agent ID' },
        agentId: { type: 'string', description: 'Alias for id' },
        characterId: {
          type: 'string',
          description:
            'Character this agent is bound to (required for create; used as lookup key for get)',
        },
        model: {
          type: 'string',
          description: 'Cloudflare AI model ID, e.g. @cf/meta/llama-3.1-8b-instruct',
        },
        status: { type: 'string', enum: ['active', 'paused', 'retired'] },
        autoOnTurn: { type: 'boolean', description: "Auto-invoke on character's turn" },
        temperature: { type: 'number', minimum: 0, maximum: 2 },
        maxTokens: { type: 'integer', minimum: 1, maximum: 8192 },
        budgetTokens: {
          type: 'integer',
          minimum: 0,
          description: 'Total token budget (null = unlimited); used by budget action to set limit',
        },
        sliceId: {
          type: 'string',
          description:
            'Prompt slice ID (used by set_slice, remove_slice, toggle_slice, remove_secret)',
        },
        kind: {
          type: 'string',
          description:
            'Slice kind: persona | directive | secrets | narrative_feed | recent | character_state | custom',
        },
        label: { type: 'string', description: 'Optional label for narrate/broadcast slices' },
        content: { type: 'string', description: 'Slice content or journal/secret body' },
        orderIndex: { type: 'integer', description: 'Slice assembly order (lower = earlier)' },
        enabled: { type: 'boolean', description: 'Toggle slice on/off' },
        situation: {
          type: 'string',
          description: 'DM-supplied scene description sent to the LLM as the user message',
        },
        encounterId: { type: 'string' },
        requestId: { type: 'string', description: 'Optional session/trace ID for audit log' },
        agentIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Target agent IDs for broadcast',
        },
        observation: {
          type: 'string',
          description: 'Text to append as a narrative_feed slice (narrate/broadcast)',
        },
        callId: { type: 'string', description: 'agent_calls row ID to replay' },
        importance: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Secret importance level',
        },
        journalKind: {
          type: 'string',
          enum: ['response', 'observation', 'plan', 'reflection', 'dm_note'],
        },
        round: { type: 'integer', description: 'Combat round for journal entry' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
        filter: {
          type: 'string',
          description:
            'Status filter for list (all | active | paused | retired); slice filter (enabled | disabled); journal/secret filter by kind or importance',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'character_manage',
    title: 'Character Manage',
    version: '1.0.0',
    description:
      'Character lifecycle management for the RPG engine. Actions: create, get, update, list, delete, add_xp, get_progression, level_up, search, cast_spell, snapshot, activate, list_passengers, recompute_derived, find_by_name, kill, move_to_location, move_to_tile. Fuzzy-matched with aliases (e.g. xp → add_xp, find → find_by_name, die → kill).',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            'Action to perform (fuzzy-matched). One of: create, get, update, list, delete, add_xp, get_progression, level_up, search, cast_spell, snapshot, activate, list_passengers, recompute_derived, find_by_name, kill, move_to_location, move_to_tile.',
        },
        id: { type: 'string', description: 'Character ID' },
        characterId: { type: 'string', description: 'Alias for id' },
        name: {
          type: 'string',
          description: 'Character name (required for create; used for get/find_by_name)',
        },
        characterType: {
          type: 'string',
          enum: ['pc', 'npc', 'enemy', 'neutral'],
          description: 'Character type (default: pc)',
        },
        characterClass: { type: 'string', description: 'Character class (default: Fighter)' },
        race: { type: 'string', description: 'Character race (default: Human)' },
        level: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'Character level (default: 1)',
        },
        hp: { type: 'integer', minimum: 0, description: 'Current hit points' },
        maxHp: { type: 'integer', minimum: 1, description: 'Maximum hit points' },
        ac: { type: 'integer', description: 'Armor class' },
        stats: {
          type: 'object',
          description: 'Ability scores (str, dex, con, int, wis, cha — each defaults to 10)',
          properties: {
            str: { type: 'integer' },
            dex: { type: 'integer' },
            con: { type: 'integer' },
            int: { type: 'integer' },
            wis: { type: 'integer' },
            cha: { type: 'integer' },
          },
        },
        born: { type: 'string', description: 'Birth date / origin timestamp' },
        factionId: { type: 'string', description: 'Faction ID' },
        behavior: { type: 'string', description: 'Behavior profile' },
        background: { type: 'string', description: 'Character background' },
        alignment: { type: 'string', description: 'Alignment' },
        origin: { type: 'string', description: 'Origin location' },
        currentRoomId: {
          type: 'string',
          nullable: true,
          description: 'Current room ID (null to clear)',
        },
        hostBodyId: {
          type: 'string',
          nullable: true,
          description: 'Host body ID for co-habitation',
        },
        active: { type: 'boolean', description: 'Whether character is active' },
        worldId: { type: 'string', nullable: true, description: 'World ID' },
        world_id: { type: 'string', nullable: true, description: 'Snake-case alias for worldId' },
        perceptionBonus: {
          type: 'integer',
          description: 'Perception bonus (auto-derived from WIS if omitted)',
        },
        stealthBonus: {
          type: 'integer',
          description: 'Stealth bonus (auto-derived from DEX if omitted)',
        },
        xp: { type: 'integer', minimum: 0, description: 'Experience points' },
        amount: { type: 'integer', minimum: 0, description: 'Generic amount (used by add_xp)' },
        xpAmount: {
          type: 'integer',
          minimum: 0,
          description: 'XP amount to add (alias for amount)',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          description: 'Max results for list/search',
        },
        characterTypeFilter: {
          type: 'string',
          enum: ['pc', 'npc', 'enemy', 'neutral'],
          description: 'Filter by character type for list',
        },
        query: { type: 'string', description: 'Search query for search action' },
        conditions: { type: 'array', items: { type: 'string' }, description: 'Active conditions' },
        resistances: {
          type: 'array',
          items: { type: 'string' },
          description: 'Damage resistances',
        },
        vulnerabilities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Damage vulnerabilities',
        },
        immunities: { type: 'array', items: { type: 'string' }, description: 'Damage immunities' },
        spellSlots: {
          type: 'object',
          description: 'Spell slots by level (e.g. { "1": { max: 4, current: 3 } })',
          additionalProperties: {
            type: 'object',
            properties: {
              max: { type: 'integer', minimum: 0 },
              current: { type: 'integer', minimum: 0 },
            },
          },
        },
        pactMagicSlots: {
          type: 'object',
          description: 'Pact magic slots',
          properties: {
            max: { type: 'integer', minimum: 0 },
            current: { type: 'integer', minimum: 0 },
            level: { type: 'integer', minimum: 0, maximum: 9 },
          },
        },
        knownSpells: { type: 'array', items: { type: 'string' }, description: 'Known spells' },
        preparedSpells: {
          type: 'array',
          items: { type: 'string' },
          description: 'Prepared spells',
        },
        cantripsKnown: { type: 'array', items: { type: 'string' }, description: 'Known cantrips' },
        maxSpellLevel: {
          type: 'integer',
          minimum: 0,
          maximum: 9,
          description: 'Maximum spell level',
        },
        killerId: { type: 'string', description: 'Killer character ID (kill action)' },
        causeOfDeath: { type: 'string', description: 'Cause of death (kill action)' },
        location: { type: 'string', description: 'Death location (kill action)' },
        triggerProductionPulse: {
          type: 'boolean',
          description: 'Trigger production pulse on death',
        },
        killedBy: { type: 'string', description: 'Alias for killerId' },
        concentratingOn: {
          type: 'string',
          nullable: true,
          description: 'Currently concentrating on spell',
        },
        legendaryActions: {
          type: 'integer',
          minimum: 0,
          description: 'Legendary actions per round',
        },
        legendaryActionsRemaining: {
          type: 'integer',
          minimum: 0,
          description: 'Legendary actions remaining',
        },
        legendaryResistances: {
          type: 'integer',
          minimum: 0,
          description: 'Legendary resistances per day',
        },
        legendaryResistancesRemaining: {
          type: 'integer',
          minimum: 0,
          description: 'Legendary resistances remaining',
        },
        hasLairActions: { type: 'boolean', description: 'Whether character has lair actions' },
        resourcePools: { type: 'object', description: 'Resource pools (arbitrary key-value)' },
        currency: {
          type: 'object',
          description: 'Currency (e.g. { gold: 0, silver: 0, copper: 0 })',
        },
        spellName: { type: 'string', description: 'Spell name (cast_spell action)' },
        slotLevel: {
          type: 'integer',
          minimum: 0,
          maximum: 9,
          description: 'Spell slot level to expend',
        },
        usePactMagic: { type: 'boolean', description: 'Use pact magic slot instead of spell slot' },
        requiresConcentration: {
          type: 'boolean',
          description: 'Whether spell requires concentration',
        },
        targetIds: { type: 'array', items: { type: 'string' }, description: 'Spell target IDs' },
        saveDcBase: { type: 'integer', description: 'Base save DC for concentration' },
        narrativeNote: { type: 'string', description: 'Narrative note for snapshot' },
        capturedBy: {
          type: 'string',
          enum: ['system', 'timeline_event', 'manual'],
          description: 'Snapshot capture source',
        },
        eventId: { type: 'string', description: 'Event ID for snapshot' },
        stateJson: { type: 'object', description: 'Arbitrary state JSON for snapshot' },
        locationKey: { type: 'string', description: 'Location key (move_to_location)' },
        q: { type: 'integer', description: 'Hex q coordinate (move_to_tile)' },
        r: { type: 'integer', description: 'Hex r coordinate (move_to_tile)' },
        mapId: { type: 'string', description: 'Map ID (move_to_tile, default: main)' },
        deathMode: {
          type: 'string',
          enum: ['instant', 'staged'],
          description: 'Death mode (update only)',
        },
        dissolutionStage: { type: 'integer', minimum: 0, description: 'Current dissolution stage' },
        dissolutionStages: { type: 'integer', minimum: 1, description: 'Total dissolution stages' },
        dissolutionTerminal: {
          type: 'string',
          nullable: true,
          description: 'Terminal dissolution state',
        },
        dissolutionId: { type: 'string', nullable: true, description: 'Dissolution process ID' },
        fields: {
          type: 'object',
          description:
            'Arbitrary D1 column passthrough for update (blacklist: id, created_at, updated_at, world_id)',
          additionalProperties: {
            type: ['string', 'number', 'boolean', 'null'],
          },
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
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
  description:
    'Dice rolling, probability, and projectile physics. Not directly callable — invoke via rpg({ sub: "math", action, ... }). Actions: roll, probability, projectile, get_history (solve/simplify are algebra stubs, unavailable in Workers).',
  inputSchema: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['roll', 'probability', 'projectile', 'get_history', 'solve', 'simplify'],
      },
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
      target: {
        type: 'number',
        description: '"probability": value to compare the roll total against',
      },
      comparison: {
        type: 'string',
        enum: ['gte', 'lte', 'eq', 'gt', 'lt'],
        description: '"probability": comparison operator, default gte',
      },
      sides: {
        type: 'integer',
        minimum: 2,
        description: '"probability": shorthand for a 1dN expression when expression is omitted',
      },
      velocity: { type: 'number', description: '"projectile": launch speed' },
      angle: { type: 'number', description: '"projectile": launch angle in degrees' },
      gravity: { type: 'number', description: '"projectile": defaults to 9.81' },
      height: { type: 'number', description: '"projectile": initial height, default 0' },
      sessionId: {
        type: 'string',
        description:
          'Optional tag stored with the roll/probability calculation, filterable via get_history',
      },
      seed: {
        type: 'string',
        description:
          'Stored alongside the calculation for record-keeping only — does not currently make the roll reproducible',
      },
      calculationId: {
        type: 'string',
        description:
          '"get_history": look up a single past roll/probability by its returned calculationId',
      },
      kind: {
        type: 'string',
        enum: ['roll', 'probability'],
        description: '"get_history": filter to only rolls or only probability calculations',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        description: '"get_history": max rows returned, default 20',
      },
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
