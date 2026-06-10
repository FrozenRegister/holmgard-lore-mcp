// src/rpg/handlers/load-tool-schema.ts
// Meta-tool: return the full JSON schema for a named tool.

import { z } from 'zod'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const InputSchema = z.object({
  toolName: z.string().min(1).describe('Exact tool name to retrieve the schema for'),
})

let _schemaIndex: Record<string, unknown> | null = null

export function setSchemaIndex(tools: Array<{ name: string; inputSchema: unknown; description: string }>) {
  _schemaIndex = Object.fromEntries(tools.map(t => [t.name, { name: t.name, description: t.description, inputSchema: t.inputSchema }]))
}

export async function handleLoadToolSchema(_env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  if (!_schemaIndex) return err('Schema index not yet initialized')
  const { toolName } = parsed.data
  const schema = _schemaIndex[toolName]
  if (!schema) {
    const available = Object.keys(_schemaIndex).filter(k => k.includes(toolName.toLowerCase().replace(/[_-]/g, ''))).slice(0, 5)
    return err(`Tool "${toolName}" not found.${available.length ? ` Did you mean: ${available.join(', ')}?` : ''}`)
  }
  return ok({ success: true, toolName, schema })
}
