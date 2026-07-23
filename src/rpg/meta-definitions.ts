// src/rpg/meta-definitions.ts
// JSON Schema definitions for the 2 meta-tools.

export const rpgMetaToolDefinitions: any[] = [
  {
    name: 'search_tools',
    title: 'Search Tools',
    version: '1.0.0',
    description:
      'Fuzzy-search the full tool list by name or description keyword. Returns matching tool names and description excerpts.',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        query: {
          type: 'string',
          minLength: 1,
          description: 'Search term to match against tool names and descriptions',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          default: 10,
          description: 'Max results to return',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'load_tool_schema',
    title: 'Load Tool Schema',
    version: '1.0.0',
    description:
      'Return the full JSON input schema for a named tool. When toolName is "rpg", pass "sub" to get the schema for a specific sub-system (e.g. "corpse", "combat").',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        toolName: {
          type: 'string',
          minLength: 1,
          description:
            'Exact tool name (e.g. "character_manage", "combat_action", or "rpg" for sub-level lookups)',
        },
        sub: {
          type: 'string',
          minLength: 1,
          description:
            'For "rpg" tool only — the sub-system name (e.g. "corpse", "combat", "quest")',
        },
      },
      required: ['toolName'],
      additionalProperties: false,
    },
  },
]
