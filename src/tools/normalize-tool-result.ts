// src/tools/normalize-tool-result.ts — shared MCP CallToolResult shape guard
//
// Both transports resolve a tool call to a JSON-RPC-shaped `{ result, error }`
// envelope (each tool handler ultimately does `c.json(makeResult(id, ...))`),
// but only the Streamable HTTP transport (src/do/HolmgardMCP.ts) needs to hand
// that `result` back to the MCP SDK as a `CallToolResult` object — the
// JSON-RPC transport (src/index.ts) returns the envelope as-is over the wire.
//
// Every handler reachable today via `dispatchToolCall()`/`toolRegistry`
// happens to build its `result` with a top-level `content` array (see
// tools/system.ts, tools/lore.ts, etc.), so passing `json.result` straight
// through as a `CallToolResult` has worked so far. But CLAUDE.md's own API
// surface convention encourages bare-method-style handlers that return a
// structured payload with no `content` array at all (e.g. `list_topics`'s
// `{ keys }`) — those aren't wired to `tools/call` today, but nothing stops
// a future handler from being reachable both ways. This function is the
// single place that decides what happens if one is (#621): validate the
// shape rather than assume it.
export interface NormalizedToolContent {
  type: 'text'
  text: string
}

export interface NormalizedToolResult {
  content: NormalizedToolContent[]
  isError?: boolean
  metadata?: unknown
  structuredContent?: unknown
  // Index signature so this satisfies the MCP SDK's `CallToolResult`-adjacent
  // return type (a `{ [x: string]: unknown }` record union member) at the
  // Server.setRequestHandler callback boundary in HolmgardMCP.ts.
  [key: string]: unknown
}

/**
 * Normalizes a resolved tool handler's JSON-RPC `result` into a valid MCP
 * `CallToolResult` shape.
 *
 * - Already content-block-shaped (`{ content: [...] }`) → passed through
 *   unchanged (the common case for every handler today).
 * - A structured payload with no `content` array → wrapped into a single
 *   text block carrying the JSON, with the original payload preserved
 *   under `structuredContent` (MCP's designated field for this).
 * - `undefined` (no `result` and no `error` — an unexpected transport-level
 *   state) → an explicit error result, not a synthesized "ok".
 */
export function normalizeToolResult(
  result: Record<string, unknown> | undefined,
): NormalizedToolResult {
  if (result === undefined) {
    return {
      content: [{ type: 'text', text: 'Internal error: tool handler returned no result' }],
      isError: true,
    }
  }

  if (Array.isArray(result.content)) {
    return result as NormalizedToolResult
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
  }
}
