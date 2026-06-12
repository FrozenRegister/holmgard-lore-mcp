// src/tools/system.ts
import { z } from 'zod'
import { kvGet, kvList, kvListMaps } from '../lib/kv'
import { makeResult, makeError } from '../lib/rpc'
import { parseKvEntry, parseLoreSections } from '../lib/lore'
import { formatD1CharToLore } from '../rpg/utils/kv-to-d1'
import type { ToolContext } from './types'

export async function handle_list_topics({ c, id, args }: ToolContext): Promise<Response> {
  const allKeys = await kvList(c)
  const limit = Math.min(1000, (args?.limit as number) ?? 1000)
  const offset = Math.max(0, (args?.offset as number) ?? 0)
  const keys = allKeys.slice(offset, offset + limit)
  return c.json(makeResult(id, {
    content: [{ type: 'text', text: keys.join(', ') }],
    metadata: { count: keys.length, total: allKeys.length, limit, offset }
  }), 200)
}

export async function handle_list_maps({ c, id, args }: ToolContext): Promise<Response> {
  const allKeys = await kvListMaps(c)
  const limit = Math.min(1000, (args?.limit as number) ?? 1000)
  const offset = Math.max(0, (args?.offset as number) ?? 0)
  const keys = allKeys.slice(offset, offset + limit)
  return c.json(makeResult(id, {
    content: [{ type: 'text', text: keys.join(', ') }],
    metadata: { count: keys.length, total: allKeys.length, limit, offset }
  }), 200)
}

export async function handle_get_map({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({ map_id: z.string().min(1) })
  const parsed = schema.safeParse(args)
  if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

  const mapId = parsed.data.map_id.trim().toLowerCase()
  const key = mapId.startsWith('map:') ? mapId : `map:${mapId}`
  const raw = await kvGet(c, key)
  if (!raw) return c.json(makeError(id, -32602, `No map found for "${key}". Use list_maps to see available maps.`, null), 200)

  const { text, meta } = parseKvEntry(raw)
  return c.json(makeResult(id, { content: [{ type: 'text', text }], key, text, meta }), 200)
}

export async function handle_get_lore({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({ query: z.string().min(1) })
  const parsed = schema.safeParse(args)
  if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

  const key = parsed.data.query.trim().toLowerCase()
  const raw = await kvGet(c, key)
  if (!raw) return c.json(makeError(id, -32602, `No lore found for key "${key}"`, null), 200)

  const { text, meta } = parseKvEntry(raw)

  // Auto-redirect: if KV entry has been migrated to D1, serve live D1 data instead
  if (text.includes('## D1-Migrated: true') && c.env.RPG_DB) {
    const idMatch = text.match(/^## D1-Character-ID:\s*(\S+)/m)
    if (idMatch) {
      try {
        const row = await c.env.RPG_DB.prepare('SELECT * FROM characters WHERE id = ?').bind(idMatch[1]).first()
        if (row) {
          const loreText = formatD1CharToLore(row as Record<string, unknown>)
          return c.json(makeResult(id, {
            content: [{ type: 'text', text: loreText }],
            key, text: loreText, meta: { ...meta, d1_redirect: true, d1_id: idMatch[1] }
          }), 200)
        }
      } catch {
        // D1 unavailable or schema not ready — fall through to stale KV text
      }
      // D1 row missing or D1 error — fall through and return stale KV text as-is
    }
  }

  return c.json(makeResult(id, { content: [{ type: 'text', text }], key, text, meta }), 200)
}

export async function handle_get_lore_batch({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({ keys: z.array(z.string().min(1)).min(1) })
  const parsed = schema.safeParse(args)
  if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

  const cleanKeys = parsed.data.keys.map(k => k.trim().toLowerCase())
  const rawValues = await Promise.all(cleanKeys.map(k => kvGet(c, k)))
  const results: Record<string, any> = {}
  cleanKeys.forEach((k, i) => { results[k] = rawValues[i] ? parseKvEntry(rawValues[i]!) : null })

  const text = Object.entries(results)
    .map(([k, v]) => v ? `${k}: [retrieved]` : `${k}: [not found]`)
    .join('\n')

  return c.json(makeResult(id, {
    content: [{ type: 'text', text }],
    metadata: { retrieved: Object.values(results).filter(v => v !== null).length, total: parsed.data.keys.length },
    results
  }), 200)
}

export async function handle_get_lore_section({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({
    key: z.string().min(1),
    sections: z.array(z.string().min(1)),
    mode: z.enum(['strict', 'loose']).default('loose'),
  })
  const parsed = schema.safeParse(args)
  if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

  const key = parsed.data.key.trim().toLowerCase()
  const raw = await kvGet(c, key)
  if (!raw) {
    return c.json(makeResult(id, {
      content: [{ type: 'text', text: `Key not found: "${key}"` }],
      error: 'key_not_found', key
    }), 200)
  }

  const { text, meta } = parseKvEntry(raw)
  const version = typeof meta.version === 'number' ? meta.version : null
  const { sections, not_found, warnings } = parseLoreSections(text, parsed.data.sections, parsed.data.mode)

  const foundCount = Object.keys(sections).length
  const summary = foundCount > 0
    ? `Retrieved ${foundCount} section(s) from "${key}".${not_found.length ? ` Not found: ${not_found.join(', ')}.` : ''}`
    : `No matching sections found in "${key}".`

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: summary }],
    key, version, sections, not_found, warnings
  }), 200)
}

