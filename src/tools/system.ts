// src/tools/system.ts
import { z } from 'zod'
import { kvGet, kvList, kvListMaps } from '../lib/kv'
import { getIndexedKeys, getAllKeys } from '../lib/indexes'
import { makeResult, makeError } from '../lib/rpc'
import { parseKvEntry, parseLoreSections, matchesWorld } from '../lib/lore'
import { formatD1CharToLore } from '../rpg/utils/kv-to-d1'
import type { TypedToolContext } from './types'

export const listTopicsSchema = z.object({
  prefix: z.string().optional(),
  // Freeform **World:** field filter (#259) — narrows cross-world KV noise.
  // Not a D1 world_id FK; see matchesWorld() in lib/lore.ts.
  world: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
})

export async function handle_list_topics({
  c,
  id,
  args,
}: TypedToolContext<typeof listTopicsSchema>): Promise<Response> {
  const prefix = args.prefix ? args.prefix.trim().toLowerCase() : ''
  // Prefix queries use the maintained _idx:prefix:<ns> index (O(1) lookup) instead
  // of a full kvList() scan — getIndexedKeys() falls back to scan+filter itself
  // if the index doesn't exist yet, so this is safe for any prefix.
  // No-prefix queries use the _idx:prefix:all master index (#359).
  let allKeys = prefix ? await getIndexedKeys(c, `_idx:prefix:${prefix}`) : await getAllKeys(c)

  if (args.world) {
    const raws = await Promise.all(allKeys.map((k) => kvGet(c, k)))
    allKeys = allKeys.filter((_, i) => {
      const raw = raws[i]
      if (!raw) return false
      return matchesWorld(parseKvEntry(raw).text, args.world!)
    })
  }

  const limit = Math.min(1000, args.limit ?? 1000)
  const offset = Math.max(0, args.offset ?? 0)
  const keys = allKeys.slice(offset, offset + limit)
  return c.json(
    makeResult(id, {
      content: [{ type: 'text', text: keys.join(', ') }],
      metadata: {
        count: keys.length,
        total: allKeys.length,
        limit,
        offset,
        prefix: prefix || null,
        world: args.world ?? null,
      },
    }),
    200,
  )
}

export const listMapsSchema = z.object({
  limit: z.number().optional(),
  offset: z.number().optional(),
})

export async function handle_list_maps({
  c,
  id,
  args,
}: TypedToolContext<typeof listMapsSchema>): Promise<Response> {
  const allKeys = await kvListMaps(c)
  const limit = Math.min(1000, args.limit ?? 1000)
  const offset = Math.max(0, args.offset ?? 0)
  const keys = allKeys.slice(offset, offset + limit)
  return c.json(
    makeResult(id, {
      content: [{ type: 'text', text: keys.join(', ') }],
      metadata: { count: keys.length, total: allKeys.length, limit, offset },
    }),
    200,
  )
}

export const getMapSchema = z.object({ map_id: z.string().min(1) })

export async function handle_get_map({
  c,
  id,
  args,
}: TypedToolContext<typeof getMapSchema>): Promise<Response> {
  const mapId = args.map_id.trim().toLowerCase()
  const key = mapId.startsWith('map:') ? mapId : `map:${mapId}`
  const raw = await kvGet(c, key)
  if (!raw)
    return c.json(
      makeError(
        id,
        -32602,
        `No map found for "${key}". Use list_maps to see available maps.`,
        null,
      ),
      200,
    )

  const { text, meta } = parseKvEntry(raw)
  return c.json(makeResult(id, { content: [{ type: 'text', text }], key, text, meta }), 200)
}

export const getLoreSchema = z.object({ query: z.string().min(1) })

