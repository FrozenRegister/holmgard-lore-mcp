// src/rpg/handlers/search-tools.ts
// Meta-tool: fuzzy-search the full combined tool list by name or description.

import { z } from 'zod'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const InputSchema = z.object({
  query: z.string().min(1).describe('Search term to match against tool names and descriptions'),
  limit: z.number().int().min(1).max(50).optional().default(10),
})

let _toolIndex: Array<{ name: string; description: string }> | null = null

export function setToolIndex(tools: Array<{ name: string; description: string }>) {
  _toolIndex = tools
}

export async function handleSearchTools(_env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  if (!_toolIndex) return err('Tool index not yet initialized')
  const { query, limit } = parsed.data
  const q = query.toLowerCase()
  const matches = _toolIndex
    .filter(t => t.name.includes(q) || t.description.toLowerCase().includes(q))
    .slice(0, limit)
    .map(t => ({ name: t.name, description: t.description.slice(0, 100) }))
  return ok({ success: true, query, matches, count: matches.length, totalTools: _toolIndex.length })
}
