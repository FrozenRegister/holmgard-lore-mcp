// src/rpg/handlers/load-tool-schema.ts
// Meta-tool: return the full JSON schema for a named tool.
// Includes fuzzy matching and did_you_mean suggestions for typos.

import { z } from 'zod'
import { ok, err, type McpResponse } from '../utils/response'
import { findCloseMatches } from '../../lib/fuzzy-match'
import type { AppBindings } from '../../types'

const InputSchema = z.object({
  toolName: z.string().min(1).describe('Exact tool name to retrieve the schema for'),
  sub: z
    .string()
    .optional()
    .describe(
      'For the "rpg" tool only — the sub-system to get the schema for (e.g. "corpse", "combat", "quest"). Returns that sub\'s input schema.',
    ),
})

interface ToolSchema {
  name: string
  description: string
  inputSchema: unknown
}

let _schemaIndex: Record<string, ToolSchema> | null = null

// #339 — sub-level schema registry for the "rpg" monolith tool.
// Each entry maps an rpg sub name (e.g. "corpse", "quest") to its
// input schema, so load_tool_schema({ toolName: "rpg", sub: "corpse" })
// returns the corpse-manage handler's parameter schema.
// Built incrementally — only populated for subs that opt in.
let _rpgSubSchemaIndex: Record<string, ToolSchema> | null = null

// #424 — sub→canonical alias map for the "rpg" tool (e.g. "maps" → "world_map"),
// populated alongside registerRpgSubSchema for every `{ sub, aliasOf }` entry in
// index.ts's SUB_SCHEMAS array. Surfaced in load_tool_schema({toolName:"rpg"})'s
// no-sub response so the aliasOf pattern is discoverable without already
// knowing an alias exists — previously the only way to learn "maps" resolves
// to "world_map" was reading source or guessing.
let _rpgAliasIndex: Record<string, string> | null = null

export function registerRpgAlias(aliasSub: string, canonicalSub: string): void {
  if (!_rpgAliasIndex) _rpgAliasIndex = {}
  _rpgAliasIndex[aliasSub] = canonicalSub
}

export function setSchemaIndex(
  tools: Array<{ name: string; inputSchema: unknown; description: string }>,
) {
  _schemaIndex = Object.fromEntries(
    tools.map((t) => [
      t.name,
      { name: t.name, description: t.description, inputSchema: t.inputSchema },
    ]),
  )
}

/**
 * Register a sub-level schema for the "rpg" tool.
 * Call this during startup for every rpg handler that wants its schema
 * discoverable via load_tool_schema.
 *
 * Example: registerRpgSubSchema("corpse", "Corpse management", corpseSchemaDoc)
 */
export function registerRpgSubSchema(
  subName: string,
  description: string,
  inputSchema: unknown,
): void {
  if (!_rpgSubSchemaIndex) _rpgSubSchemaIndex = {}
  _rpgSubSchemaIndex[subName] = {
    name: `rpg.sub:${subName}`,
    description,
    inputSchema,
  }
}

export async function handleLoadToolSchema(
  _env: AppBindings,
  args: Record<string, unknown>,
): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map((i) => i.message).join('; '))
  if (!_schemaIndex) return err('Schema index not yet initialized')

  const { toolName, sub } = parsed.data

  // #339 — sub-level lookup: load_tool_schema({ toolName: "rpg", sub: "corpse" })
  if (sub && toolName === 'rpg' && _rpgSubSchemaIndex) {
    const subSchema = _rpgSubSchemaIndex[sub]
    if (subSchema) {
      return ok({ success: true, toolName, sub, schema: subSchema })
    }
    const allSubs = Object.keys(_rpgSubSchemaIndex)
    const suggestions = findCloseMatches(sub, allSubs, 0.3, 5)
    if (suggestions.length > 0) {
      return err(
        `RPG sub "${sub}" not found in schema index. Did you mean: ${suggestions.map((s) => `${s.name} (${(s.score * 100).toFixed(0)}%)`).join(', ')}?`,
        {
          toolName,
          sub,
          didYouMean: suggestions.map((s) => ({ name: s.name, confidence: s.score })),
        },
      )
    }
    return err(
      `RPG sub "${sub}" not found in schema index. Use load_tool_schema({ toolName: "search_tools", query: "corpse" }) or check rpg.definitions.ts for the full sub list.`,
      { toolName, sub },
    )
  }

  const schema = _schemaIndex[toolName]

  if (schema) {
    // #424 — the "rpg" tool's no-sub schema is the natural place to advertise
    // aliasOf shortcuts (maps→world_map, stealth→perception, etc.) since that's
    // exactly where a caller already looks to see the full `sub` enum.
    if (toolName === 'rpg' && _rpgAliasIndex) {
      return ok({ success: true, toolName, schema, aliases: _rpgAliasIndex })
    }
    return ok({ success: true, toolName, schema })
  }

  // Tool not found — compute did_you_mean suggestions using fuzzy matching
  const allNames = Object.keys(_schemaIndex)
  const suggestions = findCloseMatches(toolName, allNames, 0.5, 5)

  if (suggestions.length === 0) {
    return err(`Tool "${toolName}" not found. Use search_tools to discover available tools.`, {
      toolName,
      availableToolCount: allNames.length,
    })
  }

  return err(
    `Tool "${toolName}" not found. Did you mean: ${suggestions.map((s) => `${s.name} (${(s.score * 100).toFixed(0)}%)`).join(', ')}?`,
    { toolName, didYouMean: suggestions.map((s) => ({ name: s.name, confidence: s.score })) },
  )
}
