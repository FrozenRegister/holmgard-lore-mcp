// src/tools/dispatch.ts — shared tool-resolution logic for both MCP transports
//
// src/index.ts (legacy JSON-RPC) and src/do/HolmgardMCP.ts (Streamable HTTP,
// via the HolmgardMCP Durable Object) each implement `tools/call` independently
// and used to hand-duplicate the same `ping`/`auth_check` special-casing and
// `toolRegistry` lookup. dispatchToolCall() is the single source of truth for
// that decision; each transport still owns its own response-shape formatting
// (Hono's c.json(...) vs. the MCP SDK's { content, isError } object) and its
// own auth-gating strategy — see #546 for why those are deliberately NOT
// folded in here: the two transports are not symmetric on auth (DO callers
// are always authenticated by the time they reach dispatch; JSON-RPC callers
// may not be), so `authenticated` is an input the caller computes, not
// something this function derives itself.
//
// Handler lookup checks the registerTool() registry first (#539/#540's
// registration-cutover — everything but `rpg` lives there now), falling
// back to the legacy `toolRegistry` for `rpg` itself.
import type { ToolHandler } from './types'
import { toolRegistry } from './registry'
import { getToolHandler } from './register'

export interface DispatchContent {
  type: 'text'
  text: string
}

export interface DispatchShortCircuit {
  kind: 'short-circuit'
  content: DispatchContent[]
  metadata: Record<string, unknown>
}

export interface DispatchNotFound {
  kind: 'not-found'
  toolName: string
}

export interface DispatchHandler {
  kind: 'handler'
  handler: ToolHandler
}

export type DispatchResult = DispatchShortCircuit | DispatchNotFound | DispatchHandler

/**
 * Resolves a `tools/call` request to one of three outcomes, without touching
 * either transport's request/response objects:
 *
 * - `short-circuit`: `lore_manage`'s `ping`/`auth_check` actions, answered
 *   directly without consulting the registry at all.
 * - `not-found`: no matching entry in either the registerTool() registry
 *   or the legacy `toolRegistry`.
 * - `handler`: the resolved `ToolHandler`, left uninvoked — each transport
 *   calls it with its own `ToolContext` (real vs. synthetic Hono context,
 *   `id`, and its own already-computed `authenticated` value).
 */
export function dispatchToolCall(
  toolName: string,
  args: Record<string, unknown>,
  ctx: { authenticated: boolean },
): DispatchResult {
  if (toolName === 'lore_manage') {
    const action = typeof args?.action === 'string' ? args.action : null

    if (action === 'ping') {
      return {
        kind: 'short-circuit',
        content: [{ type: 'text', text: 'pong' }],
        metadata: { source: 'internal' },
      }
    }

    if (action === 'auth_check') {
      return {
        kind: 'short-circuit',
        content: [
          {
            type: 'text',
            text: ctx.authenticated
              ? 'Authenticated.'
              : 'Not authenticated — request was made without a valid API key.',
          },
        ],
        metadata: { authenticated: ctx.authenticated },
      }
    }
    // fall through to registry for all other lore_manage actions
  }

  const handler = getToolHandler(toolName) ?? toolRegistry[toolName]
  if (!handler) return { kind: 'not-found', toolName }

  return { kind: 'handler', handler }
}
