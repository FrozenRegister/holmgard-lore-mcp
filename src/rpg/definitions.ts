// src/rpg/definitions.ts
// JSON Schema definitions for all 27 RPG engine tools (Mnehmos v1.0.3 port).

const ACTION_PROP = { type: 'string', description: 'Action to perform (fuzzy-matched). Use get/list/create/update/delete or tool-specific actions.' }

export const rpgToolDefinitions: any[] = [
  {
    name: 'math_manage', title: 'Math Manage', version: '1.0.0',
    description: 'Dice rolling, probability calculation, and projectile physics. Actions: roll, probability, solve, simplify, projectile.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        expression: { type: 'string', description: 'Dice expression e.g. "2d6+3", or math expression for solve/simplify' },
        sides: { type: 'integer', minimum: 2, description: 'Dice sides for simple roll' },
        count: { type: 'integer', minimum: 1, description: 'Number of dice' },
        modifier: { type: 'integer' },
        trials: { type: 'integer', description: 'Monte Carlo samples for probability (default 10000)' },
        target: { type: 'integer', description: 'Target value for probability check' },
        velocity: { type: 'number', description: 'Initial velocity m/s for projectile' },
        angle: { type: 'number', description: 'Launch angle degrees for projectile' },
        gravity: { type: 'number', description: 'Gravity m/s² (default 9.81)' },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'world_manage', title: 'World Manage', version: '1.0.0',
    description: 'Create and manage game worlds. Actions: create, get, list, update, delete, generate, get_state.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        worldId: { type: 'string' },
        name: { type: 'string' },
        theme: { type: 'string', enum: ['fantasy', 'sci-fi', 'horror', 'historical', 'modern'] },
        loreSummary: { type: 'string' },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'character_manage', title: 'Character Manage', version: '1.0.0',
    description: 'CRUD operations on characters, plus XP/level management. Actions: create, get, list, update, delete, add_xp, get_progression, level_up.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        characterId: { type: 'string' },
        name: { type: 'string' },
        characterClass: { type: 'string' },
        race: { type: 'string' },
        level: { type: 'integer', minimum: 1, maximum: 20 },
        characterType: { type: 'string', enum: ['pc', 'npc', 'enemy', 'neutral'] },
        hp: { type: 'integer' },
        maxHp: { type: 'integer' },
        ac: { type: 'integer' },
        stats: { type: 'object', description: 'Ability scores: {str, dex, con, int, wis, cha}' },
        xpAmount: { type: 'integer', minimum: 0 },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'party_manage', title: 'Party Manage', version: '1.0.0',
    description: 'Manage adventuring parties and membership. Actions: create, get, list, update, delete, add_member, remove_member, set_leader.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        partyId: { type: 'string' },
        worldId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        characterId: { type: 'string' },
        role: { type: 'string', enum: ['leader', 'member', 'companion', 'hireling'] },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'quest_manage', title: 'Quest Manage', version: '1.0.0',
    description: 'Full quest lifecycle: create, complete, fail, add objectives. Actions: create, get, list, update, delete, complete, fail, add_objective, complete_objective.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        questId: { type: 'string' },
        worldId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        giver: { type: 'string' },
        objectiveId: { type: 'string' },
        objectiveText: { type: 'string' },
        rewards: { type: 'object' },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'item_manage', title: 'Item Manage', version: '1.0.0',
    description: 'Manage items in the world. Actions: create, get, list, update, delete, search.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        itemId: { type: 'string' },
        name: { type: 'string' },
        itemType: { type: 'string' },
        description: { type: 'string' },
        weight: { type: 'number' },
        value: { type: 'integer' },
        properties: { type: 'object' },
        query: { type: 'string', description: 'Search term for action:search' },
        limit: { type: 'integer' },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'inventory_manage', title: 'Inventory Manage', version: '1.0.0',
    description: 'Manage character inventories. Actions: get, add, remove, equip, unequip, transfer.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        characterId: { type: 'string' },
        itemId: { type: 'string' },
        quantity: { type: 'integer', minimum: 1 },
        slot: { type: 'string' },
        targetCharacterId: { type: 'string', description: 'Transfer destination character' },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'corpse_manage', title: 'Corpse Manage', version: '1.0.0',
    description: 'Corpse lifecycle: creation, looting, decay progression. Actions: create, get, list, loot, decay, generate_loot, delete.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        corpseId: { type: 'string' },
        characterId: { type: 'string' },
        characterName: { type: 'string' },
        characterType: { type: 'string' },
        encounterId: { type: 'string' },
        looterId: { type: 'string' },
        cr: { type: 'number' },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'narrative_manage', title: 'Narrative Manage', version: '1.0.0',
    description: 'Manage narrative notes and plot threads. Actions: create, get, list, update, delete, archive, resolve.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        noteId: { type: 'string' },
        worldId: { type: 'string' },
        type: { type: 'string', enum: ['plot_thread', 'canonical_moment', 'npc_voice', 'foreshadowing', 'session_log'] },
        content: { type: 'string' },
        visibility: { type: 'string', enum: ['dm_only', 'player_visible'] },
        entityId: { type: 'string' },
        entityType: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        status: { type: 'string', enum: ['active', 'resolved', 'dormant', 'archived'] },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'secret_manage', title: 'Secret Manage', version: '1.0.0',
    description: 'Manage in-game secrets and revelations. Actions: create, get, list, update, delete, reveal, check_reveal.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        secretId: { type: 'string' },
        worldId: { type: 'string' },
        name: { type: 'string' },
        secretType: { type: 'string' },
        category: { type: 'string' },
        publicDescription: { type: 'string' },
        secretDescription: { type: 'string' },
        revealedBy: { type: 'string' },
        linkedEntityId: { type: 'string' },
        linkedEntityType: { type: 'string' },
        sensitivity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'theft_manage', title: 'Theft Manage', version: '1.0.0',
    description: 'Stolen items lifecycle: steal, fence, recover. Actions: steal, fence, get, list, recover, cool_heat, report.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        stolenItemId: { type: 'string' },
        itemId: { type: 'string' },
        stolenFrom: { type: 'string' },
        stolenBy: { type: 'string' },
        stolenLocation: { type: 'string' },
        fenceNpcId: { type: 'string' },
        heatLevel: { type: 'string', enum: ['burning', 'hot', 'warm', 'cool', 'cold'] },
        witnesses: { type: 'array', items: { type: 'string' } },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'aura_manage', title: 'Aura Manage', version: '1.0.0',
    description: 'Aura and concentration spell management. Actions: create, get, list, remove, expire, get_affecting, concentrate, break_concentration.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        auraId: { type: 'string' },
        ownerId: { type: 'string' },
        spellName: { type: 'string' },
        spellLevel: { type: 'integer', minimum: 0, maximum: 9 },
        radius: { type: 'integer', minimum: 1 },
        targetIds: { type: 'array', items: { type: 'string' } },
        maxDuration: { type: 'integer' },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'improvisation_manage', title: 'Improvisation Manage', version: '1.0.0',
    description: 'Custom magical effects and improvised mechanics. Actions: apply, get, list, remove, tick, list_by_target.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        effectId: { type: 'integer' },
        targetId: { type: 'string' },
        targetType: { type: 'string', enum: ['character', 'npc'] },
        name: { type: 'string' },
        description: { type: 'string' },
        sourceType: { type: 'string', enum: ['divine', 'arcane', 'natural', 'cursed', 'psionic', 'unknown'] },
        category: { type: 'string', enum: ['boon', 'curse', 'neutral', 'transformative'] },
        powerLevel: { type: 'integer', minimum: 1, maximum: 5 },
        durationType: { type: 'string', enum: ['rounds', 'minutes', 'hours', 'days', 'permanent', 'until_removed'] },
        durationValue: { type: 'integer' },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'npc_manage', title: 'NPC Manage', version: '1.0.0',
    description: 'NPC creation, relationship and memory management. Actions: create, get_full_context, get_relationship, update_relationship, record_memory, get_history, get_recent, get_context, interact.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        npcId: { type: 'string' },
        characterId: { type: 'string' },
        name: { type: 'string' },
        characterClass: { type: 'string' },
        race: { type: 'string' },
        disposition: { type: 'string', enum: ['hostile', 'unfriendly', 'neutral', 'friendly', 'helpful'] },
        familiarity: { type: 'string', enum: ['stranger', 'acquaintance', 'friend', 'close_friend', 'rival', 'enemy'] },
        memorySummary: { type: 'string' },
        importance: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        interactionDescription: { type: 'string' },
        limit: { type: 'integer' },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'session_manage', title: 'Session Manage', version: '1.0.0',
    description: 'Session initialization and context assembly. Actions: initialize, get_context.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        worldId: { type: 'string' },
        worldName: { type: 'string' },
        partyId: { type: 'string' },
        partyName: { type: 'string' },
        theme: { type: 'string', enum: ['fantasy', 'sci-fi', 'horror', 'historical', 'modern'] },
        loreSummary: { type: 'string' },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'combat_manage', title: 'Combat Manage', version: '1.0.0',
    description: 'Encounter lifecycle management. Actions: create_encounter, get_encounter, list_encounters, add_combatant, remove_combatant, start, end, next_turn, get_state.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        id: { type: 'string', description: 'Encounter ID' },
        regionId: { type: 'string' },
        tokens: { type: 'array', description: 'Initial combatants' },
        token: { type: 'object', description: 'Single combatant token for add_combatant' },
        tokenId: { type: 'string', description: 'Token ID for remove_combatant' },
        filter: { type: 'string', enum: ['all', 'active', 'completed'] },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'combat_action', title: 'Combat Action', version: '1.0.0',
    description: 'Execute combat actions and log results. Actions: attack, apply_damage, heal, apply_condition, remove_condition, use_ability, get_log, get_turn_summary.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        encounterId: { type: 'string' },
        actorId: { type: 'string' },
        actorName: { type: 'string' },
        targetIds: { type: 'array', items: { type: 'string' } },
        round: { type: 'integer', minimum: 1 },
        attackRoll: { type: 'integer' },
        damage: { type: 'integer', minimum: 0 },
        damageType: { type: 'string' },
        healAmount: { type: 'integer', minimum: 0 },
        conditionName: { type: 'string' },
        abilityName: { type: 'string' },
        description: { type: 'string' },
        limit: { type: 'integer' },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'combat_map', title: 'Combat Map', version: '1.0.0',
    description: 'Battlefield grid management and ASCII rendering. Actions: create, get, update, move_token, render, delete.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        id: { type: 'string', description: 'Battlefield ID' },
        encounterId: { type: 'string' },
        width: { type: 'integer', minimum: 1, maximum: 50 },
        height: { type: 'integer', minimum: 1, maximum: 50 },
        terrain: { type: 'array', items: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' }, type: { type: 'string' } }, required: ['x', 'y', 'type'] } },
        tokenId: { type: 'string' },
        x: { type: 'integer' },
        y: { type: 'integer' },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'spawn_manage', title: 'Spawn Manage', version: '1.0.0',
    description: 'Quickly spawn characters, encounters, and locations. Actions: spawn_character, spawn_encounter, spawn_location, add_to_encounter, list_spawned.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        name: { type: 'string' },
        characterType: { type: 'string', enum: ['pc', 'npc', 'enemy', 'neutral'] },
        characterClass: { type: 'string' },
        race: { type: 'string' },
        level: { type: 'integer', minimum: 1, maximum: 20 },
        hp: { type: 'integer' },
        maxHp: { type: 'integer' },
        ac: { type: 'integer' },
        stats: { type: 'object' },
        encounterId: { type: 'string' },
        regionId: { type: 'string' },
        count: { type: 'integer', minimum: 1, maximum: 20 },
        initiative: { type: 'number' },
        position: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } } },
        characterId: { type: 'string' },
        limit: { type: 'integer' },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'strategy_manage', title: 'Strategy Manage', version: '1.0.0',
    description: 'Nation-level strategy: create nations, form alliances, claim territory, resolve turns. Actions: create_nation, get_state, propose_alliance, claim_region, resolve_turn, list_nations.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        worldId: { type: 'string' },
        nationId: { type: 'string' },
        name: { type: 'string' },
        leader: { type: 'string' },
        ideology: { type: 'string', enum: ['democracy', 'autocracy', 'theocracy', 'tribal'] },
        aggression: { type: 'number', minimum: 0, maximum: 100 },
        trust: { type: 'number', minimum: 0, maximum: 100 },
        fromNationId: { type: 'string' },
        toNationId: { type: 'string' },
        regionId: { type: 'string' },
        justification: { type: 'string' },
        turnNumber: { type: 'integer' },
        viewType: { type: 'string', enum: ['public', 'private', 'fog_of_war'] },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'turn_manage', title: 'Turn Manage', version: '1.0.0',
    description: 'World turn-based action submission and readiness polling. Actions: init, get_status, submit_actions, mark_ready, poll_results.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        worldId: { type: 'string' },
        nationId: { type: 'string' },
        partyId: { type: 'string' },
        actions: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, targetId: { type: 'string' }, description: { type: 'string' } }, required: ['type'] } },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'spatial_manage', title: 'Spatial Manage', version: '1.0.0',
    description: 'Room/location CRUD, navigation and network management. Actions: look, generate, update, get_exits, move, list, network_create, network_get, network_list.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        roomId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        biome: { type: 'string', enum: ['forest', 'mountain', 'urban', 'dungeon', 'coastal', 'cavern', 'divine', 'arcane'] },
        atmosphere: { type: 'array', items: { type: 'string' } },
        exits: { type: 'array', items: { type: 'object', properties: { direction: { type: 'string' }, targetRoomId: { type: 'string' } }, required: ['direction', 'targetRoomId'] } },
        direction: { type: 'string' },
        networkId: { type: 'string' },
        worldId: { type: 'string' },
        networkType: { type: 'string', enum: ['cluster', 'linear'] },
        limit: { type: 'integer' },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'world_map', title: 'World Map', version: '1.0.0',
    description: 'World tile management, region overviews, ASCII map preview, and structure (POI) search. Actions: overview, region, tiles, patch, preview, find_poi, suggest_poi.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        worldId: { type: 'string' },
        regionId: { type: 'string' },
        x: { type: 'integer' },
        y: { type: 'integer' },
        width: { type: 'integer', minimum: 1, maximum: 20 },
        height: { type: 'integer', minimum: 1, maximum: 20 },
        tiles: { type: 'array', items: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' }, biome: { type: 'string' } }, required: ['x', 'y'] } },
        query: { type: 'string', description: 'Name search for find_poi / name for suggest_poi' },
        structureType: { type: 'string', description: 'Structure/POI type filter' },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'batch_manage', title: 'Batch Manage', version: '1.0.0',
    description: 'Batch character creation, item distribution, and workflow templates. Actions: batch_create_characters, batch_create_npcs, batch_distribute_items, execute_workflow, list_templates, get_template.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        characters: { type: 'array', description: 'Array of {name, level?, characterClass?, race?, characterType?}' },
        distributions: { type: 'array', description: 'Array of {characterId, itemId, quantity?}' },
        steps: { type: 'array', description: 'Array of {tool, args} workflow steps' },
        templateId: { type: 'string' },
        templateName: { type: 'string' },
        category: { type: 'string' },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'travel_manage', title: 'Travel Manage', version: '1.0.0',
    description: 'Party travel, room looting, and resting. Actions: travel, loot, rest.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        fromRoomId: { type: 'string' },
        toRoomId: { type: 'string' },
        direction: { type: 'string' },
        roomId: { type: 'string', description: 'Room to loot' },
        characterIds: { type: 'array', items: { type: 'string' }, description: 'Characters resting' },
        restType: { type: 'string', enum: ['short', 'long'] },
        partyId: { type: 'string' },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'perception_manage', title: 'Perception Manage', version: '1.0.0',
    description: 'Perception checks and observation history. Actions: assess, get_history, get_latest, list_observers.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        observerId: { type: 'string' },
        targetId: { type: 'string' },
        targetKind: { type: 'string', enum: ['room', 'encounter', 'scene'] },
        rollValue: { type: 'integer', minimum: 1, maximum: 30 },
        dc: { type: 'integer', minimum: 1, maximum: 30 },
        perceptionType: { type: 'string', enum: ['sight', 'hearing', 'smell', 'arcana', 'investigation', 'insight'] },
        limit: { type: 'integer' },
      },
      required: ['action'], additionalProperties: false
    }
  },
  {
    name: 'scene_manage', title: 'Scene Manage', version: '1.0.0',
    description: 'Scene CRUD and retrieval. Actions: create, get, list, update, delete, get_latest.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        action: ACTION_PROP,
        id: { type: 'string', description: 'Scene ID' },
        worldId: { type: 'string' },
        title: { type: 'string' },
        whenLabel: { type: 'string', description: 'Time label e.g. "Dawn, Day 3"' },
        placeLabel: { type: 'string', description: 'Location label e.g. "The Frozen Wastes"' },
        narration: { type: 'string', description: 'Scene narration text (required for create)' },
        participants: { type: 'array', items: { type: 'string' } },
        previousSceneId: { type: 'string' },
        limit: { type: 'integer' },
      },
      required: ['action'], additionalProperties: false
    }
  },
]
