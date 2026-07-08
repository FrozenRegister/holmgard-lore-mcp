// src/rpg/handlers/load-tool-schema.ts
// Meta-tool: return the full JSON schema for a named tool.
// Includes fuzzy matching and did_you_mean suggestions for typos.

import { z } from 'zod'
import { ok, err, type McpResponse } from '../utils/response'
import { findCloseMatches } from '../../lib/fuzzy-match'
import type { AppBindings } from '../../types'

const InputSchema = z.object({
  toolName: z.string().min(1).describe('Exact tool name to retrieve the schema for'),
})

interface ToolSchema {
  name: string
  description: string
  inputSchema: unknown
}

let _schemaIndex: Record<string, ToolSchema> | null = null

export function setSchemaIndex(tools: Array<{ name: string; inputSchema: unknown; description: string }>) {
  _schemaIndex = Object.fromEntries(
    tools.map(t => [t.name, { name: t.name, description: t.description, inputSchema: t.inputSchema }]),
  )
}

export async function handleLoadToolSchema(_env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  if (!_schemaIndex) return err('Schema index not yet initialized')

  const { toolName } = parsed.data
  const schema = _schemaIndex[toolName]

  if (schema) {
    return ok({ success: true, toolName, schema })
  }

  // Tool not found — compute did_you_mean suggestions using fuzzy matching
  const allNames = Object.keys(_schemaIndex)
  const suggestions = findCloseMatches(toolName, allNames, 0.5, 5)

  if (suggestions.length === 0) {
    return err(
      `Tool "${toolName}" not found. Use search_tools to discover available tools.`,
      { toolName, availableToolCount: allNames.length },
    )
  }

  return err(
    `Tool "${toolName}" not found. Did you mean: ${suggestions.map(s => `${s.name} (${(s.score * 100).toFixed(0)}%)`).join(', ')}?`,
    { toolName, didYouMean: suggestions.map(s => ({ name: s.name, confidence: s.score })) },
  )
}

