// src/tools/definitions.ts

export const toolDefinitions: any[] = [
  {
    name: 'ping_tool', title: 'Ping Tool', version: '0.0.1',
    description: 'Trivial tool used to validate discovery.',
    inputSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: {}, additionalProperties: false },
    examples: [{ arguments: {} }]
  },
  {
    name: 'check_authentication',
    title: 'Check Authentication',
    version: '0.1.0',
    description: 'Returns whether this request was made with a valid API key. Use this to confirm your integration is authenticated before performing sensitive operations.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: 'get_lore', title: 'Get Lore', version: '0.1.3',
    description: 'Retrieve lore, anatomy, factions, and worldbuilding information by topic key.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        query: { type: 'string', description: 'Exact topic key to retrieve (e.g. "lamia", "location:undercity")', minLength: 1 }
      },
      required: ['query'], additionalProperties: false
    },
    examples: [{ arguments: { query: 'lamia' } }]
  },
  {
    name: 'list_topics', title: 'List Topics', version: '0.1.1',
    description: 'Return available lore topic keys. Supports optional pagination.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 1000, default: 1000, description: 'Max keys to return' },
        offset: { type: 'integer', minimum: 0, default: 0, description: 'Number of keys to skip' }
      },
      additionalProperties: false
    },
    examples: [{ arguments: {} }]
  },
  {
    name: 'list_maps', title: 'List Maps', version: '0.1.0',
    description: 'List all available map topics (world-editor map hierarchies). Each key has the format "map:<mapId>".',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 1000, default: 1000, description: 'Max keys to return' },
        offset: { type: 'integer', minimum: 0, default: 0, description: 'Number of keys to skip' }
      },
      additionalProperties: false
    },
    examples: [{ arguments: {} }]
  },
  {
    name: 'set_lore', title: 'Set Lore', version: '0.1.0',
    description: 'Write or update a lore entry. Use this to record new worldbuilding, anatomy, factions, or location details so they persist for future queries.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        key: { type: 'string', description: 'Topic key — lowercase, no spaces (e.g. "lamia", "undercity")', minLength: 1 },
        text: { type: 'string', description: 'Full lore text to store for this topic.', minLength: 1 }
      },
      required: ['key', 'text'], additionalProperties: false
    },
    examples: [{ arguments: { key: 'lamia', text: 'Lamia are subterranean predators...' } }]
  },
  {
    name: 'delete_lore', title: 'Delete Lore', version: '0.1.0',
    description: 'Permanently delete a lore entry by key.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        key: { type: 'string', description: 'Topic key to delete', minLength: 1 }
      },
      required: ['key'], additionalProperties: false
    },
    examples: [{ arguments: { key: 'thornwall' } }]
  },
  {
    name: 'get_lore_batch', title: 'Get Lore Batch', version: '0.1.0',
    description: 'Retrieve multiple lore entries in one call. Optimized for reducing API round-trips.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        keys: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description: 'Array of topic keys to retrieve (e.g. ["character:sarah-weaver", "location:fernveil:outpost:deep-forest-cafe", "system:active-narratives"])',
          minItems: 1
        }
      },
      required: ['keys'], additionalProperties: false
    },
    examples: [{ arguments: { keys: ['character:sarah-weaver', 'location:fernveil:outpost:deep-forest-cafe'] } }]
  },
  {
    name: 'get_lore_section', title: 'Get Lore Section', version: '0.1.0',
    description: 'Retrieve one or more named ## sections from a lore entry without fetching the full text. Returns a sections map, a not_found list for missing sections, and a warnings array for duplicates or empty sections.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        key: { type: 'string', description: 'Topic key to retrieve sections from (e.g. "character:kavissa-crowmark")', minLength: 1 },
        sections: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description: 'Section names to retrieve (matched against ## headings, e.g. ["Personality", "Goals"])'
        },
        mode: {
          type: 'string',
          enum: ['strict', 'loose'],
          default: 'loose',
          description: '"loose" (default): case-insensitive, whitespace-normalized, trailing-colon-stripped. "strict": case-insensitive, exact otherwise.'
        }
      },
      required: ['key', 'sections'], additionalProperties: false
    },
    examples: [{ arguments: { key: 'character:example', sections: ['Personality', 'Goals'] } }]
  },
  {
    name: 'list_consumption_timelines', title: 'List Consumption Timelines', version: '0.2.0',
    description: 'Return all prey-characters with current consumption-status and timeline-remaining. Scans all character:* keys for Consumption-Timeline fields.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        status_filter: {
          type: 'string',
          enum: ['all', 'imminent', 'days-to-weeks', 'weeks-to-months', 'consumed'],
          default: 'all',
          description: 'Filter by consumption status. "imminent" = hours or 1 day remaining.'
        }
      },
      additionalProperties: false
    },
    examples: [{ arguments: { status_filter: 'imminent' } }]
  },
  {
    name: 'list_active_threads', title: 'List Active Threads', version: '0.1.0',
    description: 'Return all active consumption/predation threads with current status.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {},
      additionalProperties: false
    },
    examples: [{ arguments: {} }]
  },
  {
    name: 'increment_topic_field', title: 'Increment Topic Field', version: '0.1.0',
    description: 'Atomically increment a numeric field in a topic without full rewrite.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        key: { type: 'string', description: 'Topic key (e.g. "character:lucinda-prime-livestock")', minLength: 1 },
        field_path: { type: 'string', description: 'Field to increment (e.g. "days_remaining", "version")', minLength: 1 },
        increment: { type: 'integer', description: 'Positive or negative integer to add', default: 1 },
        reason: { type: 'string', description: 'Reason for the change (logged)', default: 'system-update' }
      },
      required: ['key', 'field_path'], additionalProperties: false
    },
    examples: [{ arguments: { key: 'character:lucinda-prime-livestock', field_path: 'days_remaining', increment: -1, reason: 'daily-decrement' } }]
  },
  {
    name: 'validate_topic_exists', title: 'Validate Topic Exists', version: '0.1.0',
    description: 'Check if a topic exists and return namespace-suggestions if not.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        query_string: { type: 'string', description: 'What the user asked for (e.g. "molly")', minLength: 1 }
      },
      required: ['query_string'], additionalProperties: false
    },
    examples: [{ arguments: { query_string: 'molly' } }]
  },
  {
    name: 'search_lore', title: 'Search Lore', version: '0.1.0',
    description: 'Full-text search across all lore entry bodies. Returns matching keys with excerpt snippets.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term (case-insensitive substring match)', minLength: 1 },
        max_results: { type: 'integer', minimum: 1, maximum: 50, default: 10 }
      },
      required: ['query'], additionalProperties: false
    },
    examples: [{ arguments: { query: 'lamia', max_results: 5 } }]
  },
  {
    name: 'patch_lore', title: 'Patch Lore', version: '0.1.0',
    description: 'Surgically modify a lore entry without full overwrite. Supports replace, append, and delete_field operations on substrings.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        key: { type: 'string', description: 'Topic key to modify', minLength: 1 },
        operation: { type: 'string', enum: ['replace', 'append', 'delete_field'], description: 'Operation to perform: replace, append, or delete_field' },
        target: { type: 'string', description: 'Exact substring to match. Required for replace and delete_field. Optional for append (if omitted, appends to end of text).' },
        value: { type: 'string', description: 'New text. Required for replace and append. Ignored for delete_field.' }
      },
      required: ['key', 'operation'], additionalProperties: false
    },
    examples: [{ arguments: { key: 'character:example', operation: 'replace', target: 'Status: Alive', value: 'Status: Sedated' } }]
  },
  {
    name: 'batch_set_lore', title: 'Batch Set Lore', version: '0.1.0',
    description: 'Write or overwrite multiple lore entries in one call. Returns per-key success/failure. Uses parallel writes — not transactional; partial success is possible.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        entries: {
          type: 'array', minItems: 1,
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', minLength: 1 },
              text: { type: 'string', minLength: 1 }
            },
            required: ['key', 'text'], additionalProperties: false
          }
        }
      },
      required: ['entries'], additionalProperties: false
    },
    examples: [{ arguments: { entries: [{ key: 'character:zira', text: 'Zira lore...' }, { key: 'character:vex', text: 'Vex lore...' }] } }]
  },
  {
    name: 'batch_mutate', title: 'Batch Mutate', version: '0.1.0',
    description: 'Apply multiple mutations (increment or patch) across multiple keys in one call. Each mutation is applied sequentially. Returns per-mutation outcome.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        mutations: {
          type: 'array', minItems: 1,
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', minLength: 1 },
              action: { type: 'string', enum: ['increment', 'patch'] },
              field_path: { type: 'string' },
              increment: { type: 'integer' },
              reason: { type: 'string' },
              operation: { type: 'string', enum: ['replace', 'append', 'delete_field'] },
              target: { type: 'string' },
              value: { type: 'string' }
            },
            required: ['key', 'action'], additionalProperties: false
          }
        }
      },
      required: ['mutations'], additionalProperties: false
    },
    examples: [{ arguments: { mutations: [{ key: 'character:zira', action: 'patch', operation: 'replace', target: 'Status: Alive', value: 'Status: Sedated' }, { key: 'character:zira', action: 'increment', field_path: 'Days-Remaining', increment: -1 }] } }]
  },
  {
    name: 'restore_lore', title: 'Restore Lore', version: '0.1.0',
    description: 'Restore a lore entry to its previous state by popping the history stack. Writes to the same key are snapshotted automatically (up to 5 deep).',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        key: { type: 'string', description: 'Topic key to restore', minLength: 1 }
      },
      required: ['key'], additionalProperties: false
    },
    examples: [{ arguments: { key: 'character:sarah-weaver' } }]
  },
  {
    name: 'get_topic_histories', title: 'Get Topic Histories', version: '0.1.0',
    description: 'Retrieve snapshot history for multiple topics in one call. Each topic returns an array of snapshots with version and timestamp metadata. Useful for showing restore points or history logs across all instances.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        keys: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description: 'Array of topic keys to retrieve histories for',
          minItems: 1
        }
      },
      required: ['keys'], additionalProperties: false
    },
    examples: [{ arguments: { keys: ['character:sarah-weaver', 'location:fernveil'] } }]
  },
  {
    name: 'resolve_interaction', title: 'Resolve Interaction', version: '0.1.1',
    description: 'Determine the outcome of an entity interaction via weighted probability. Reads a numeric Weight-1 field from entity_a and a numeric Weight-2 field from entity_b. Computes P(success) = (W1 × 0.7) − (W2 × 0.3), clamps to [0,1], rolls against it, and returns a boolean outcome with delta_value.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        entity_a_id: { type: 'string', description: 'Lore key of the acting entity — must have a numeric Weight-1 field', minLength: 1 },
        entity_b_id: { type: 'string', description: 'Lore key of the opposing entity — must have a numeric Weight-2 field', minLength: 1 },
        action_type: { type: 'string', description: 'Label for the action being attempted (e.g. "consume", "resist", "hunt")', minLength: 1 }
      },
      required: ['entity_a_id', 'entity_b_id', 'action_type'], additionalProperties: false
    },
    examples: [{ arguments: { entity_a_id: 'character:predator', entity_b_id: 'character:prey', action_type: 'consume' } }]
  },
  {
    name: 'analyze_utility', title: 'Analyze Utility', version: '2.0.0',
    description: 'Quantify an entity\'s suitability for a specific Fernveil narrative pathway. Scans ALL numeric lore fields, applies vector-specific weighting with proportional redistribution for missing fields, and returns a per-field breakdown, composite score (0–100), grade (S/A/B/C/D/F), and projected yield narrative.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        entity_id: { type: 'string', description: 'Lore key of the entity to analyse', minLength: 1 },
        utility_vector: {
          type: 'string',
          enum: ['GASTRIC', 'BUTCHERY', 'INCUBATION', 'SCULPTURE', 'PARASITISM', 'THRALL', 'DISTRIBUTED'],
          description: 'Narrative pathway: GASTRIC=prolonged internal processing, BUTCHERY=harvest yield, INCUBATION=brood hosting, SCULPTURE=living artwork, PARASITISM=neural hijack, THRALL=permanent conditioning, DISTRIBUTED=industrial output'
        },
        entity_role: {
          type: 'string',
          enum: ['subject', 'actor'],
          default: 'subject',
          description: '"subject" evaluates prey-oriented fields; "actor" evaluates predator-drive fields (Weight-1, Aggression, Hunger, etc.)'
        }
      },
      required: ['entity_id', 'utility_vector'], additionalProperties: false
    },
    examples: [{ arguments: { entity_id: 'character:target', utility_vector: 'GASTRIC' } }]
  },
  {
    name: 'map_integration', title: 'Map Integration', version: '0.1.0',
    description: 'Permanently transfer [Transferable]-tagged traits from a source entity to a target entity on a state-merge event. integration_depth (0.0–1.0) controls the fraction of available traits transferred.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        source_id: { type: 'string', description: 'Lore key of the source entity (traits are read from here)', minLength: 1 },
        target_id: { type: 'string', description: 'Lore key of the target entity (traits are written here)', minLength: 1 },
        integration_depth: { type: 'number', minimum: 0, maximum: 1, description: 'Fraction of Transferable traits to integrate (0.0 = none, 1.0 = all)' }
      },
      required: ['source_id', 'target_id', 'integration_depth'], additionalProperties: false
    },
    examples: [{ arguments: { source_id: 'character:donor', target_id: 'character:recipient', integration_depth: 0.75 } }]
  },
  {
    name: 'thread_tick', title: 'Thread Tick', version: '0.1.0',
    description: 'Advance a named timeline thread by one tick. Decrements the **Timeline-Value:** field on every entity whose lore contains **Thread:** <thread_id>. Then performs a global sync: finds entities on other threads that share a Current-Date with the ticked entities and returns their status.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        thread_id: { type: 'string', description: 'Thread identifier matching the **Thread:** field in entity lore', minLength: 1 }
      },
      required: ['thread_id'], additionalProperties: false
    },
    examples: [{ arguments: { thread_id: 'thread-alpha' } }]
  },
  {
    name: 'get_relationship', title: 'Get Relationship', version: '0.1.0',
    description: 'Scan two entity lore entries for relationship fields (Affinity, Debt, Threat-Level, Faction) and bidirectional cross-references. Returns structured relationship data, or null with a creation suggestion if no data exists.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        entity_a: { type: 'string', description: 'Lore key of the first entity', minLength: 1 },
        entity_b: { type: 'string', description: 'Lore key of the second entity', minLength: 1 }
      },
      required: ['entity_a', 'entity_b'], additionalProperties: false
    },
    examples: [{ arguments: { entity_a: 'character:alice', entity_b: 'character:bob' } }]
  },
  {
    name: 'get_faction_standing', title: 'Get Faction Standing', version: '0.1.0',
    description: 'Query an entity\'s standing within a faction: membership status, rank, reputation score, outstanding obligations, and current threat-level. Reads both entity and faction entries.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        entity_key: { type: 'string', description: 'Lore key of the entity', minLength: 1 },
        faction_key: { type: 'string', description: 'Lore key of the faction', minLength: 1 }
      },
      required: ['entity_key', 'faction_key'], additionalProperties: false
    },
    examples: [{ arguments: { entity_key: 'character:alice', faction_key: 'faction:guild' } }]
  },
  {
    name: 'get_entity_knowledge', title: 'Get Entity Knowledge', version: '0.1.0',
    description: 'Return what one entity canonically knows about a topic. Checks Knows/Knowledge/Awareness fields on the entity entry. Critical for preventing narrator from having entities reference things they should not know.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        entity_key: { type: 'string', description: 'Lore key of the querying entity', minLength: 1 },
        topic: { type: 'string', description: 'Topic to check knowledge of (entity key, event name, or keyword)', minLength: 1 }
      },
      required: ['entity_key', 'topic'], additionalProperties: false
    },
    examples: [{ arguments: { entity_key: 'character:scout', topic: 'location:hidden-base' } }]
  },
  {
    name: 'get_location_occupants', title: 'Get Location Occupants', version: '0.1.0',
    description: 'Scan all lore entries for a Location field matching the given key. Returns an array of entity keys currently at that location with their status summaries.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        location_key: { type: 'string', description: 'Lore key of the location to scan for occupants', minLength: 1 }
      },
      required: ['location_key'], additionalProperties: false
    },
    examples: [{ arguments: { location_key: 'location:market-square' } }]
  },
  {
    name: 'get_reachable_locations', title: 'Get Reachable Locations', version: '0.1.0',
    description: 'Read an origin location\'s Exits or Connections field and return all reachable location keys with danger level, travel cost, and requirements.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        origin_key: { type: 'string', description: 'Lore key of the origin location', minLength: 1 }
      },
      required: ['origin_key'], additionalProperties: false
    },
    examples: [{ arguments: { origin_key: 'location:town-gate' } }]
  },
  {
    name: 'sense_environment', title: 'Sense Environment', version: '0.1.0',
    description: 'Read location lore and filter environmental details through an entity\'s sensory attributes (Perception, Night-Vision, Tracking). Low Perception hides [hidden]/[concealed] lines and [threat]/[danger] lines below 0.4.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        location_key: { type: 'string', description: 'Lore key of the location to sense', minLength: 1 },
        entity_key: { type: 'string', description: 'Lore key of the sensing entity', minLength: 1 }
      },
      required: ['location_key', 'entity_key'], additionalProperties: false
    },
    examples: [{ arguments: { location_key: 'location:dark-cavern', entity_key: 'character:scout' } }]
  },
  {
    name: 'get_inventory', title: 'Get Inventory', version: '0.1.0',
    description: 'Return a structured inventory from an entity lore entry, parsing the Inventory/Items field into item keys and quantities.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        entity_key: { type: 'string', description: 'Lore key of the entity whose inventory to retrieve', minLength: 1 }
      },
      required: ['entity_key'], additionalProperties: false
    },
    examples: [{ arguments: { entity_key: 'character:merchant' } }]
  },
  {
    name: 'transfer_item', title: 'Transfer Item', version: '0.1.0',
    description: 'Move one or more units of an item between two entity inventories. Validates availability in the source entity, then updates both entries. Inventory format: "item-key×qty, item-key×qty".',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        from_entity: { type: 'string', description: 'Lore key of the entity giving the item', minLength: 1 },
        to_entity: { type: 'string', description: 'Lore key of the entity receiving the item', minLength: 1 },
        item_key: { type: 'string', description: 'Identifier of the item to transfer', minLength: 1 },
        quantity: { type: 'integer', minimum: 1, default: 1, description: 'Number of units to transfer' }
      },
      required: ['from_entity', 'to_entity', 'item_key'], additionalProperties: false
    },
    examples: [{ arguments: { from_entity: 'character:merchant', to_entity: 'character:player', item_key: 'sword', quantity: 1 } }]
  },
  {
    name: 'activate_scene', title: 'Activate Scene', version: '0.1.0',
    description: 'Set a scene as active in system:active-scene and hydrate all related entities and location in a single call. Returns description, present entities, available choices, and previously active scene.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        scene_key: { type: 'string', description: 'Lore key of the scene to activate', minLength: 1 }
      },
      required: ['scene_key'], additionalProperties: false
    },
    examples: [{ arguments: { scene_key: 'scene:tavern-confrontation' } }]
  },
  {
    name: 'present_choices', title: 'Present Choices', version: '0.1.0',
    description: 'Read a scene\'s choice lines (format: "- id: description [requires: item] [min-weight: N]") and filter against an entity\'s current inventory and Weight-1. Returns valid and blocked choices.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        scene_key: { type: 'string', description: 'Lore key of the scene containing the choice tree', minLength: 1 },
        entity_key: { type: 'string', description: 'Lore key of the entity making the choice', minLength: 1 }
      },
      required: ['scene_key', 'entity_key'], additionalProperties: false
    },
    examples: [{ arguments: { scene_key: 'scene:tavern-confrontation', entity_key: 'character:player' } }]
  },
  {
    name: 'commit_choice', title: 'Commit Choice', version: '0.1.0',
    description: 'Apply all consequences of a committed choice lore entry: reads Outcome-Seed, State-Change, and Next-Choices fields, updates entity Status and appends to Choice-History. Returns outcome seed and newly unlocked choices.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        choice_id: { type: 'string', description: 'Lore key of the choice entry (e.g. "choice:accept-quest")', minLength: 1 },
        entity_key: { type: 'string', description: 'Lore key of the entity committing the choice', minLength: 1 }
      },
      required: ['choice_id', 'entity_key'], additionalProperties: false
    },
    examples: [{ arguments: { choice_id: 'choice:accept-quest', entity_key: 'character:player' } }]
  },
  {
    name: 'get_choice_history', title: 'Get Choice History', version: '0.1.0',
    description: 'Return the entity\'s logged path through branching narratives from its Choice-History field, parsed into choice IDs and timestamps.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        entity_key: { type: 'string', description: 'Lore key of the entity whose history to retrieve', minLength: 1 }
      },
      required: ['entity_key'], additionalProperties: false
    },
    examples: [{ arguments: { entity_key: 'character:player' } }]
  },
  {
    name: 'advance_state_stage', title: 'Advance State Stage', version: '0.1.0',
    description: 'Advance an entity to the next stage in its configured state machine. Increments State-Stage, decrements Stage-Timer if present, and returns the new stage, remaining stages, and Stage-N-Description for narrator use.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        entity_key: { type: 'string', description: 'Lore key of the entity to advance', minLength: 1 }
      },
      required: ['entity_key'], additionalProperties: false
    },
    examples: [{ arguments: { entity_key: 'character:transforming-entity' } }]
  },
  {
    name: 'process_stage_batch', title: 'Process Stage Batch', version: '0.1.0',
    description: 'Tick ALL entities at a given location that have a State-Stage field. Skips entities already at terminal stage. Returns an array of stage changes and a list of skipped entities.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        location_key: { type: 'string', description: 'Lore key of the location whose entities to advance', minLength: 1 }
      },
      required: ['location_key'], additionalProperties: false
    },
    examples: [{ arguments: { location_key: 'location:processing-chamber' } }]
  },
  {
    name: 'generate_entity', title: 'Generate Entity', version: '0.1.0',
    description: 'Create a new entity instance from a named archetype lore entry. Populates fields from the template, applies location modifier (danger-level → Weight-1 boost), and persists to a timestamped key.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        archetype_key: { type: 'string', description: 'Lore key of the archetype template (e.g. "archetype:guard")', minLength: 1 },
        location_key: { type: 'string', description: 'Optional lore key of the spawn location', minLength: 1 }
      },
      required: ['archetype_key'], additionalProperties: false
    },
    examples: [{ arguments: { archetype_key: 'archetype:guard', location_key: 'location:market-square' } }]
  },
  {
    name: 'roll_encounter', title: 'Roll Encounter', version: '0.1.0',
    description: 'Read a location\'s Encounter-Table field ("archetype:weight, archetype:weight"), roll against a threat_level modifier, and return a generated entity instance at that location.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        location_key: { type: 'string', description: 'Lore key of the location with an Encounter-Table field', minLength: 1 },
        threat_level: { type: 'integer', minimum: 1, maximum: 10, default: 5, description: 'Threat modifier (1=trivial, 10=extreme). Biases rolls toward higher-weight entries.' }
      },
      required: ['location_key'], additionalProperties: false
    },
    examples: [{ arguments: { location_key: 'location:dark-forest', threat_level: 7 } }]
  },
  {
    name: 'get_thread_comparison', title: 'Get Thread Comparison', version: '0.1.0',
    description: 'Compare two named timeline threads: return entity counts, average Timeline-Value per thread, timeline offset, and overlap of shared Current-Date and Location values.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        thread_a: { type: 'string', description: 'Identifier of the first timeline thread', minLength: 1 },
        thread_b: { type: 'string', description: 'Identifier of the second timeline thread', minLength: 1 }
      },
      required: ['thread_a', 'thread_b'], additionalProperties: false
    },
    examples: [{ arguments: { thread_a: 'thread-alpha', thread_b: 'thread-beta' } }]
  },
  {
    name: 'check_convergence', title: 'Check Convergence', version: '0.1.0',
    description: 'Determine whether two timeline threads can intersect by checking for shared Current-Date or Location values across their entities. Returns boolean can_converge with framing text and overlap lists.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        thread_a: { type: 'string', description: 'Identifier of the first timeline thread', minLength: 1 },
        thread_b: { type: 'string', description: 'Identifier of the second timeline thread', minLength: 1 }
      },
      required: ['thread_a', 'thread_b'], additionalProperties: false
    },
    examples: [{ arguments: { thread_a: 'thread-alpha', thread_b: 'thread-beta' } }]
  },
  {
    name: 'get_sensory_profile', title: 'Get Sensory Profile', version: '0.1.0',
    description: 'Return structured sensory data for an entity: temperature, scent, texture, sound signature, and visual descriptors. Reads entity fields first, then falls back to the species/type lore entry.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        entity_key: { type: 'string', description: 'Lore key of the entity to profile', minLength: 1 }
      },
      required: ['entity_key'], additionalProperties: false
    },
    examples: [{ arguments: { entity_key: 'character:hunter' } }]
  },
  {
    name: 'get_compatibility', title: 'Get Compatibility', version: '0.1.0',
    description: 'Check whether two entities can interact via a given interaction type. Validates size ratio (Size field), Weight-1/Weight-2 thresholds, and environment overlap. Returns boolean compatible, constraints list, and risk level.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        entity_a: { type: 'string', description: 'Lore key of the first entity (typically the acting entity)', minLength: 1 },
        entity_b: { type: 'string', description: 'Lore key of the second entity (typically the target)', minLength: 1 },
        interaction_type: { type: 'string', description: 'Label for the interaction being checked (e.g. "consume", "carry", "trade", "merge")', minLength: 1 }
      },
      required: ['entity_a', 'entity_b', 'interaction_type'], additionalProperties: false
    },
    examples: [{ arguments: { entity_a: 'character:predator', entity_b: 'character:prey', interaction_type: 'consume' } }]
  },
  {
    name: 'append_event', title: 'Append Event', version: '0.1.0',
    description: 'Write a timestamped event onto an entity\'s chronicle. Idempotent on identical verb+object within a 1s window to prevent double-logging on retries.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        entity_key: { type: 'string', description: 'Lore key of the entity (e.g. "character:zira")', minLength: 1 },
        verb: { type: 'string', description: 'Action verb (e.g. "sedated", "moved", "revealed")', minLength: 1 },
        object: { type: 'string', description: 'Counterparty or target of the action' },
        location: { type: 'string', description: 'Location key where this event occurred' },
        thread: { type: 'string', description: 'Thread identifier for attribution (e.g. "thread-alpha")' },
        detail: { type: 'string', description: 'Freeform single-line detail' },
        at: { type: 'string', description: 'ISO timestamp (defaults to now)' },
      },
      required: ['entity_key', 'verb'], additionalProperties: false
    }
  },
  {
    name: 'get_event_log', title: 'Get Event Log', version: '0.1.0',
    description: 'Read an entity\'s chronicle of events. Accepts a single key or array of keys. Filterable by date, thread, and verb set.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        entity_key: {
          description: 'Entity key or array of entity keys',
          oneOf: [{ type: 'string', minLength: 1 }, { type: 'array', items: { type: 'string', minLength: 1 } }]
        },
        since: { type: 'string', description: 'ISO timestamp — return events at or after this time' },
        until: { type: 'string', description: 'ISO timestamp — return events at or before this time' },
        thread: { type: 'string', description: 'Filter to events from this thread' },
        verbs: { type: 'array', items: { type: 'string' }, description: 'Filter to these verbs only' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
      },
      required: ['entity_key'], additionalProperties: false
    }
  },
  {
    name: 'recent_changes', title: 'Recent Changes', version: '0.1.0',
    description: 'Feed of the most recent KV mutations across all keys. Useful for cross-thread wake-up briefings — shows what changed while you were out.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        since: { type: 'string', description: 'ISO timestamp — return only changes after this time' },
        key_prefix: { type: 'string', description: 'Scope feed to keys starting with this prefix (e.g. "character:")' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 30 },
      },
      additionalProperties: false
    }
  },
  {
    name: 'tag_topic', title: 'Tag Topic', version: '0.1.0',
    description: 'Attach or remove orthogonal thematic tags on any topic. Tags cross key-prefix boundaries — a scene, character, and location can all share "theme:betrayal".',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        key: { type: 'string', description: 'Topic key to tag', minLength: 1 },
        add: { type: 'array', items: { type: 'string' }, description: 'Tags to add (e.g. ["theme:betrayal", "arc:zira-rescue"])' },
        remove: { type: 'array', items: { type: 'string' }, description: 'Tags to remove' },
      },
      required: ['key'], additionalProperties: false
    }
  },
  {
    name: 'find_by_tag', title: 'Find By Tag', version: '0.1.0',
    description: 'Return all topics sharing a thematic tag. Supports any (union) or all (intersection) mode with optional excerpt previews.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, description: 'Tags to search for' },
        mode: { type: 'string', enum: ['any', 'all'], default: 'any', description: '"any" = union, "all" = intersection' },
        with_excerpt: { type: 'boolean', description: 'Include a short text excerpt for each result' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      required: ['tags'], additionalProperties: false
    }
  },
  {
    name: 'bookmark_state', title: 'Bookmark State', version: '0.1.0',
    description: 'Pin the current world state under a named bookmark — stores key→version pointers, not copies. Use world_diff to compare snapshots.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        name: { type: 'string', description: 'Bookmark name (e.g. "end-of-act-1")', minLength: 1 },
        key_prefix: { type: 'string', description: 'Scope snapshot to keys with this prefix' },
        note: { type: 'string', description: 'Human description of this snapshot point' },
      },
      required: ['name'], additionalProperties: false
    }
  },
  {
    name: 'world_diff', title: 'World Diff', version: '0.1.0',
    description: 'Diff a bookmark against now (or against another bookmark). Returns added, removed, and changed keys with version deltas.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        from: { type: 'string', description: 'Bookmark name to diff from', minLength: 1 },
        to: { type: 'string', description: 'Bookmark name to diff to (defaults to current state)' },
        detail: { type: 'string', enum: ['summary', 'fields', 'text'], default: 'summary' },
        key_prefix: { type: 'string', description: 'Scope the diff to keys with this prefix' },
      },
      required: ['from'], additionalProperties: false
    }
  },
  {
    name: 'plant_setup', title: 'Plant Setup', version: '0.1.0',
    description: 'Register a foreshadow, promise, or open story thread (Chekhov\'s gun). Creates a setup:* entry with tension ranking and actor list.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        id: { type: 'string', description: 'Human-readable setup ID (e.g. "locked-cellar-door")', minLength: 1 },
        description: { type: 'string', description: 'What was planted / what is owed the reader', minLength: 1 },
        planted_in: { type: 'string', description: 'Scene or chapter key where this was planted' },
        tension: { type: 'integer', minimum: 1, maximum: 5, description: 'Tension level 1–5 (5 = most urgent)' },
        expected_in: { type: 'string', description: 'Expected payoff scene or chapter' },
        actors: { type: 'array', items: { type: 'string' }, description: 'Implicated entity keys' },
      },
      required: ['id', 'description'], additionalProperties: false
    }
  },
  {
    name: 'pay_off_setup', title: 'Pay Off Setup', version: '0.1.0',
    description: 'Close a story setup debt — marks it paid, abandoned, or deferred with a resolution note.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        id: { type: 'string', description: 'Setup ID to close', minLength: 1 },
        resolution: { type: 'string', description: 'Brief description of how it resolved', minLength: 1 },
        paid_in: { type: 'string', description: 'Scene or chapter key where it resolved' },
        status: { type: 'string', enum: ['paid', 'abandoned', 'deferred'], default: 'paid' },
      },
      required: ['id', 'resolution'], additionalProperties: false
    }
  },
  {
    name: 'list_unpaid_setups', title: 'List Unpaid Setups', version: '0.1.0',
    description: 'Return all open story promises, sorted by tension descending. The narrator\'s "here is what you owe the reader" surface.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        actor: { type: 'string', description: 'Filter to setups involving this entity key' },
        scope: { type: 'string', enum: ['scene', 'chapter', 'story'], description: 'Filter by expected payoff scope' },
        min_tension: { type: 'integer', minimum: 1, maximum: 5, description: 'Minimum tension level to include' },
      },
      additionalProperties: false
    }
  },
  {
    name: 'set_goal', title: 'Set Goal', version: '0.1.0',
    description: 'Push or update an entity\'s named goal. Goals are stored as **Goal:<id>:** fields in the entity\'s lore text and readable via get_lore.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        entity_key: { type: 'string', description: 'Lore key of the entity', minLength: 1 },
        goal_id: { type: 'string', description: 'Unique goal identifier (e.g. "find-zira")', minLength: 1 },
        description: { type: 'string', description: 'What the entity is trying to achieve', minLength: 1 },
        parent: { type: 'string', description: 'Parent goal ID (for sub-goals)' },
        status: { type: 'string', enum: ['active', 'blocked', 'achieved', 'abandoned'], default: 'active' },
        obstacle: { type: 'string', description: 'What is currently blocking this goal' },
      },
      required: ['entity_key', 'goal_id', 'description'], additionalProperties: false
    }
  },
  {
    name: 'check_continuity', title: 'Check Continuity', version: '0.1.0',
    description: 'Sweep the world for continuity violations: dangling references, occupancy contradictions, and inventory ghosts. Returns categorised findings by severity.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        scope: { type: 'string', description: 'Limit scan to keys matching this prefix or substring' },
        checks: {
          type: 'array',
          items: { type: 'string', enum: ['dangling', 'occupancy', 'knowledge', 'inventory'] },
          description: 'Which checks to run (default: all four)'
        },
        severity_floor: { type: 'string', enum: ['info', 'warn', 'error'], default: 'info' },
      },
      additionalProperties: false
    }
  },
  {
    name: 'scene_brief', title: 'Scene Brief', version: '0.1.0',
    description: 'One composite call assembling everything needed to write a scene: location text, present entities with status/goal/recent-events, open setups, and relationships. Replaces 6–10 individual reads.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        location_key: { type: 'string', description: 'Lore key of the location' },
        scene_key: { type: 'string', description: 'Lore key of an active scene (alternative to location_key)' },
        include: {
          type: 'object',
          properties: {
            events: { type: 'integer', minimum: 0, description: 'Recent events per entity to include (default 5)' },
            open_setups: { type: 'boolean', description: 'Include open setups for present actors (default true)' },
            relationships: { type: 'boolean', description: 'Include relationships between present entities (default true)' },
            sensory: { type: 'boolean', description: 'Include sensory profile for the location' },
          },
          additionalProperties: false
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'render_pov', title: 'Render POV', version: '0.1.0',
    description: 'Re-project a scene through one entity\'s senses and knowledge. Strips [hidden] actors below Perception threshold and facts the POV doesn\'t Know — prevents omniscience leakage.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        pov_entity_key: { type: 'string', description: 'Lore key of the POV entity', minLength: 1 },
        scene_key: { type: 'string', description: 'Lore key of the scene to render' },
        location_key: { type: 'string', description: 'Lore key of the location to render' },
        include_voice_hints: { type: 'boolean', description: 'Include diction/register/fixation hints from entity profile' },
        reveal_threshold: { type: 'number', minimum: 0, maximum: 1, description: 'Override perception threshold (0=sees nothing hidden, 1=sees all)' },
      },
      required: ['pov_entity_key'], additionalProperties: false
    }
  },
  {
    name: 'append_to_section', title: 'Append To Section', version: '0.1.0',
    description: 'Surgically append or prepend text to a named ## section within a lore entry. Locates the section by heading name (case-insensitive, trailing-colon-stripped) and inserts text at the end or start of the section body. Auto-creates missing sections by default.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        key: { type: 'string', description: 'Topic key to modify (e.g. "character:kavissa-crowmark")', minLength: 1 },
        section: { type: 'string', description: 'Section heading to target (case-insensitive, whitespace-normalized, trailing colon stripped)', minLength: 1 },
        text: { type: 'string', description: 'Content to insert. A leading newline preserves paragraph separation. Leading/trailing whitespace is handled automatically.' },
        position: { type: 'string', enum: ['end', 'start'], default: 'end', description: '"end" (default): after the last line of the section body. "start": immediately after the ## heading line.' },
        auto_create: { type: 'boolean', default: true, description: 'When true (default), creates a new ## Section at end of entry if the section does not exist. When false, returns section_not_found.' },
      },
      required: ['key', 'section', 'text'], additionalProperties: false
    },
    examples: [{ arguments: { key: 'character:example', section: 'Personality', text: 'Deeply loyal to companions.' } }]
  },
  {
    name: 'move_entity', title: 'Move Entity', version: '0.1.0',
    description: 'Change an entity\'s Location field and update both the old and new location indexes atomically.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
      properties: {
        entity_key: { type: 'string', description: 'Lore key of the entity to move', minLength: 1 },
        new_location_key: { type: 'string', description: 'Lore key of the destination location', minLength: 1 }
      },
      required: ['entity_key', 'new_location_key'], additionalProperties: false
    },
    examples: [{ arguments: { entity_key: 'character:scout', new_location_key: 'location:tavern' } }]
  }
]
