// src/tools/definitions.ts
import { rpgToolDefinitions } from '../rpg/definitions'
import { rpgMetaToolDefinitions } from '../rpg/meta-definitions'

export interface ToolDefinition {
  name: string;
  title: string;
  version: string;
  description: string;
  inputSchema: Record<string, any>;
}

// ─── lore_manage ────────────────────────────────────────────────────────────

const LORE_MANAGE_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  oneOf: [
    {
      type: 'object',
      required: ['action', 'query'],
      properties: {
        action: { type: 'string', const: 'get', description: 'Get a lore entry by key or fuzzy query' },
        query: { type: 'string', minLength: 1, description: 'Exact key or fuzzy search query for the lore entry' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'keys'],
      properties: {
        action: { type: 'string', const: 'get_batch', description: 'Get multiple lore entries by key' },
        keys: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, description: 'Array of lore keys to fetch' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'key', 'sections'],
      properties: {
        action: { type: 'string', const: 'get_section', description: 'Get specific sections from a lore entry' },
        key: { type: 'string', minLength: 1, description: 'Lore entry key' },
        sections: { type: 'array', items: { type: 'string', minLength: 1 }, description: 'Section names to extract' },
        mode: { type: 'string', enum: ['strict', 'loose'], description: 'Match mode — loose allows partial section name matches (default: loose)' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', const: 'list', description: 'List all lore topic keys' },
        limit: { type: 'number', minimum: 1, maximum: 1000, description: 'Max number of keys to return (default: 1000)' },
        offset: { type: 'number', minimum: 0, description: 'Offset for pagination (default: 0)' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', const: 'list_maps', description: 'List all map keys' },
        limit: { type: 'number', minimum: 1, maximum: 1000, description: 'Max number of keys to return (default: 1000)' },
        offset: { type: 'number', minimum: 0, description: 'Offset for pagination (default: 0)' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'map_id'],
      properties: {
        action: { type: 'string', const: 'get_map', description: 'Get a map by ID' },
        map_id: { type: 'string', minLength: 1, description: 'Map identifier' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'query'],
      properties: {
        action: { type: 'string', const: 'search', description: 'Full-text search across lore entries' },
        query: { type: 'string', minLength: 1, description: 'Search query string' },
        max_results: { type: 'number', minimum: 1, maximum: 50, description: 'Maximum results to return (default: 10)' },
        scan_limit: { type: 'number', minimum: 1, maximum: 2000, description: 'Maximum entries to scan (default: 500)' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'query_string'],
      properties: {
        action: { type: 'string', const: 'validate', description: 'Validate a topic key exists, with fuzzy did_you_mean suggestions' },
        query_string: { type: 'string', minLength: 1, description: 'Key to look up or validate' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'key', 'text'],
      properties: {
        action: { type: 'string', const: 'set', description: 'Create or overwrite a lore entry' },
        key: { type: 'string', minLength: 1, description: 'Lore entry key' },
        text: { type: 'string', minLength: 1, description: 'Full lore entry text' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'key'],
      properties: {
        action: { type: 'string', const: 'delete', description: 'Delete a lore entry' },
        key: { type: 'string', minLength: 1, description: 'Lore entry key to delete' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'key', 'operation'],
      properties: {
        action: { type: 'string', const: 'patch', description: 'Patch a lore entry with a targeted operation' },
        key: { type: 'string', minLength: 1, description: 'Lore entry key' },
        operation: { type: 'string', enum: ['replace', 'append', 'delete_field'], description: 'Patch operation type' },
        target: { type: 'string', description: 'Substring or field name to target (required for replace and delete_field)' },
        value: { type: 'string', description: 'Replacement or appended text (required for replace and append)' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'entries'],
      properties: {
        action: { type: 'string', const: 'batch_set', description: 'Write multiple lore entries in parallel' },
        entries: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['key', 'text'],
            properties: {
              key: { type: 'string', minLength: 1 },
              text: { type: 'string', minLength: 1 },
            },
            additionalProperties: false,
          },
          description: 'Array of {key, text} entries to write',
        },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'mutations'],
      properties: {
        action: { type: 'string', const: 'batch_mutate', description: 'Apply increment or patch mutations to multiple entries sequentially' },
        mutations: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['key', 'action'],
            properties: {
              key: { type: 'string', minLength: 1 },
              action: { type: 'string', enum: ['increment', 'patch'] },
              field_path: { type: 'string', description: 'Required for increment — markdown field name to increment' },
              increment: { type: 'number', description: 'Amount to increment (for increment action)' },
              reason: { type: 'string', description: 'Optional reason note for increment' },
              operation: { type: 'string', enum: ['replace', 'append', 'delete_field'], description: 'Patch operation type (for patch action)' },
              target: { type: 'string', description: 'Patch target substring or field name' },
              value: { type: 'string', description: 'Patch replacement or appended text' },
            },
            additionalProperties: false,
          },
          description: 'Array of mutations to apply in order',
        },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'key'],
      properties: {
        action: { type: 'string', const: 'restore', description: 'Restore a lore entry from its most recent history snapshot' },
        key: { type: 'string', minLength: 1, description: 'Lore entry key to restore' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'keys'],
      properties: {
        action: { type: 'string', const: 'history', description: 'Get edit history for one or more lore entries' },
        keys: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, description: 'Array of lore keys to fetch history for' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'key', 'field_path'],
      properties: {
        action: { type: 'string', const: 'increment', description: 'Increment a numeric markdown field in a lore entry' },
        key: { type: 'string', minLength: 1, description: 'Lore entry key' },
        field_path: { type: 'string', minLength: 1, description: 'Markdown field name to increment (e.g. "Count")' },
        increment: { type: 'number', description: 'Amount to increment by (default: 1)' },
        reason: { type: 'string', description: 'Optional reason label for the change (default: "system-update")' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'key', 'section', 'text'],
      properties: {
        action: { type: 'string', const: 'append_section', description: 'Append text to a named section within a lore entry' },
        key: { type: 'string', minLength: 1, description: 'Lore entry key' },
        section: { type: 'string', minLength: 1, description: 'Section heading to target' },
        text: { type: 'string', minLength: 1, description: 'Text to append to the section' },
        position: { type: 'string', enum: ['end', 'start'], description: 'Where to insert text within the section (default: end)' },
        auto_create: { type: 'boolean', description: 'Create the section if it does not exist (default: true)' },
      },
      additionalProperties: false,
    },
  ],
}

// ─── entity_manage ──────────────────────────────────────────────────────────

const ENTITY_MANAGE_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  oneOf: [
    {
      type: 'object',
      required: ['action', 'archetype_key'],
      properties: {
        action: { type: 'string', const: 'generate', description: 'Generate a new entity from an archetype' },
        archetype_key: { type: 'string', minLength: 1, description: 'Archetype lore key to generate the entity from' },
        location_key: { type: 'string', description: 'Optional starting location for the entity' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'entity_key', 'new_location_key'],
      properties: {
        action: { type: 'string', const: 'move', description: 'Move an entity to a new location' },
        entity_key: { type: 'string', minLength: 1, description: 'Entity lore key' },
        new_location_key: { type: 'string', minLength: 1, description: 'Destination location lore key' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'location_key'],
      properties: {
        action: { type: 'string', const: 'roll_encounter', description: 'Roll for a random encounter at a location' },
        location_key: { type: 'string', minLength: 1, description: 'Location lore key' },
        threat_level: { type: 'number', minimum: 1, maximum: 10, description: 'Threat level 1–10 (default: 5)' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'entity_key'],
      properties: {
        action: { type: 'string', const: 'advance_stage', description: 'Advance an entity to its next lifecycle stage' },
        entity_key: { type: 'string', minLength: 1, description: 'Entity lore key' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'location_key'],
      properties: {
        action: { type: 'string', const: 'batch_stage', description: 'Advance all entities at a location to their next stage' },
        location_key: { type: 'string', minLength: 1, description: 'Location lore key' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'entity_key'],
      properties: {
        action: { type: 'string', const: 'get_inventory', description: "Get an entity's inventory" },
        entity_key: { type: 'string', minLength: 1, description: 'Entity lore key' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'from_entity', 'to_entity', 'item_key'],
      properties: {
        action: { type: 'string', const: 'transfer_item', description: 'Transfer an item between two entities' },
        from_entity: { type: 'string', minLength: 1, description: 'Source entity lore key' },
        to_entity: { type: 'string', minLength: 1, description: 'Destination entity lore key' },
        item_key: { type: 'string', minLength: 1, description: 'Item lore key to transfer' },
        quantity: { type: 'number', minimum: 1, description: 'Quantity to transfer (default: 1)' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'entity_key'],
      properties: {
        action: { type: 'string', const: 'get_sensory_profile', description: "Get an entity's sensory profile" },
        entity_key: { type: 'string', minLength: 1, description: 'Entity lore key' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'entity_a', 'entity_b', 'interaction_type'],
      properties: {
        action: { type: 'string', const: 'get_compatibility', description: 'Get compatibility score between two entities for an interaction type' },
        entity_a: { type: 'string', minLength: 1, description: 'First entity lore key' },
        entity_b: { type: 'string', minLength: 1, description: 'Second entity lore key' },
        interaction_type: { type: 'string', minLength: 1, description: 'Type of interaction to evaluate' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'entity_id', 'utility_vector'],
      properties: {
        action: { type: 'string', const: 'analyze_utility', description: 'Analyze an entity along a utility vector' },
        entity_id: { type: 'string', minLength: 1, description: 'Entity lore key' },
        utility_vector: {
          type: 'string',
          enum: ['GASTRIC', 'BUTCHERY', 'INCUBATION', 'SCULPTURE', 'PARASITISM', 'THRALL', 'DISTRIBUTED'],
          description: 'Utility axis to score',
        },
        entity_role: { type: 'string', enum: ['subject', 'actor'], description: 'Role of the entity in the interaction (default: subject)' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', const: 'list_consumption_timelines', description: 'List entity consumption timelines, optionally filtered by status' },
        status_filter: {
          type: 'string',
          enum: ['all', 'imminent', 'days-to-weeks', 'weeks-to-months', 'consumed'],
          description: 'Filter by consumption status (default: all)',
        },
        limit: { type: 'number', minimum: 1, maximum: 100, description: 'Max results (default: 50)' },
        offset: { type: 'number', minimum: 0, description: 'Pagination offset (default: 0)' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', const: 'list_active_threads', description: 'List all active world threads' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'entity_a_id', 'entity_b_id', 'action_type'],
      properties: {
        action: { type: 'string', const: 'resolve_interaction', description: 'Resolve an interaction between two entities' },
        entity_a_id: { type: 'string', minLength: 1, description: 'First entity lore key' },
        entity_b_id: { type: 'string', minLength: 1, description: 'Second entity lore key' },
        action_type: { type: 'string', minLength: 1, description: 'Interaction action type' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'entity_key'],
      properties: {
        action: { type: 'string', const: 'destroy', description: 'Destroy an entity, removing it from the world' },
        entity_key: { type: 'string', minLength: 1, description: 'Entity lore key to destroy' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'entity_key', 'predator_key', 'stages', 'stage_timer', 'terminal_state'],
      properties: {
        action: { type: 'string', const: 'create_consumption_timeline', description: 'Create a consumption timeline for an entity' },
        entity_key: { type: 'string', minLength: 1, description: 'Entity lore key being consumed' },
        predator_key: { type: 'string', minLength: 1, description: 'Predator entity lore key doing the consuming' },
        stages: { type: 'number', minimum: 1, maximum: 20, description: 'Total number of dissolution stages' },
        stage_timer: { type: 'number', minimum: 1, description: 'Timer value per stage (decrements toward 0)' },
        terminal_state: { type: 'string', minLength: 1, description: 'Final conversion state (e.g. consumed-nutrient, vessel, ornament)' },
        current_stage: { type: 'number', minimum: 0, description: 'Starting stage index (default: 0)' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'entity_key'],
      properties: {
        action: { type: 'string', const: 'set_consumption_timeline', description: 'Update an existing consumption timeline' },
        entity_key: { type: 'string', minLength: 1, description: 'Entity lore key whose timeline to update' },
        predator_key: { type: 'string', minLength: 1, description: 'New predator entity lore key' },
        stages: { type: 'number', minimum: 1, maximum: 20, description: 'New total stage count' },
        stage_timer: { type: 'number', minimum: 0, description: 'New timer value' },
        current_stage: { type: 'number', minimum: 0, description: 'New current stage index' },
        terminal_state: { type: 'string', minLength: 1, description: 'New terminal conversion state' },
      },
      additionalProperties: false,
    },
  ],
}

// ─── world_manage ────────────────────────────────────────────────────────────

const WORLD_MANAGE_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  oneOf: [
    {
      type: 'object',
      required: ['action', 'thread_id'],
      properties: {
        action: { type: 'string', const: 'thread_tick', description: 'Advance a world thread by one tick' },
        thread_id: { type: 'string', minLength: 1, description: 'Thread identifier' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'entity_a', 'entity_b'],
      properties: {
        action: { type: 'string', const: 'get_relationship', description: 'Get the relationship state between two entities' },
        entity_a: { type: 'string', minLength: 1, description: 'First entity lore key' },
        entity_b: { type: 'string', minLength: 1, description: 'Second entity lore key' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'entity_key', 'faction_key'],
      properties: {
        action: { type: 'string', const: 'get_faction_standing', description: "Get an entity's standing with a faction" },
        entity_key: { type: 'string', minLength: 1, description: 'Entity lore key' },
        faction_key: { type: 'string', minLength: 1, description: 'Faction lore key' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'entity_key', 'topic'],
      properties: {
        action: { type: 'string', const: 'get_entity_knowledge', description: "Get what an entity knows about a topic" },
        entity_key: { type: 'string', minLength: 1, description: 'Entity lore key' },
        topic: { type: 'string', minLength: 1, description: 'Topic or lore key to query knowledge about' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'location_key'],
      properties: {
        action: { type: 'string', const: 'get_location_occupants', description: 'Get all entities currently at a location' },
        location_key: { type: 'string', minLength: 1, description: 'Location lore key' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'origin_key'],
      properties: {
        action: { type: 'string', const: 'get_reachable_locations', description: 'Get all locations reachable from an origin' },
        origin_key: { type: 'string', minLength: 1, description: 'Origin location lore key' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'location_key', 'entity_key'],
      properties: {
        action: { type: 'string', const: 'sense_environment', description: "Sense the environment from an entity's perspective at a location" },
        location_key: { type: 'string', minLength: 1, description: 'Location lore key' },
        entity_key: { type: 'string', minLength: 1, description: 'Entity lore key doing the sensing' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'thread_a', 'thread_b'],
      properties: {
        action: { type: 'string', const: 'get_thread_comparison', description: 'Compare the state of two world threads' },
        thread_a: { type: 'string', minLength: 1, description: 'First thread identifier' },
        thread_b: { type: 'string', minLength: 1, description: 'Second thread identifier' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'thread_a', 'thread_b'],
      properties: {
        action: { type: 'string', const: 'check_convergence', description: 'Check whether two threads are converging' },
        thread_a: { type: 'string', minLength: 1, description: 'First thread identifier' },
        thread_b: { type: 'string', minLength: 1, description: 'Second thread identifier' },
      },
      additionalProperties: false,
    },
  ],
}

// ─── scene_manage ────────────────────────────────────────────────────────────

const SCENE_MANAGE_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  oneOf: [
    {
      type: 'object',
      required: ['action', 'scene_key'],
      properties: {
        action: { type: 'string', const: 'activate', description: 'Activate a scene as the current active scene' },
        scene_key: { type: 'string', minLength: 1, description: 'Scene lore key' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'scene_key', 'entity_key'],
      properties: {
        action: { type: 'string', const: 'present_choices', description: 'Present available choices to an entity in a scene' },
        scene_key: { type: 'string', minLength: 1, description: 'Scene lore key' },
        entity_key: { type: 'string', minLength: 1, description: 'Entity lore key being presented choices' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'choice_id', 'entity_key'],
      properties: {
        action: { type: 'string', const: 'commit_choice', description: 'Commit a choice made by an entity' },
        choice_id: { type: 'string', minLength: 1, description: 'Choice identifier to commit' },
        entity_key: { type: 'string', minLength: 1, description: 'Entity lore key making the choice' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'entity_key'],
      properties: {
        action: { type: 'string', const: 'get_history', description: 'Get the choice history for an entity' },
        entity_key: { type: 'string', minLength: 1, description: 'Entity lore key' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', const: 'brief', description: 'Get a scene brief summarising the current state of a location or scene' },
        location_key: { type: 'string', description: 'Location lore key (use location_key or scene_key)' },
        scene_key: { type: 'string', description: 'Scene lore key (use location_key or scene_key)' },
        include: {
          type: 'object',
          properties: {
            events: { type: 'integer', minimum: 0, description: 'Number of recent events to include' },
            open_setups: { type: 'boolean', description: 'Include open setups' },
            relationships: { type: 'boolean', description: 'Include relationship data' },
            sensory: { type: 'boolean', description: 'Include sensory profile' },
          },
          additionalProperties: false,
          description: 'Optional sections to include in the brief',
        },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'pov_entity_key'],
      properties: {
        action: { type: 'string', const: 'render_pov', description: "Render a scene from an entity's point of view" },
        pov_entity_key: { type: 'string', minLength: 1, description: 'Entity whose POV to render from' },
        scene_key: { type: 'string', description: 'Scene lore key (optional if location_key given)' },
        location_key: { type: 'string', description: 'Location lore key (optional if scene_key given)' },
        include_voice_hints: { type: 'boolean', description: 'Include narrative voice hints in the output' },
        reveal_threshold: { type: 'number', minimum: 0, maximum: 1, description: 'Knowledge threshold 0–1 for revealing hidden details' },
      },
      additionalProperties: false,
    },
  ],
}

// ─── continuity_manage ───────────────────────────────────────────────────────

const CONTINUITY_MANAGE_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  oneOf: [
    {
      type: 'object',
      required: ['action', 'entity_key', 'verb'],
      properties: {
        action: { type: 'string', const: 'append_event', description: 'Append an event to the event log for an entity' },
        entity_key: { type: 'string', minLength: 1, description: 'Entity lore key the event belongs to' },
        verb: { type: 'string', minLength: 1, description: 'Action verb describing the event' },
        object: { type: 'string', description: 'Object of the verb' },
        location: { type: 'string', description: 'Location where the event occurred' },
        thread: { type: 'string', description: 'Thread the event belongs to' },
        detail: { type: 'string', description: 'Additional narrative detail' },
        at: { type: 'string', description: 'ISO datetime of the event (defaults to now)' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'entity_key'],
      properties: {
        action: { type: 'string', const: 'get_event_log', description: 'Get the event log for one or more entities' },
        entity_key: {
          oneOf: [
            { type: 'string', minLength: 1 },
            { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 },
          ],
          description: 'Entity lore key or array of keys',
        },
        since: { type: 'string', description: 'ISO datetime — only return events after this time' },
        until: { type: 'string', description: 'ISO datetime — only return events before this time' },
        thread: { type: 'string', description: 'Filter by thread' },
        verbs: { type: 'array', items: { type: 'string' }, description: 'Filter by verb list' },
        limit: { type: 'number', minimum: 1, maximum: 500, description: 'Max events to return (default: 50)' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', const: 'recent_changes', description: 'List recent lore changes across the store' },
        since: { type: 'string', description: 'ISO datetime — only changes after this time' },
        key_prefix: { type: 'string', description: 'Filter by key prefix' },
        limit: { type: 'number', minimum: 1, maximum: 200, description: 'Max results (default: 30)' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'key'],
      properties: {
        action: { type: 'string', const: 'tag_topic', description: 'Add or remove tags on a lore topic' },
        key: { type: 'string', minLength: 1, description: 'Lore entry key to tag' },
        add: { type: 'array', items: { type: 'string' }, description: 'Tags to add' },
        remove: { type: 'array', items: { type: 'string' }, description: 'Tags to remove' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'tags'],
      properties: {
        action: { type: 'string', const: 'find_by_tag', description: 'Find lore entries by tag' },
        tags: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Tags to search for' },
        mode: { type: 'string', enum: ['any', 'all'], description: 'Match any tag or all tags (default: any)' },
        with_excerpt: { type: 'boolean', description: 'Include a text excerpt in results' },
        limit: { type: 'number', minimum: 1, maximum: 100, description: 'Max results (default: 20)' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', const: 'list_tags', description: 'List all tags in use, optionally filtered by prefix' },
        prefix: { type: 'string', description: 'Filter tags by prefix' },
        with_counts: { type: 'boolean', description: 'Include usage counts (default: true)' },
        limit: { type: 'number', minimum: 1, maximum: 500, description: 'Max results (default: 200)' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'name'],
      properties: {
        action: { type: 'string', const: 'bookmark_state', description: 'Bookmark the current world state with a name' },
        name: { type: 'string', minLength: 1, description: 'Name for this bookmark' },
        key_prefix: { type: 'string', description: 'Scope the bookmark to keys with this prefix' },
        note: { type: 'string', description: 'Optional descriptive note' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'from'],
      properties: {
        action: { type: 'string', const: 'world_diff', description: 'Diff the world state between two bookmarks or timepoints' },
        from: { type: 'string', minLength: 1, description: 'Start bookmark name or ISO datetime' },
        to: { type: 'string', description: 'End bookmark name or ISO datetime (defaults to now)' },
        detail: { type: 'string', enum: ['summary', 'fields', 'text'], description: 'Level of diff detail (default: summary)' },
        key_prefix: { type: 'string', description: 'Scope diff to keys with this prefix' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'id', 'description'],
      properties: {
        action: { type: 'string', const: 'plant_setup', description: 'Plant a narrative setup (Chekhov gun) for later payoff' },
        id: { type: 'string', minLength: 1, description: 'Unique setup identifier' },
        description: { type: 'string', minLength: 1, description: 'What the setup establishes' },
        planted_in: { type: 'string', description: 'Scene or lore key where this was planted' },
        tension: { type: 'number', minimum: 1, maximum: 5, description: 'Narrative tension level 1–5' },
        expected_in: { type: 'string', description: 'Scene or chapter where payoff is expected' },
        actors: { type: 'array', items: { type: 'string' }, description: 'Entity keys involved in this setup' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'id', 'resolution'],
      properties: {
        action: { type: 'string', const: 'pay_off_setup', description: 'Pay off a previously planted setup' },
        id: { type: 'string', minLength: 1, description: 'Setup identifier to pay off' },
        resolution: { type: 'string', minLength: 1, description: 'How the setup was resolved' },
        paid_in: { type: 'string', description: 'Scene or lore key where the payoff occurred' },
        status: { type: 'string', enum: ['paid', 'abandoned', 'deferred'], description: 'Payoff status (default: paid)' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', const: 'list_unpaid_setups', description: 'List all setups that have not yet been paid off' },
        actor: { type: 'string', description: 'Filter by entity key involved as an actor' },
        scope: { type: 'string', enum: ['scene', 'chapter', 'story'], description: 'Filter by expected payoff scope' },
        min_tension: { type: 'number', minimum: 1, maximum: 5, description: 'Minimum tension level to include' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action', 'entity_key', 'goal_id', 'description'],
      properties: {
        action: { type: 'string', const: 'set_goal', description: "Set or update a goal for an entity" },
        entity_key: { type: 'string', minLength: 1, description: 'Entity lore key' },
        goal_id: { type: 'string', minLength: 1, description: 'Unique goal identifier for this entity' },
        description: { type: 'string', minLength: 1, description: 'Goal description' },
        parent: { type: 'string', description: 'Parent goal ID if this is a sub-goal' },
        status: { type: 'string', enum: ['active', 'blocked', 'achieved', 'abandoned'], description: 'Goal status (default: active)' },
        obstacle: { type: 'string', description: 'What is currently blocking this goal' },
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', const: 'check_continuity', description: 'Run continuity checks across the world state' },
        scope: { type: 'string', description: 'Limit checks to a lore key prefix or scope' },
        checks: {
          type: 'array',
          items: { type: 'string', enum: ['dangling', 'occupancy', 'knowledge', 'inventory'] },
          description: 'Check types to run (default: all)',
        },
        severity_floor: { type: 'string', enum: ['info', 'warn', 'error'], description: 'Minimum severity to report (default: info)' },
      },
      additionalProperties: false,
    },
  ],
}

// ─── Tool Definitions ────────────────────────────────────────────────────────

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'lore_manage',
    title: 'Lore Manage',
    version: '1.0.0',
    description: 'KV lore store — read, write, search, and mutate lore entries. Actions: get, get_batch, get_section, list, list_maps, get_map, search, validate, set, delete, patch, batch_set, batch_mutate, restore, history, increment, append_section. IMPORTANT: Always call validate before get_lore when the key is ambiguous, user-supplied, or AI-generated. The validate action returns did_you_mean with a confidence score — use this to resolve uncertain keys before reading. get_lore also auto-suggests alternatives in its error response when a key is not found.',
    inputSchema: LORE_MANAGE_SCHEMA,
  },
  {
    name: 'entity_manage',
    title: 'Entity Manage',
    version: '1.0.0',
    description: 'Entity lifecycle — generate, move, inventory, encounters, consumption timelines, and interaction resolution. Actions: generate, move, roll_encounter, advance_stage, batch_stage, get_inventory, transfer_item, get_sensory_profile, get_compatibility, analyze_utility, map_integration, list_consumption_timelines, list_active_threads, resolve_interaction, create_consumption_timeline, set_consumption_timeline',
    inputSchema: ENTITY_MANAGE_SCHEMA,
  },
  {
    name: 'world_manage',
    title: 'World Manage',
    version: '1.0.0',
    description: 'World state — threads, relationships, factions, knowledge, locations, and convergence checks. Actions: thread_tick, get_relationship, get_faction_standing, get_entity_knowledge, get_location_occupants, get_reachable_locations, sense_environment, get_thread_comparison, check_convergence',
    inputSchema: WORLD_MANAGE_SCHEMA,
  },
  {
    name: 'scene_manage',
    title: 'Scene Manage',
    version: '1.0.0',
    description: 'Scene management — activate scenes, present and commit choices, scene briefs, and POV rendering. Actions: activate, present_choices, commit_choice, get_history, brief, render_pov',
    inputSchema: SCENE_MANAGE_SCHEMA,
  },
  {
    name: 'continuity_manage',
    title: 'Continuity Manage',
    version: '1.0.0',
    description: 'Continuity tracking — events, tags, bookmarks, world diff, setups, goals, and continuity checks. Actions: append_event, get_event_log, recent_changes, tag_topic, find_by_tag, list_tags, bookmark_state, world_diff, plant_setup, pay_off_setup, list_unpaid_setups, set_goal, check_continuity',
    inputSchema: CONTINUITY_MANAGE_SCHEMA,
  },
  // RPG engine tools (Mnehmos port + meta)
  ...rpgToolDefinitions,
  ...rpgMetaToolDefinitions,
]