export async function handle_get_lore({
  c,
  id,
  args,
}: TypedToolContext<typeof getLoreSchema>): Promise<Response> {
  const key = args.query.trim().toLowerCase()
  const raw = await kvGet(c, key)
  if (!raw) {
    // Auto-suggest: use the _idx:prefix:all master index instead of a full
    // kvList() scan (#359). Falls back to kvList() if the index doesn't exist.
    const allKeys = await getAllKeys(c)
    const query = key.includes(':') ? key.split(':').pop()! : key
    const suggestions = allKeys.filter((k) => k.includes(query)).slice(0, 5)
    const errorPayload: Record<string, unknown> = { key }
    let message = `No lore found for key "${key}"`
    if (suggestions.length > 0) {
      errorPayload.did_you_mean = suggestions[0]
      errorPayload.alternatives = suggestions
      message += `. Did you mean "${suggestions[0]}"?`
    }
    return c.json(makeError(id, -32602, message, errorPayload), 200)
  }

  const { text, meta } = parseKvEntry(raw)

  // Auto-redirect: if KV entry has been migrated to D1, serve live D1 data instead
  if (text.includes('## D1-Migrated: true') && c.env.RPG_DB) {
    const idMatch = text.match(/^## D1-Character-ID:\s*(\S+)/m)
    if (idMatch) {
      try {
        const row = await c.env.RPG_DB.prepare('SELECT * FROM characters WHERE id = ?')
          .bind(idMatch[1])
          .first()
        if (row) {
          const loreText = formatD1CharToLore(row as Record<string, unknown>)
          return c.json(
            makeResult(id, {
              content: [{ type: 'text', text: loreText }],
              key,
              text: loreText,
              meta: { ...meta, d1_redirect: true, d1_id: idMatch[1] },
            }),
            200,
          )
        }
      } catch {
        // D1 unavailable or schema not ready — fall through to stale KV text
      }
      // D1 row missing or D1 error — fall through and return stale KV text as-is
    }
  }

  return c.json(makeResult(id, { content: [{ type: 'text', text }], key, text, meta }), 200)
}

export const getLoreBatchSchema = z.object({ keys: z.array(z.string().min(1)).min(1) })

export async function handle_get_lore_batch({
  c,
  id,
  args,
}: TypedToolContext<typeof getLoreBatchSchema>): Promise<Response> {
  const cleanKeys = args.keys.map((k) => k.trim().toLowerCase())
  const rawValues = await Promise.all(cleanKeys.map((k) => kvGet(c, k)))
  const results: Record<string, any> = {}
  cleanKeys.forEach((k, i) => {
    results[k] = rawValues[i] ? parseKvEntry(rawValues[i]!) : null
  })

  const text = Object.entries(results)
    .map(([k, v]) => (v ? `${k}: [retrieved]` : `${k}: [not found]`))
    .join('\n')

  return c.json(
    makeResult(id, {
      content: [{ type: 'text', text }],
      metadata: {
        retrieved: Object.values(results).filter((v) => v !== null).length,
        total: args.keys.length,
      },
      results,
    }),
    200,
  )
}

export const getLoreSectionSchema = z.object({
  key: z.string().min(1),
  sections: z.array(z.string().min(1)),
  mode: z.enum(['strict', 'loose']).default('loose'),
})

export async function handle_get_lore_section({
  c,
  id,
  args,
}: TypedToolContext<typeof getLoreSectionSchema>): Promise<Response> {
  const key = args.key.trim().toLowerCase()
  const raw = await kvGet(c, key)
  if (!raw) {
    return c.json(
      makeResult(id, {
        content: [{ type: 'text', text: `Key not found: "${key}"` }],
        error: 'key_not_found',
        key,
      }),
      200,
    )
  }

  const { text, meta } = parseKvEntry(raw)
  const version = typeof meta.version === 'number' ? meta.version : null
  const { sections, not_found, warnings, suggestions } = parseLoreSections(
    text,
    args.sections,
    args.mode,
  )

  const foundCount = Object.keys(sections).length
  const summary =
    foundCount > 0
      ? `Retrieved ${foundCount} section(s) from "${key}".${not_found.length ? ` Not found: ${not_found.join(', ')}.` : ''}`
      : `No matching sections found in "${key}".`

  return c.json(
    makeResult(id, {
      content: [{ type: 'text', text: summary }],
      key,
      version,
      sections,
      not_found,
      warnings,
      suggestions,
    }),
    200,
  )
}

export function scoreMatch(query: string, candidate: string): number {
  // 1. Exact match → 1.0
  if (query === candidate) return 1.0

  // 2. Candidate starts with query → 0.9 (e.g. "zira" matches "character:zira")
  if (candidate.startsWith(query)) return 0.9

  // 3. Query appears as contiguous substring → ratio of query length to candidate length, scaled
  const idx = candidate.indexOf(query)
  if (idx !== -1) return Math.min(0.85, query.length / candidate.length + 0.5)

  // 4. Query appears as initials/acronym → 0.7 (e.g. "zk" matches "character:zira-khal")
  const initials = candidate
    .split(/[:\\\-_]/)
    .filter(Boolean)
    .map((s) => s[0])
    .join('')
  if (initials.includes(query)) return 0.7

  return 0
}

export const validateTopicExistsSchema = z.object({ query_string: z.string().min(1) })

export async function handle_validate_topic_exists({
  c,
  id,
  args,
}: TypedToolContext<typeof validateTopicExistsSchema>): Promise<Response> {
  // Use the _idx:prefix:all master index instead of a full kvList() scan (#359).
  // Falls back to kvList() if the index doesn't exist.
  const allKeys = await getAllKeys(c)
  const query = args.query_string.trim().toLowerCase()

  if (allKeys.includes(query)) {
    return c.json(
      makeResult(id, {
        content: [{ type: 'text', text: `Found: ${query}` }],
        exists: true,
        exact_match: query,
        namespace_matches: [],
        suggestion: query,
        did_you_mean: query,
        confidence: 1.0,
      }),
      200,
    )
  }

  const suggestions = allKeys.filter((k) => k.includes(query))
  if (suggestions.length > 0) {
    // Score all suggestions and pick the best
    const scored = suggestions.map((s) => ({ key: s, score: scoreMatch(query, s) }))
    scored.sort((a, b) => b.score - a.score)
    const best = scored[0]
    return c.json(
      makeResult(id, {
        content: [
          {
            type: 'text',
            text: `No exact match for "${query}", but found: ${suggestions.join(', ')}. Best match: "${best.key}" (confidence: ${best.score.toFixed(2)})`,
          },
        ],
        exists: false,
        exact_match: null,
        namespace_matches: suggestions,
        suggestion: suggestions[0] || null,
        did_you_mean: best.score > 0 ? best.key : null,
        confidence: best.score > 0 ? best.score : null,
      }),
      200,
    )
  }

  return c.json(
    makeResult(id, {
      content: [{ type: 'text', text: `No lore found matching "${query}".` }],
      exists: false,
      exact_match: null,
      namespace_matches: [],
      suggestion: null,
      did_you_mean: null,
      confidence: null,
    }),
    200,
  )
}

/**
 * Tokenized-OR KV search with relevance ranking and match_mode support (#357).
 *
 * The O(n) KV full-table scan remains a known performance limitation.
 * It will be replaced by D1 SQL with FTS5 full-text search during D1 migration.
 * See: https://github.com/FrozenRegister/holmgard-lore-mcp/issues/11
 */
export const searchLoreSchema = z.object({
  query: z.string().min(1),
  // Freeform **World:** field filter (#259) — narrows cross-world KV noise.
  // Not a D1 world_id FK; see matchesWorld() in lib/lore.ts.
  world: z.string().optional(),
  // Key prefix filter (e.g. "character", "location") — scopes the scan to
  // entries whose key starts with this prefix, avoiding irrelevant entries.
  prefix: z.string().optional(),
  // Match mode: "any" (default, tokenized-OR), "all" (AND — all tokens must
  // match, not necessarily contiguous), "exact" (full contiguous substring).
  match_mode: z.enum(['any', 'all', 'exact']).default('any'),
  max_results: z.number().min(1).max(50).default(10),
  scan_limit: z.number().int().min(1).max(2000).default(500),
})

export async function handle_search_lore({
  c,
  id,
  args,
}: TypedToolContext<typeof searchLoreSchema>): Promise<Response> {
  try {
    const { query: queryArg, world, prefix, match_mode, max_results, scan_limit } = args
    const searchQuery = queryArg.toLowerCase()
    const tokens = searchQuery.split(/\s+/).filter((t) => t.length > 0)

    // Get keys, optionally filtered by prefix using the maintained index
    let allKeys = await kvList(c)
    if (prefix) {
      const prefixLower = prefix.toLowerCase()
      allKeys = allKeys.filter((k) => k.startsWith(prefixLower))
    }
    allKeys = allKeys.slice(0, scan_limit)

    // Results include a relevance score for ranking
    const scoredResults: Array<{ key: string; excerpt: string; score: number }> = []
    const CHUNK_SIZE = 50

    for (let chunkStart = 0; chunkStart < allKeys.length; chunkStart += CHUNK_SIZE) {
      // Collect all matches from this chunk before checking max_results,
      // so we can sort by relevance and keep the top N across all chunks scanned.
      const chunkKeys = allKeys.slice(chunkStart, chunkStart + CHUNK_SIZE)

      // Use sequential gets with individual error handling to avoid TaskGroup
      // failures when a single KV read fails in the Workers runtime.
      const chunkRaws: Array<string | null> = []
      for (const k of chunkKeys) {
        try {
          chunkRaws.push(await kvGet(c, k))
        } catch {
          chunkRaws.push(null)
        }
      }

      for (let i = 0; i < chunkKeys.length; i++) {
        const raw = chunkRaws[i]
        if (!raw) continue
        const key = chunkKeys[i]
        const { text } = parseKvEntry(raw)
        if (world && !matchesWorld(text, world)) continue
        const lowerText = text.toLowerCase()

        // Determine match based on match_mode
        let matched = false
        let matchIdx = -1
        let matchLen = searchQuery.length
        let tokenMatchCount = 0

        if (match_mode === 'exact') {
          // Current behavior: full contiguous substring match
          matchIdx = lowerText.indexOf(searchQuery)
          matched = matchIdx !== -1
          if (matched) tokenMatchCount = 1
        } else if (match_mode === 'all') {
          // All tokens must be present (not necessarily contiguous)
          let allFound = true
          let firstIdx = -1
          for (const token of tokens) {
            const idx = lowerText.indexOf(token)
            if (idx === -1) {
              allFound = false
              break
            }
            if (firstIdx === -1 || idx < firstIdx) firstIdx = idx
          }
          matched = allFound
          if (matched) {
            matchIdx = firstIdx
            tokenMatchCount = tokens.length
            matchLen = tokens[0].length
          }
        } else {
          // "any" mode (default): tokenized-OR — match if any token is found
          let firstIdx = -1
          for (const token of tokens) {
            const idx = lowerText.indexOf(token)
            if (idx !== -1) {
              tokenMatchCount++
              if (firstIdx === -1 || idx < firstIdx) {
                firstIdx = idx
                matchLen = token.length
              }
            }
          }
          matched = tokenMatchCount > 0
          if (matched) matchIdx = firstIdx
        }

        if (!matched) continue

        // Relevance score: ratio of matched tokens to total tokens.
        // For "exact" mode, score is 1.0 (full query matched).
        // For "all" mode, score is 1.0 (all tokens matched).
        // For "any" mode, score is tokenMatchCount / tokens.length.
        const score =
          match_mode === 'exact' || match_mode === 'all'
            ? 1.0
            : tokens.length > 0
              ? tokenMatchCount / tokens.length
              : 1.0

        // Build excerpt around the first match position
        const start = Math.max(0, matchIdx - 30)
        const end = Math.min(text.length, matchIdx + matchLen + 50)
        let excerpt = text.slice(start, end)
        if (start > 0) excerpt = '…' + excerpt
        if (end < text.length) excerpt = excerpt + '…'

        scoredResults.push({ key, excerpt, score })
      }
    }

    // Sort by relevance score (descending), then by key for stable ordering
    scoredResults.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    const results = scoredResults
      .slice(0, max_results)
      .map(({ key, excerpt }) => ({ key, excerpt }))

    const summaryText =
      results.length > 0
        ? results.map((r) => `${r.key}: "${r.excerpt}"`).join('\n')
        : `No lore entries matching "${queryArg}".`

    return c.json(
      makeResult(id, {
        content: [{ type: 'text', text: summaryText }],
        metadata: {
          query: queryArg,
          world: world ?? null,
          prefix: prefix ?? null,
          match_mode,
          match_count: results.length,
          keys_scanned: allKeys.length,
          scan_limit,
        },
        results,
      }),
      200,
    )
  } catch (e) {
    console.error('Unhandled error in search_lore', e)
    return c.json(
      makeError(id, -32603, 'Internal error during search', {
        message: e instanceof Error ? e.message : String(e),
      }),
      200,
    )
  }
}
