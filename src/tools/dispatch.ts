// src/tools/dispatch.ts — shared dispatch decision logic for both MCP transports.
//
// Phase 5 of #540: extracts the ping/auth_check special-casing and toolRegistry
// lookup that were duplicated between src/index.ts (legacy JSON-RPC /mcp handler)
// and src/do/HolmgardMCP.ts (Durable Object Streamable HTTP transport). Both
// transports now call dispatchToolCall() for the *decision* (which handler to
// invoke, whether to short-circuit) and adapt the returned DispatchResult into
// their own response format — see judgment call (3) in issue #546.
import type { ToolHandler } from './types'
import { toolRegistry } from './registry'

/** Transport-agnostic description of what dispatch decided. */
export type DispatchResult =
  | { kind: 'short-circuit'; content: unknown; metadata?: Record<string, unknown> }
  | { kind: 'handler'; handler: ToolHandler }
  | { kind: 'not-found'; toolName: string }

export interface DispatchToolCallArgs {
  name: string
  args: Record<string, unknown>
  authenticated: boolean
}

/**
 * Decide which handler should resolve a tool call, shared by both MCP transports.
 *
 * - `ping` and `auth_check` short-circuit here (no registry handler exists for them).
 *   `auth_check`'s text/metadata is driven by the passed-in `authenticated` value —
 *   see judgment call (1) in issue #546: the two transports are intentionally
 *   asymmetric on auth, and this function preserves that asymmetry by accepting the
 *   caller's value rather than computing one itself.
 * - All other tools fall through to `toolRegistry[name]`.
 *
 * Returns a transport-agnostic DispatchResult — each call site adapts it into its
 * own response shape (JSON-RPC envelope on /mcp, content/isError on the DO).
 */
export function dispatchToolCall({
  name,
  args,
  authenticated,
}: DispatchToolCallArgs): DispatchResult {
  if (name === 'lore_manage') {
    const action = typeof args?.action === 'string' ? args.action : null
    if (action === 'ping') {
      return {
        kind: 'short-circuit',
        content: { type: 'text', text: 'pong' },
        metadata: { source: 'internal' },
      }
    }
    if (action === 'auth_check') {
      return {
        kind: 'short-circuit',
        content: {
          type: 'text',
          text: authenticated
            ? 'Authenticated.'
            : 'Not authenticated — request was made without a valid API key.',
        },
        metadata: { authenticated },
      }
    }
  }

  const handler = toolRegistry[name]
  if (handler) {
    return { kind: 'handler', handler }
  }

  return { kind: 'not-found', toolName: name }
}