export async function handle_validate_topic_exists({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({ query_string: z.string().min(1) })
  const parsed = schema.safeParse(args)
  if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

  const allKeys = await kvList(c)
  const query = parsed.data.query_string.trim().toLowerCase()

  if (allKeys.includes(query)) {
    return c.json(makeResult(id, {
      content: [{ type: 'text', text: `Found: ${query}` }],
      exists: true, exact_match: query, namespace_matches: [], suggestion: query
    }), 200)
  }

  const suggestions = allKeys.filter(k => k.includes(query))
  if (suggestions.length > 0) {
    return c.json(makeResult(id, {
      content: [{ type: 'text', text: `No exact match for "${query}", but found: ${suggestions.join(', ')}` }],
      exists: false, exact_match: null, namespace_matches: suggestions, suggestion: suggestions[0] || null
    }), 200)
  }

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: `No lore found matching "${query}".` }],
    exists: false, exact_match: null, namespace_matches: [], suggestion: null
  }), 200)
}

export async function handle_search_lore({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({
    query: z.string().min(1),
    max_results: z.number().min(1).max(50).default(10)
  })
  const parsed = schema.safeParse(args)
  if (!parsed.success) return c.json(makeError(id, -32602, 'Invalid params', parsed.error.format()), 200)

  const searchQuery = parsed.data.query.toLowerCase()
  const allKeys = await kvList(c)
  const results: Array<{ key: string; excerpt: string }> = []
  const CHUNK_SIZE = 50

  for (let chunkStart = 0; chunkStart < allKeys.length; chunkStart += CHUNK_SIZE) {
    if (results.length >= parsed.data.max_results) break
    const chunkKeys = allKeys.slice(chunkStart, chunkStart + CHUNK_SIZE)
    const chunkRaws = await Promise.all(chunkKeys.map(k => kvGet(c, k)))

    for (let i = 0; i < chunkKeys.length; i++) {
      if (results.length >= parsed.data.max_results) break
      const raw = chunkRaws[i]
      if (!raw) continue
      const key = chunkKeys[i]
      const { text } = parseKvEntry(raw)
      const lowerText = text.toLowerCase()
      const idx = lowerText.indexOf(searchQuery)
      if (idx === -1) continue

      const start = Math.max(0, idx - 30)
      const end = Math.min(text.length, idx + searchQuery.length + 50)
      let excerpt = text.slice(start, end)
      if (start > 0) excerpt = '…' + excerpt
      if (end < text.length) excerpt = excerpt + '…'

      results.push({ key, excerpt })
    }
  }

  const summaryText = results.length > 0
    ? results.map(r => `${r.key}: "${r.excerpt}"`).join('\n')
    : `No lore entries matching "${parsed.data.query}".`

  return c.json(makeResult(id, {
    content: [{ type: 'text', text: summaryText }],
    metadata: { query: parsed.data.query, match_count: results.length },
    results
  }), 200)
}
